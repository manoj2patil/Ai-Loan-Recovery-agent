// src/lib/conversation.ts — the turn-by-turn recovery conversation (Asha v2).
// Drives a real back-and-forth: opening (daypart greeting + ledger facts) → borrower turn →
// LLM reply → … → PTP capture + payment link → close. State is per-callSid (in-memory; a
// call is short-lived and the app is single-instance — move to Redis when clustering).
//
// This is the SAME behaviour as the Samvaad flow, running over Twilio <Gather> speech turns
// instead of a media-stream WebSocket, so it needs no persistent socket — only a public
// webhook URL Twilio can POST each turn to (APP_URL).

import { chat, extractPtp, extractCallback, summarizeCall, ChatMessage } from "./sarvam";
import { findLoanByLoanId, logInteraction, insertPtp, findOpenPtp,
         scheduleCallback, recentMemory, writeMemory, queueHandoff } from "./db";
import { getConfig } from "./config";
import { sendPaymentMessage } from "./whatsapp";
import { istDaypart } from "./twilio";
import { detectLanguage, LANG_NAME, Lang } from "./language";

interface CallState {
  callSid: string; loanId: string; customerId: string; language: string;
  messages: ChatMessage[]; turns: number; ptpDate?: string; linkSent: boolean;
  paidClaimed: boolean; callbackAt?: string; reassuredFraud: boolean; name: string;
}
const CALLS = new Map<string, CallState>();

// Borrower suspects a scam / fraud call.
function suspectsFraud(text: string): boolean {
  const t = text.toLowerCase();
  return ["fraud", "scam", "fake", "how do i know", "who are you really", "prove", "not real", "cheat", "won't share", "not sharing", "trust you"].some((k) => t.includes(k))
    || ["फ्रॉड", "फसवणूक", "धोका", "खोटं", "खोटे", "बनावट", "फर्जी", "नकली", "कैसे पता", "कोण आहात", "कोन आहात", "विश्वास", "माहिती देणार नाही", "जानकारी नहीं", "ठग"].some((k) => text.includes(k));
}

// Borrower is asking to be reached later (busy / meeting / travel / "call tomorrow").
function asksLater(text: string): boolean {
  const t = text.toLowerCase();
  return ["call me", "call back", "later", "busy", "meeting", "travel", "driving", "tomorrow", "not now", "another time", "call after"].some((k) => t.includes(k))
    || ["नंतर", "मीटिंग", "मिटिंग", "बिझी", "व्यस्त", "प्रवास", "प्रवासात", "गाडी", "उद्या", "आत्ता नको", "फोन करा", "कॉल करा", "बाद में", "व्यस्त हूँ", "मीटिंग में", "कल", "अभी नहीं"].some((k) => text.includes(k));
}

const DAYPART_GREETING: Record<string, Record<string, string>> = {
  mr: { morning: "शुभ सकाळ", afternoon: "शुभ दुपार", evening: "शुभ संध्याकाळ" },
  hi: { morning: "सुप्रभात", afternoon: "शुभ दोपहर", evening: "शुभ संध्या" },
  en: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
};

const inr = (n: number) => Number(n).toLocaleString("en-IN");

/** Asha system prompt — enterprise agent, grounded with THIS borrower's ledger facts + the
 *  memory of the last call (so she picks up the relationship, not a cold script). */
