// src/lib/conversation.ts — the turn-by-turn recovery conversation (Asha v2).
// Drives a real back-and-forth: opening (daypart greeting + ledger facts) → borrower turn →
// LLM reply → … → PTP capture + payment link → close. State is per-callSid (in-memory; a
// call is short-lived and the app is single-instance — move to Redis when clustering).
//
// This is the SAME behaviour as the Samvaad flow, running over Twilio <Gather> speech turns
// instead of a media-stream WebSocket, so it needs no persistent socket — only a public
// webhook URL Twilio can POST each turn to (APP_URL).

import { chat, extractPtp, ChatMessage } from "./sarvam";
import { findLoanByLoanId, logInteraction, insertPtp, findOpenPtp } from "./db";
import { onCallPaymentLink } from "./payments";
import { istDaypart } from "./twilio";

interface CallState {
  callSid: string; loanId: string; customerId: string; language: string;
  messages: ChatMessage[]; turns: number; ptpDate?: string; linkSent: boolean;
  name: string;
}
const CALLS = new Map<string, CallState>();

const DAYPART_GREETING: Record<string, Record<string, string>> = {
  mr: { morning: "शुभ सकाळ", afternoon: "शुभ दुपार", evening: "शुभ संध्याकाळ" },
  hi: { morning: "सुप्रभात", afternoon: "शुभ दोपहर", evening: "शुभ संध्या" },
  en: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
};

const inr = (n: number) => Number(n).toLocaleString("en-IN");

/** Asha v2 system prompt, grounded with THIS borrower's ledger facts (GOLDEN RULE 1). */
function systemPrompt(s: { name: string; language: string; loan: any }): string {
  const l = s.loan;
  const langName = { mr: "Marathi", hi: "Hindi", en: "English" }[s.language] || "Hindi";
  return [
    `You are "Asha", a warm, respectful FEMALE loan-recovery voice agent for Sahakar Krishi Vikas Bank (SKVCB).`,
    `You are on a phone call with the borrower ${s.name}. Speak ONLY in ${langName}. Keep every reply to ONE or TWO short spoken sentences — this is a live phone call, never monologue, ask one thing at a time.`,
    ``,
    `LEDGER FACTS (the ONLY figures you may state — never invent or change a number):`,
    `- EMI overdue: ${inr(l.emiAmount)} rupees`,
    `- Days overdue: ${l.dpd} days`,
    `- Total pending: ${inr(l.pendingAmount)} rupees`,
    `- Product: ${l.productType}, account ending ${String(l.loanId).slice(-4)}`,
    ``,
    `GOAL: get a Promise-to-Pay with a SPECIFIC date. Conversation flow:`,
    `1. Understand why they haven't paid (ask empathetically).`,
    `2. If they give a vague answer ("next month", "I'll see"), gently narrow to a concrete date in at most two tries, anchored to their reason (e.g. after salary).`,
    `3. You MAY mention late fee and CIBIL/credit-score impact ONCE as plain facts, never as a threat.`,
    `4. When they commit to a date, confirm it back with the amount, and tell them you are sending a secure payment link to their WhatsApp now.`,
    `5. Close warmly.`,
    ``,
    `RULES: Be non-coercive (RBI conduct). Never ask for OTP/PIN/card. If they dispute the amount or claim already paid, don't argue — say the team will verify. If they are angry or say "don't call me", apologise and say you'll note it. Speak ONLY the sentence to say aloud — no labels, no JSON, no english explanation.`,
  ].join("\n");
}

/** Begin a call: greeting + ledger facts + opening question. Returns the first line to speak. */
export async function startConversation(callSid: string, loanId: string): Promise<{ text: string; language: string }> {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const language = ["mr", "hi", "en"].includes(loan.customer.preferredLanguage) ? loan.customer.preferredLanguage : "hi";
  const greeting = DAYPART_GREETING[language]?.[istDaypart()] ?? "";

  const state: CallState = {
    callSid, loanId, customerId: loan.customer.id, language,
    messages: [{ role: "system", content: systemPrompt({ name: loan.customer.name, language, loan }) }],
    turns: 0, linkSent: false, name: loan.customer.name,
  };
  CALLS.set(callSid, state);

  // Deterministic opening (no LLM latency on turn 0): greeting + who + facts + open question.
  const opening = language === "mr"
    ? `${greeting}, नमस्कार ${loan.customer.name} जी. मी सहकार कृषी विकास बँकेकडून आशा बोलत आहे. तुमच्या कर्जाचा ${inr(loan.emiAmount)} रुपयांचा हप्ता ${loan.dpd} दिवसांपासून थकीत आहे. काही अडचण आहे का?`
    : language === "hi"
    ? `${greeting}, नमस्ते ${loan.customer.name} जी. मैं सहकार कृषि विकास बैंक से आशा बोल रही हूँ. आपके ऋण की ${inr(loan.emiAmount)} रुपये की किस्त ${loan.dpd} दिनों से बकाया है. क्या कोई परेशानी है?`
    : `${greeting}, ${loan.customer.name}. This is Asha from Sahakar Krishi Vikas Bank. Your EMI of ${inr(loan.emiAmount)} rupees is overdue by ${loan.dpd} days. Is there some difficulty?`;

  state.messages.push({ role: "assistant", content: opening });
  logInteraction({
    customerId: loan.customer.id, loanId, channel: "VOICE", direction: "OUTBOUND",
    outcome: "CALL_OPENING", details: { callSid, language },
  });
  return { text: opening, language };
}

