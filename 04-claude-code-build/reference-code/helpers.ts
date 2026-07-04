// lib/amount-to-speech.ts — convert rupee amounts to native words for natural TTS.
// LESSON: digits read awkwardly on calls; speak words. Extend the maps per language.
// 228000 → "दोन लाख अठ्ठावीस हजार रुपये" (mr) / "दो लाख अट्ठाईस हज़ार रुपये" (hi)

type Lang = "hi-IN" | "mr-IN" | "en-IN" | string;

// TODO: complete 0–99 word maps for hi + mr (compound numbers: अठ्ठावीस, एकोणतीस, …).
const ONES: Record<string, string[]> = {
  hi: ["शून्य","एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ"],
  mr: ["शून्य","एक","दोन","तीन","चार","पाच","सहा","सात","आठ","नऊ"],
};

export function amountToSpeech(amount: number, lang: Lang = "hi-IN"): string {
  const l = lang.slice(0, 2);
  if (l === "en") return `${amount.toLocaleString("en-IN")} rupees`;
  // Indian system: crore, lakh, thousand, hundred. TODO: full word composition.
  const lakh = Math.floor(amount / 100000);
  const rem = amount % 100000;
  const thousand = Math.floor(rem / 1000);
  const hundredsPart = rem % 1000;
  const word = (n: number) => twoDigitWords(n, l);
  const parts: string[] = [];
  if (lakh) parts.push(`${word(lakh)} ${l === "mr" ? "लाख" : "लाख"}`);
  if (thousand) parts.push(`${word(thousand)} ${l === "mr" ? "हजार" : "हज़ार"}`);
  if (hundredsPart) parts.push(`${word(hundredsPart)}`); // TODO hundreds composition
  parts.push(l === "mr" ? "रुपये" : "रुपये");
  return parts.join(" ");
}

function twoDigitWords(n: number, l: string): string {
  // TODO: real compound-number maps. Placeholder: digit-by-digit.
  const ones = ONES[l] ?? ONES.hi;
  return String(n).split("").map((d) => ones[Number(d)]).join(" ");
}

// ---------------------------------------------------------------------------
// lib/language.ts — explicit language-switch detection + anti-Hindi bias guard.

const SWITCH_PATTERNS: { re: RegExp; to: string }[] = [
  { re: /हिंदी|hindi/i, to: "hi-IN" },
  { re: /english|इंग्लिश|इंग्रजी/i, to: "en-IN" },
  { re: /मराठी|marathi/i, to: "mr-IN" },
  { re: /தமிழ்|tamil/i, to: "ta-IN" },
  { re: /తెలుగు|telugu/i, to: "te-IN" },
  // TODO: kn, ml, gu, pa, bn, od
];

/** Returns a target language code if the borrower explicitly asked to switch, else null. */
export function detectExplicitLanguageRequest(text: string): string | null {
  for (const p of SWITCH_PATTERNS) if (p.re.test(text)) return p.to;
  return null;
}

/** Anti-Hindi-bias: if ASR returns Hindi but the borrower's preferred/Devanagari context is
 *  Marathi, keep Marathi unless an explicit Hindi request was made. */
export function resolveLanguage(detected: string, preferred: string, lastText: string): string {
  const explicit = detectExplicitLanguageRequest(lastText);
  if (explicit) return explicit;
  if (detected === "hi-IN" && preferred === "mr-IN") return "mr-IN"; // guard
  return detected || preferred;
}