function systemPrompt(s: { name: string; language: string; loan: any; memory: string[]; officialNumber: string }): string {
  const l = s.loan;
  const langName = LANG_NAME[s.language as Lang] || "Hindi";
  const lines = [
    `You are "Asha", a warm, experienced FEMALE loan-recovery officer at Sahakar Krishi Vikas Cooperative Bank (SKVCB).`,
    `You are on a LIVE PHONE CALL with the borrower ${s.name}. Behave like a skilled, human recovery officer — not a robot reading a script.`,
    ``,
    `HOW A GOOD HUMAN AGENT THINKS (do this):`,
    `- Build a little rapport and LISTEN first; let them explain before you push.`,
    `- Diagnose the REAL blocker: is this "cannot pay right now" (cash-flow: salary late, medical, job loss) or "will not pay" (dispute, unhappy, avoidance)? Handle them very differently.`,
    `- For CANNOT-pay: empathise genuinely, then offer a face-saving path — a short extension, a part-payment now + rest later, or after their salary date. Get ONE concrete commitment.`,
    `- For WILL-NOT-pay / avoidance: stay calm and firm, restate the plain facts (amount, how many days, that late fee and CIBIL are affected — say this ONCE), and offer the easiest next step.`,
    `- Never argue, never threaten, never repeat yourself. If they raise an objection, acknowledge it in a few words, then move to a solution or a question. One idea per turn.`,
    `- Always be closing gently: every couple of turns, ask for a specific date or a specific amount.`,
    ``,
    `LANGUAGE — you are fluent in ALL Indian languages. Speak in the borrower's CURRENT language`,
    `(right now: ${langName}). If they switch language mid-call, switch with them immediately.`,
    `Handle Hinglish / code-mixing. Keep EVERY reply to ONE or TWO short spoken sentences.`,
    `Speak numbers and dates as natural words.`,
    ``,
    `LEDGER FACTS (the ONLY figures you may ever state — never invent or change a number):`,
    `- EMI overdue: ${inr(l.emiAmount)} rupees   - Days overdue: ${l.dpd} days`,
    `- Total pending: ${inr(l.pendingAmount)} rupees   - Product: ${l.productType}, account ending ${String(l.loanId).slice(-4)}`,
  ];
  if (s.memory.length) {
    lines.push(``, `MEMORY OF THE LAST CALL(S) with this borrower — reference it naturally so they feel remembered ("last time you mentioned…"):`);
    for (const m of s.memory) lines.push(`- ${m}`);
  }
  lines.push(
    ``,
    `OBJECTION HANDLING (respond smartly, like a human):`,
    `- "No money / salary late" → empathise; ask WHEN money comes; anchor the date to that; offer part-payment if full isn't possible.`,
    `- "Business is down / lost job" → empathise; mention you can note hardship and offer a small restructure; get a realistic small commitment or escalate to the officer.`,
    `- "I'll pay next month / later" (vague) → gently pin a specific date, at most two tries.`,
    `- "Already paid" → thank them, ask for the UPI reference on WhatsApp, say the team will verify; do NOT argue.`,
    `- "Amount is wrong / dispute" → don't argue; say you'll have it checked and note it.`,
    `- "Why should I pay / not paying" → stay calm; state facts once (days overdue, late fee, CIBIL); ask what would make it possible; offer the easiest path.`,
    `- Angry / "stop calling" → apologise sincerely, say you'll note their request, keep it short.`,
    ``,
    `FRAUD / TRUST — if they suspect this is a scam or refuse to trust you: stay calm, do NOT get defensive.`,
    `Reassure them you will NEVER ask for an OTP, PIN, CVV, card number or password, and that they can call the`,
    `bank's official number ${s.officialNumber} to verify you, then continue. Never pressure a suspicious borrower.`,
    ``,
    `CALLBACK — if they are genuinely busy (meeting, driving, travelling) or ask to be called at a specific`,
    `later time, DON'T push. Acknowledge warmly, confirm you'll call back at that time, and end politely.`,
    ``,
    `STRICT SCOPE — ONLY this loan account. Any off-topic question gets ONE short polite line, then back to the`,
    `loan. Never discuss other loans, other people's accounts, or anything unrelated.`,
    ``,
    `CONDUCT (RBI): respectful, empathetic, non-coercive. Never ask for OTP/PIN/CVV/card/password.`,
    `Output ONLY the exact sentence to speak aloud — no labels, no JSON, no English explanation.`,
  );
  return lines.join("\n");
}

/** A turn is "complex" (route to the 105B deep negotiator) when the borrower signals hardship,
 *  a dispute, settlement talk, or frustration — otherwise the fast 30B model handles it. */
