// Generate PERSONALIZED call audio per loan × daypart with Sarvam Bulbul TTS.
// Voice: anushka (female) — agent persona "Asha" (name matches the voice).
// Ledger figures (EMI, days overdue, pending) come from the seeded store — GOLDEN RULE 1.
// Bulbul pronounces Indian currency/dates natively, so figures are passed as numerals.
//
// Usage (run with tsx — it imports the amount-to-speech TS lib):
//   SARVAM_API_KEY=sk_... npx tsx scripts/generate-call-audio.mjs LOAN1 [LOAN2 ...]
//   (no args → the loans listed in SEED_PHONE_OVERRIDES)
//
// Output: public/audio/call-<loanId>-<daypart>.wav  (morning|afternoon|evening)
// Commit + push, set AUDIO_BASE_URL, and placeCall picks the right file at dial time.

import fs from "node:fs";
import path from "node:path";
import { amountToWords, daysToWords } from "../src/lib/amount-to-speech.ts";

const KEY = process.env.SARVAM_API_KEY;
if (!KEY) { console.error("Set SARVAM_API_KEY"); process.exit(1); }

const db = JSON.parse(fs.readFileSync(path.resolve("data", "db.json"), "utf8"));

let loanIds = process.argv.slice(2);
if (loanIds.length === 0) {
  loanIds = (process.env.SEED_PHONE_OVERRIDES ?? "").split(",")
    .map((p) => p.split(":")[0]?.trim()).filter(Boolean);
}
if (loanIds.length === 0) { console.error("No loan ids given"); process.exit(1); }

const DAYPART = {
  mr: { morning: "शुभ सकाळ", afternoon: "शुभ दुपार", evening: "शुभ संध्याकाळ" },
  hi: { morning: "सुप्रभात", afternoon: "शुभ दोपहर", evening: "शुभ संध्या" },
  en: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
};

function script(lang, daypart, c, l) {
  // VOICE LESSON: amounts + day counts as NATIVE WORDS (not digits) so Bulbul says
  // "अडतीस हजार रुपये", not English "38,000".
  const emi = amountToWords(l.emiAmount, lang);
  const pending = amountToWords(l.pendingAmount, lang);
  const days = daysToWords(l.dpd, lang);
  if (lang === "mr") return (
    `${DAYPART.mr[daypart]}, नमस्कार ${c.name} जी. मी सहकार कृषी विकास बँकेकडून आशा बोलत आहे. ` +
    `तुमच्या कर्जाचा ${emi} हप्ता ${days} दिवसांपासून थकीत आहे. ` +
    `एकूण थकबाकी ${pending} आहे. ` +
    `आम्ही तुमच्या व्हॉट्सॲपवर सुरक्षित पेमेंट लिंक पाठवली आहे, कृपया लवकरात लवकर भरणा करा. ` +
    `धन्यवाद, तुमचा दिवस शुभ असो.`);
  if (lang === "hi") return (
    `${DAYPART.hi[daypart]}, नमस्ते ${c.name} जी. मैं सहकार कृषि विकास बैंक से आशा बोल रही हूँ. ` +
    `आपके ऋण की ${emi} की किस्त ${days} दिनों से बकाया है. ` +
    `कुल बकाया राशि ${pending} है. ` +
    `हमने आपके व्हाट्सएप पर सुरक्षित पेमेंट लिंक भेजी है, कृपया जल्द से जल्द भुगतान करें. ` +
    `धन्यवाद, आपका दिन शुभ हो.`);
  return (
    `${DAYPART.en[daypart]}, ${c.name}. This is Asha calling from Sahakar Krishi Vikas Bank. ` +
    `Your loan installment of ${emi} is overdue by ${days} days. ` +
    `The total pending amount is ${pending}. ` +
    `We have sent a secure payment link to your WhatsApp; please pay at the earliest. ` +
    `Thank you, and have a good day.`);
}

async function tts(text, langCode) {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text], target_language_code: langCode, speaker: "anushka",
      model: process.env.MODEL || "bulbul:v2", pace: 0.85, speech_sample_rate: 22050,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.audios?.[0]) throw new Error(`Sarvam ${res.status}: ${body.error?.message ?? "tts failed"}`);
  return Buffer.from(body.audios[0], "base64");
}

fs.mkdirSync(path.resolve("public", "audio"), { recursive: true });
for (const loanId of loanIds) {
  const loan = db.loans.find((l) => l.loanId === loanId);
  const customer = loan && db.customers.find((c) => c.id === loan.customerId);
  if (!customer) { console.error(`skip ${loanId}: not found`); continue; }
  const lang = ["mr", "hi", "en"].includes(customer.preferredLanguage) ? customer.preferredLanguage : "hi";
  const langCode = { mr: "mr-IN", hi: "hi-IN", en: "en-IN" }[lang];
  for (const daypart of ["morning", "afternoon", "evening"]) {
    const text = script(lang, daypart, customer, loan);
    const wav = await tts(text, langCode);
    const out = path.resolve("public", "audio", `call-${loanId}-${daypart}.wav`);
    fs.writeFileSync(out, wav);
    console.log(`✅ ${path.basename(out)} (${(wav.length / 1024).toFixed(0)} KB, ${lang})`);
  }
}
console.log("\nCommit public/audio, push, and ensure AUDIO_BASE_URL is set (see .env.example).");
