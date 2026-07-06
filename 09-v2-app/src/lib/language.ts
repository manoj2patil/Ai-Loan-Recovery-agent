// src/lib/language.ts — Indic language detection + localization for the voice agent.
// Detection is script-based (each Indic script has a distinct Unicode block) so it is
// instant and needs no network — critical for mid-call language switching. Hindi and
// Marathi share Devanagari, so they are disambiguated with high-signal function words.
// Supported (matches the CBS data): bn, en, gu, hi, kn, ml, mr, pa, ta, te.

export type Lang = "bn" | "en" | "gu" | "hi" | "kn" | "ml" | "mr" | "pa" | "ta" | "te";

export const LANG_NAME: Record<Lang, string> = {
  bn: "Bengali", en: "English", gu: "Gujarati", hi: "Hindi", kn: "Kannada",
  ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ta: "Tamil", te: "Telugu",
};

const SCRIPT_RANGES: [number, number, Lang][] = [
  [0x0980, 0x09ff, "bn"],
  [0x0a00, 0x0a7f, "pa"],
  [0x0a80, 0x0aff, "gu"],
  [0x0b80, 0x0bff, "ta"],
  [0x0c00, 0x0c7f, "te"],
  [0x0c80, 0x0cff, "kn"],
  [0x0d00, 0x0d7f, "ml"],
  // Devanagari (0900-097F) is hi OR mr — resolved below.
];

// High-signal Marathi vs Hindi markers (function words / inflections rarely cross over).
const MR_MARKERS = ["आहे", "नाही", "नाहीये", "मी", "तुम्ही", "तुमच्या", "करतो", "करते", "म्हणून", "म्हणतो", "म्हटलं", "पाहिजे", "झालं", "झाला", "आता", "काय", "कधी", "जमेल", "जमणार", "भरतो", "भरेन", "पगार", "उद्या", "बघतो", "होईल", "ला", "च्या", " चे"];
const HI_MARKERS = ["है", "हैं", "नहीं", "मैं", "आप", "आपके", "करता", "करती", "क्योंकि", "कहा", "चाहिए", "हुआ", "अभी", "क्या", "कब", "पाऊँगा", "दूँगा", "करूँगा", "तनख्वाह", "कल", "देखता", "होगा", "को", "का", "के"];

function devanagariHiOrMr(text: string): Lang {
  let mr = 0, hi = 0;
  for (const m of MR_MARKERS) if (text.includes(m)) mr++;
  for (const m of HI_MARKERS) if (text.includes(m)) hi++;
  if (mr > hi) return "mr";
  if (hi > mr) return "hi";
  return "hi"; // tie / ambiguous → Hindi is the lingua franca default
}

/** Detect the dominant language of an utterance. Returns null when there is no clear signal
 *  (too short / punctuation only), so the caller can keep the current language. */
export function detectLanguage(text: string): Lang | null {
  if (!text) return null;
  const counts: Record<string, number> = {};
  let deva = 0, latin = 0, total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0900 && cp <= 0x097f) { deva++; total++; continue; }
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) { latin++; total++; continue; }
    for (const [lo, hi, lang] of SCRIPT_RANGES) {
      if (cp >= lo && cp <= hi) { counts[lang] = (counts[lang] ?? 0) + 1; total++; break; }
    }
  }
  if (total === 0) return null;
  // Pick the script with the most characters.
  let best: Lang | null = null, bestN = 0;
  for (const [lang, n] of Object.entries(counts)) if (n > bestN) { best = lang as Lang; bestN = n; }
  if (deva > bestN && deva >= latin) return devanagariHiOrMr(text);
  if (best && bestN >= latin) return best;
  if (latin > 0) return "en";
  return null;
}

// ---- localized strings for the rich WhatsApp payment message ----
export interface WaLabels {
  greet: (name: string) => string; accountDetails: string; acctNo: string; pending: string;
  emi: string; daysOverdue: (dpd: number, bucket: string) => string; nextDue: string;
  payBy: (date: string) => string; payHere: string; ifPaid: string; confirmDate: string;
  stop: string; days: string;
}

const WA: Partial<Record<Lang, WaLabels>> = {
  mr: {
    greet: (n) => `नमस्ते ${n} जी 🙏`, accountDetails: "*कर्ज खाते तपशील*", acctNo: "खाते क्र.",
    pending: "थकीत रक्कम", emi: "EMI", daysOverdue: (d, b) => `थकीत दिवस: ${d} दिवस (${b})`,
    nextDue: "पुढील देय तारीख", payBy: (d) => `⚠️ कृपया *${d}* पर्यंत भरणा करा.`,
    payHere: "💳 *भरणा करण्यासाठी*:", ifPaid: "✅ *भरणा झाला असेल तर*, UPI रेफरन्स आणि तारीख येथे पाठवा.",
    confirmDate: "पुढच्या भरण्याची तारीख कन्फर्म करण्यासाठी *DATE DD/MM* असे लिहा.",
    stop: "थांबवण्यासाठी STOP लिहा.", days: "दिवस",
  },
  hi: {
    greet: (n) => `नमस्ते ${n} जी 🙏`, accountDetails: "*ऋण खाता विवरण*", acctNo: "खाता सं.",
    pending: "बकाया राशि", emi: "EMI", daysOverdue: (d, b) => `बकाया दिन: ${d} दिन (${b})`,
    nextDue: "अगली देय तिथि", payBy: (d) => `⚠️ कृपया *${d}* तक भुगतान करें.`,
    payHere: "💳 *भुगतान करने के लिए*:", ifPaid: "✅ *यदि भुगतान हो चुका है*, तो UPI रेफरेंस और तारीख यहाँ भेजें.",
    confirmDate: "अगली भुगतान तिथि कन्फर्म करने के लिए *DATE DD/MM* लिखें.",
    stop: "रोकने के लिए STOP लिखें.", days: "दिन",
  },
  en: {
    greet: (n) => `Hello ${n} ji 🙏`, accountDetails: "*Loan Account Details*", acctNo: "A/C No.",
    pending: "Amount overdue", emi: "EMI", daysOverdue: (d, b) => `Days overdue: ${d} days (${b})`,
    nextDue: "Next due date", payBy: (d) => `⚠️ Please pay by *${d}*.`,
    payHere: "💳 *To pay*:", ifPaid: "✅ *If already paid*, send the UPI reference and date here.",
    confirmDate: "To confirm your next payment date, reply *DATE DD/MM*.",
    stop: "Reply STOP to opt out.", days: "days",
  },
};

/** WhatsApp labels for a language, falling back to Hindi then English. */
export function waLabels(lang: string): WaLabels {
  return WA[lang as Lang] ?? WA.hi ?? WA.en!;
}