function isComplexTurn(text: string): boolean {
  const t = text.toLowerCase();
  const en = ["lost my job", "no job", "unemploy", "no money", "cannot pay", "can't pay", "hospital", "medical", "died", "death", "settlement", "settle", "waive", "discount", "dispute", "already paid", "wrong", "not fair", "harass", "complaint", "too much loan", "financial problem", "difficult"];
  const indic = ["नौकरी", "नोकरी", "बेरोजगार", "पैसे नाही", "पैसे नहीं", "पैसा नहीं", "भरता येणार नाही", "नहीं भर", "दवाखान", "अस्पताल", "हॉस्पिटल", "बीमार", "आजारी", "मृत्यू", "समझौता", "सेटलमेंट", "माफ", "सूट", "तक्रार", "शिकायत", "आधीच भरले", "पहले ही भर", "चूक", "गलत", "खूप कर्ज", "बहुत कर्ज", "अडचण", "परेशानी", "problem"];
  return en.some((k) => t.includes(k)) || indic.some((k) => text.includes(k));
}

// Payment-already-made phrases (trigger the confirmation/UTR-request path).
function claimsPaid(text: string): boolean {
  const t = text.toLowerCase();
  return ["already paid", "i have paid", "i paid", "payment done", "paid already"].some((k) => t.includes(k))
    || ["भरले आहे", "भरलं", "पैसे भरले", "भर दिया", "भुगतान कर दिया", "पेमेंट कर दिया", "पेमेंट झाल"].some((k) => text.includes(k));
}