/** Handle one borrower turn. Returns the reply to speak and whether to keep the call open. */
export async function handleTurn(callSid: string, userSpeech: string): Promise<{ text: string; language: string; end: boolean }> {
  const state = CALLS.get(callSid);
  if (!state) throw new Error("no such call (state expired)");
  state.turns++;
  const heard = (userSpeech || "").trim();

  state.messages.push({ role: "user", content: heard || "(no response)" });

  // Reliable PTP capture: a dedicated extractor on the borrower's utterance (decoupled from
  // reply generation, which a reasoning model can truncate).
  if (!state.ptpDate && heard) {
    const ptp = await extractPtp(heard, new Date().toISOString().slice(0, 10));
    if (ptp.committed && ptp.date) state.ptpDate = ptp.date;
  }

  // When a date is captured, steer this reply to confirm it + announce the link, then close.
  const turnMessages = state.messages.slice();
  if (state.ptpDate && !state.linkSent) {
    turnMessages.push({ role: "system", content:
      `The borrower has committed to pay on ${state.ptpDate}. In ONE short sentence, confirm this date back to them, ` +
      `say you are sending a secure payment link to their WhatsApp now, and thank them warmly.` });
  }

  let reply = await chat(turnMessages, { maxTokens: 3000 });
  if (!reply) {
    // Safety net: never speak an empty turn.
    reply = state.ptpDate
      ? (state.language === "mr" ? `धन्यवाद. मी तुमच्या व्हॉट्सॲपवर पेमेंट लिंक पाठवत आहे.`
        : state.language === "hi" ? `धन्यवाद. मैं आपके व्हाट्सएप पर पेमेंट लिंक भेज रही हूँ.`
        : `Thank you. I'm sending a payment link to your WhatsApp now.`)
      : (state.language === "mr" ? "समजलं. तुम्ही नक्की कोणत्या तारखेला भरू शकाल?"
        : state.language === "hi" ? "समझ गई. आप ठीक किस तारीख को भुगतान कर पाएँगे?"
        : "I understand. On exactly which date can you pay?");
  }

  state.messages.push({ role: "assistant", content: reply });

  // On a captured PTP: record it + fire the payment link (same closure path as elsewhere).
  if (state.ptpDate && !state.linkSent) {
    const loan = findLoanByLoanId(state.loanId);
    if (loan) {
      if (!findOpenPtp(state.loanId)) {
        insertPtp({ loanId: state.loanId, customerId: state.customerId, amount: loan.emiAmount, dueDate: new Date(state.ptpDate).toISOString() });
      }
      await onCallPaymentLink(state.loanId, state.customerId, loan.emiAmount);
      state.linkSent = true;
      logInteraction({
        customerId: state.customerId, loanId: state.loanId, channel: "VOICE", direction: "INBOUND",
        outcome: "PROMISE_TO_PAY", promiseToPayDate: state.ptpDate, promiseToPayAmount: loan.emiAmount,
        details: { callSid, via: "conversation" },
      });
    }
  }

  logInteraction({
    customerId: state.customerId, loanId: state.loanId, channel: "VOICE", direction: "INTERNAL",
    outcome: "CALL_TURN", details: { callSid, turn: state.turns, heard, reply, ptp: state.ptpDate },
  });

  // End after a captured PTP (link sent) or a safety cap of turns.
  const end = state.linkSent || state.turns >= 8;
  if (end) {
    logInteraction({
      customerId: state.customerId, loanId: state.loanId, channel: "VOICE", direction: "INTERNAL",
      outcome: "CALL_CLOSED", details: { callSid, turns: state.turns, ptpDate: state.ptpDate ?? null, linkSent: state.linkSent },
    });
    CALLS.delete(callSid);
  }
  return { text: reply, language: state.language, end };
}

export function conversationActive(callSid: string): boolean {
  return CALLS.has(callSid);
}
