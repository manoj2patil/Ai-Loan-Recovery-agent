// Generate the outbound-call greeting with Sarvam Bulbul TTS and save it where Twilio
// can play it. VOICE LESSONS applied: speaker anushka, pace ~0.8, no digits in the text.
//
// Usage:
//   SARVAM_API_KEY=sk_... node scripts/generate-greeting.mjs [lang]
//   lang: mr (default) | hi | en
//
// Output: public/audio/greeting-<lang>.wav  → commit + push, then set
//   GREETING_AUDIO_URL=https://raw.githubusercontent.com/<owner>/<repo>/main/09-v2-app/public/audio/greeting-<lang>.wav
// (or serve from your own APP_URL/audio/... in production — public/ is Next's static dir).

import fs from "node:fs";
import path from "node:path";

const KEY = process.env.SARVAM_API_KEY;
if (!KEY) { console.error("Set SARVAM_API_KEY (from dashboard.sarvam.ai → API Keys)"); process.exit(1); }

const TEXTS = {
  mr: "नमस्कार, मी सहकार कृषी विकास बँकेकडून आरव बोलतोय. तुमच्या कर्जाचा हप्ता थकीत आहे. आम्ही तुमच्या व्हॉट्सॲपवर सुरक्षित पेमेंट लिंक पाठवली आहे. कृपया लवकरात लवकर भरणा करा. धन्यवाद, तुमचा दिवस शुभ असो.",
  hi: "नमस्ते, मैं सहकार कृषि विकास बैंक से आरव बोल रहा हूँ. आपके ऋण की किस्त बकाया है. हमने आपके व्हाट्सएप पर सुरक्षित पेमेंट लिंक भेजी है. कृपया जल्द से जल्द भुगतान करें. धन्यवाद, आपका दिन शुभ हो.",
  en: "Hello, this is Aarav calling from Sahakar Krishi Vikas Bank. Your loan installment is overdue. We have sent a secure payment link to your WhatsApp. Please pay at the earliest. Thank you, and have a good day.",
};

const lang = process.argv[2] || "mr";
if (!TEXTS[lang]) { console.error("lang must be mr | hi | en"); process.exit(1); }
const langCode = { mr: "mr-IN", hi: "hi-IN", en: "en-IN" }[lang];

// bulbul:v2 is the widely-available model id; if your account has v3, pass MODEL=bulbul:v3.
const model = process.env.MODEL || "bulbul:v2";

const res = await fetch("https://api.sarvam.ai/text-to-speech", {
  method: "POST",
  headers: { "api-subscription-key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    inputs: [TEXTS[lang]],
    target_language_code: langCode,
    speaker: "anushka",
    model,
    pace: 0.85,
    speech_sample_rate: 22050,
  }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.audios?.[0]) {
  console.error(`Sarvam TTS failed (HTTP ${res.status}):`, body.error?.message ?? body);
  process.exit(1);
}

const out = path.resolve("public", "audio", `greeting-${lang}.wav`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(body.audios[0], "base64"));
console.log(`✅ wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
console.log("\nNext steps:");
console.log("  git add public/audio && git commit -m 'greeting audio' && git push");
console.log(`  # then in .env:`);
console.log(`  GREETING_AUDIO_URL=https://raw.githubusercontent.com/manoj2patil/Ai-Loan-Recovery-agent/main/09-v2-app/public/audio/greeting-${lang}.wav`);