/** Begin a call: greeting + ledger facts + opening question. Returns the first line to speak. */
export async function startConversation(callSid: string, loanId: string): Promise<{ text: string; language: string }> {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const language = ["mr", "hi", "en"].includes(loan.customer.preferredLanguage) ? loan.customer.preferredLanguage : "hi";
  const greeting = DAYPART_GREETING[language]?.[istDaypart()] ?? "";

  // Cross-call memory: what was discussed on prior calls with this borrower.
  const memory = recentMemory(loan.customer.id, 4).map((m) => m.content).filter(Boolean);
  const officialNumber = getConfig("CUSTOMER_CARE_NUMBER", getConfig("BANK_HO_PHONE", "1800-111-1212"));

  const state: CallState = {
    callSid, loanId, customerId: loan.customer.id, language,
    messages: [{ role: "system", content: systemPrompt({ name: loan.customer.name, language, loan, memory, officialNumber }) }],
    turns: 0, linkSent: false, paidClaimed: false, reassuredFraud: false, name: loan.customer.name,
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

  // MID-CALL LANGUAGE SWITCH: detect the language of THIS utterance; if the borrower switched,
  // follow them — the reply, TTS, and Twilio's next ASR hint all move to the new language.
  let switched = false;
  if (heard) {
    const det = detectLanguage(heard);
    if (det && det !== state.language) {
      logInteraction({
        customerId: state.customerId, loanId: state.loanId, channel: "SYSTEM", direction: "INTERNAL",
        outcome: "LANGUAGE_SWITCH", details: { callSid, from: state.language, to: det },
      });
      state.language = det;
      switched = true;
    }
  }

  state.messages.push({ role: "user", content: heard || "(no response)" });

  // Payment-confirmation path: borrower says they've already paid → ask for UTR, don't argue.
  if (!state.paidClaimed && claimsPaid(heard)) state.paidClaimed = true;

  // CALLBACK: borrower is busy / asks to be called later → schedule it, confirm, and end.
  if (!state.ptpDate && !state.paidClaimed && heard && asksLater(heard)) {
    const cb = await extractCallback(heard, new Date().toISOString());
    if (cb.wants) {
      const when = cb.whenIso ? new Date(cb.whenIso).toISOString() : new Date(Date.now() + 86400000).toISOString();
      state.callbackAt = when;
      scheduleCallback(state.loanId, state.customerId, when, cb.reason);
      logInteraction({
        customerId: state.customerId, loanId: state.loanId, channel: "VOICE", direction: "INTERNAL",
        outcome: "CALLBACK_SCHEDULED", details: { callSid, when, reason: cb.reason },
      });
    }
  }

  // FRAUD/TRUST: borrower suspects a scam → one-time reassurance path (official number).
  const raiseFraud = !state.reassuredFraud && suspectsFraud(heard);
  if (raiseFraud) {
    state.reassuredFraud = true;
    logInteraction({
      customerId: state.customerId, loanId: state.loanId, channel: "SYSTEM", direction: "INTERNAL",
      outcome: "FRAUD_CONCERN_REASSURED", details: { callSid },
    });
  }

  // Reliable PTP capture: a dedicated extractor on the borrower's utterance (decoupled from
  // reply generation, which a reasoning model can truncate). Skip if paid/callback/fraud turn.
  if (!state.ptpDate && !state.paidClaimed && !state.callbackAt && heard) {
    const ptp = await extractPtp(heard, new Date().toISOString().slice(0, 10));
    if (ptp.committed && ptp.date) state.ptpDate = ptp.date;
  }

  // Steer this reply per situation.
  const turnMessages = state.messages.slice();
  if (switched) {
    turnMessages.push({ role: "system", content:
      `The borrower just switched to ${LANG_NAME[state.language as Lang]}. Reply in ${LANG_NAME[state.language as Lang]} from now on.` });
  }
  if (raiseFraud) {
    turnMessages.push({ role: "system", content:
      `The borrower suspects this is a fraud/scam call. In ONE short reassuring sentence: confirm you will NEVER ask for OTP/PIN/card/password, and that they can call the bank's official number to verify you. Stay calm, do not pressure.` });
  } else if (state.callbackAt) {
    turnMessages.push({ role: "system", content:
      `The borrower is busy and wants a callback around ${state.callbackAt}. In ONE short sentence, warmly confirm you will call them back then, and say goodbye politely.` });
  } else if (state.paidClaimed && !state.ptpDate) {
    turnMessages.push({ role: "system", content:
      `The borrower says they have ALREADY PAID. In ONE short sentence: thank them, ask them to send the UPI reference number and date on WhatsApp so the team can confirm, and reassure them. Do not argue.` });
  } else if (state.ptpDate && !state.linkSent) {
    turnMessages.push({ role: "system", content:
      `The borrower has committed to pay on ${state.ptpDate}. In ONE short sentence, confirm this date back to them, ` +
      `say you are sending a secure payment link to their WhatsApp now, and thank them warmly.` });
  }

  // Route hardship/dispute/settlement/fraud turns to the 105B deep negotiator; else fast 30B.
  const tier = (isComplexTurn(heard) || raiseFraud) ? "deep" as const : "fast" as const;
  let reply = await chat(turnMessages, { maxTokens: 3000, tier });
  if (!reply) {
    const L = (mr: string, hi: string, en: string) => state.language === "mr" ? mr : state.language === "hi" ? hi : en;
    reply = state.callbackAt
      ? L("ठीक आहे, मी तुम्हाला नंतर फोन करते. धन्यवाद!", "ठीक है, मैं आपको बाद में कॉल करती हूँ. धन्यवाद!", "Sure, I'll call you back then. Thank you!")
      : raiseFraud
      ? L("काळजी करू नका, आम्ही कधीही OTP किंवा पिन विचारत नाही. तुम्ही बँकेच्या अधिकृत क्रमांकावर खात्री करू शकता.", "चिंता न करें, हम कभी OTP या पिन नहीं माँगते. आप बैंक के आधिकारिक नंबर पर पुष्टि कर सकते हैं.", "Please don't worry — we never ask for an OTP or PIN. You can verify us on the bank's official number.")
      : state.ptpDate
      ? L("धन्यवाद. मी तुमच्या व्हॉट्सॲपवर पेमेंट लिंक पाठवत आहे.", "धन्यवाद. मैं आपके व्हाट्सएप पर पेमेंट लिंक भेज रही हूँ.", "Thank you. I'm sending a payment link to your WhatsApp now.")
      : state.paidClaimed
      ? L("धन्यवाद. कृपया UPI रेफरन्स व्हॉट्सॲपवर पाठवा, आम्ही तपासतो.", "धन्यवाद. कृपया UPI रेफरेंस व्हाट्सएप पर भेजें, हम जाँच लेंगे.", "Thank you. Please send the UPI reference on WhatsApp and we'll confirm.")
      : L("समजलं. तुम्ही नक्की कोणत्या तारखेला भरू शकाल?", "समझ गई. आप ठीक किस तारीख को भुगतान कर पाएँगे?", "I understand. On exactly which date can you pay?");
  }

  state.messages.push({ role: "assistant", content: reply });

  // On a captured PTP: record it + send the RICH WhatsApp payment message (account details +
  // secure link + UPI-reference instructions, localized) — the agent's close deliverable.
  if (state.ptpDate && !state.linkSent) {
    const loan = findLoanByLoanId(state.loanId);
    if (loan) {
      if (!findOpenPtp(state.loanId)) {
        insertPtp({ loanId: state.loanId, customerId: state.customerId, amount: loan.emiAmount, dueDate: new Date(state.ptpDate).toISOString() });
      }
      const payBy = new Date(state.ptpDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      try {
        await sendPaymentMessage(state.loanId, { amount: loan.emiAmount, payByDate: payBy, language: state.language });
      } catch { /* pilot allowlist / egress — PTP still recorded, message retried out-of-band */ }
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
    outcome: "CALL_TURN", details: { callSid, turn: state.turns, heard, reply, tier, language: state.language, ptp: state.ptpDate, paidClaimed: state.paidClaimed, callbackAt: state.callbackAt },
  });

  // End after link sent, a scheduled callback, a paid-claim (UTR requested), or a turn cap.
  const end = state.linkSent || !!state.callbackAt || (state.paidClaimed && state.turns >= 2) || state.turns >= 8;
  if (end) await closeCall(state);
  return { text: reply, language: state.language, end };
}

/** Close-out: write a one-line memory of this call for the NEXT call, log disposition,
 *  queue a human handoff if unresolved and no callback/PTP, then drop the in-memory state. */
async function closeCall(state: CallState): Promise<void> {
  const disposition = state.linkSent ? "PTP" : state.callbackAt ? "CALLBACK_SCHEDULED"
    : state.paidClaimed ? "PAID_CLAIMED" : "NO_COMMITMENT";

  // Persist a memory note (LLM summary; falls back to a deterministic line).
  try {
    const transcript = state.messages.filter((m) => m.role !== "system")
      .map((m) => `${m.role === "assistant" ? "Asha" : "Borrower"}: ${m.content}`).join("\n");
    let note = await summarizeCall(transcript, state.language);
    if (!note) {
      note = state.ptpDate ? `PTP for ${state.ptpDate}; link sent.`
        : state.callbackAt ? `Asked for a callback at ${state.callbackAt}.`
        : state.paidClaimed ? `Claimed already paid; UPI reference requested.`
        : `No commitment reached after ${state.turns} turns.`;
    }
    writeMemory(state.customerId, note, state.language, { loanId: state.loanId, sourceCallSid: state.callSid });
  } catch { /* memory is best-effort */ }

  // Unresolved and no callback → hand to a human officer to follow up.
  if (disposition === "NO_COMMITMENT") queueHandoff(state.loanId, state.customerId, "call ended with no commitment");

  logInteraction({
    customerId: state.customerId, loanId: state.loanId, channel: "VOICE", direction: "INTERNAL",
    outcome: "CALL_CLOSED",
    details: { callSid: state.callSid, turns: state.turns, disposition, ptpDate: state.ptpDate ?? null, callbackAt: state.callbackAt ?? null, linkSent: state.linkSent },
  });
  CALLS.delete(state.callSid);
}

export function conversationActive(callSid: string): boolean {
  return CALLS.has(callSid);
}
