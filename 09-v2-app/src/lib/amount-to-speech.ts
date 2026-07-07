// src/lib/amount-to-speech.ts — VOICE LESSON: convert amounts to NATIVE WORDS before TTS,
// or Bulbul reads "38,000" in English/awkwardly. Indian numbering (hundred/thousand/lakh/
// crore) for hi/mr/en. Loan amounts are integers of rupees.

// 0–99 word tables (compounds are irregular in Indic — must be explicit).
const HI = ("शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस " +
  "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस " +
  "चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ " +
  "साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी " +
  "अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे").split(/\s+/);

const MR = ("शून्य एक दोन तीन चार पाच सहा सात आठ नऊ दहा अकरा बारा तेरा चौदा पंधरा सोळा सतरा अठरा एकोणीस " +
  "वीस एकवीस बावीस तेवीस चोवीस पंचवीस सव्वीस सत्तावीस अठ्ठावीस एकोणतीस तीस एकतीस बत्तीस तेहतीस चौतीस पस्तीस छत्तीस सदतीस अडतीस एकोणचाळीस " +
  "चाळीस एक्केचाळीस बेचाळीस त्रेचाळीस चव्वेचाळीस पंचेचाळीस सेहेचाळीस सत्तेचाळीस अठ्ठेचाळीस एकोणपन्नास पन्नास एक्कावन्न बावन्न त्रेपन्न चोपन्न पंचावन्न छप्पन्न सत्तावन्न अठ्ठावन्न एकोणसाठ " +
  "साठ एकसष्ठ बासष्ठ त्रेसष्ठ चौसष्ठ पासष्ठ सहासष्ठ सदुसष्ठ अडुसष्ठ एकोणसत्तर सत्तर एक्काहत्तर बाहत्तर त्र्याहत्तर चौऱ्याहत्तर पंच्याहत्तर शहात्तर सत्याहत्तर अठ्ठ्याहत्तर एकोणऐंशी " +
  "ऐंशी एक्क्याऐंशी ब्याऐंशी त्र्याऐंशी चौऱ्याऐंशी पंच्याऐंशी शहाऐंशी सत्त्याऐंशी अठ्ठ्याऐंशी एकोणनव्वद नव्वद एक्क्याण्णव ब्याण्णव त्र्याण्णव चौऱ्याण्णव पंच्याण्णव शहाण्णव सत्त्याण्णव अठ्ठ्याण्णव नव्व्याण्णव").split(/\s+/);

const EN = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
  "twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one thirty-two thirty-three thirty-four thirty-five thirty-six thirty-seven thirty-eight thirty-nine " +
  "forty forty-one forty-two forty-three forty-four forty-five forty-six forty-seven forty-eight forty-nine fifty fifty-one fifty-two fifty-three fifty-four fifty-five fifty-six fifty-seven fifty-eight fifty-nine " +
  "sixty sixty-one sixty-two sixty-three sixty-four sixty-five sixty-six sixty-seven sixty-eight sixty-nine seventy seventy-one seventy-two seventy-three seventy-four seventy-five seventy-six seventy-seven seventy-eight seventy-nine " +
  "eighty eighty-one eighty-two eighty-three eighty-four eighty-five eighty-six eighty-seven eighty-eight eighty-nine ninety ninety-one ninety-two ninety-three ninety-four ninety-five ninety-six ninety-seven ninety-eight ninety-nine").split(/\s+/);

interface Words { t: string[]; crore: string; lakh: string; thousand: string; hundredPrefix: (h: number) => string; rupees: string; and: string }

const MR_HUNDREDS = ["", "एकशे", "दोनशे", "तीनशे", "चारशे", "पाचशे", "सहाशे", "सातशे", "आठशे", "नऊशे"];

const LANGS: Record<string, Words> = {
  hi: { t: HI, crore: "करोड़", lakh: "लाख", thousand: "हज़ार", hundredPrefix: (h) => `${HI[h]} सौ`, rupees: "रुपये", and: "" },
  mr: { t: MR, crore: "कोटी", lakh: "लाख", thousand: "हजार", hundredPrefix: (h) => MR_HUNDREDS[h], rupees: "रुपये", and: "" },
  en: { t: EN, crore: "crore", lakh: "lakh", thousand: "thousand", hundredPrefix: (h) => `${EN[h]} hundred`, rupees: "rupees", and: "" },
};

/** Spell a rupee amount in the target language using Indian numbering. */
export function amountToWords(amount: number, lang: string): string {
  const W = LANGS[lang] ?? LANGS.hi;
  let n = Math.max(0, Math.round(amount));
  if (n === 0) return `${W.t[0]} ${W.rupees}`;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${W.t[crore] ?? crore} ${W.crore}`);
  if (lakh) parts.push(`${W.t[lakh]} ${W.lakh}`);
  if (thousand) parts.push(`${W.t[thousand]} ${W.thousand}`);
  if (hundred) parts.push(W.hundredPrefix(hundred));
  if (n) parts.push(W.t[n]);
  return `${parts.join(" ")} ${W.rupees}`.replace(/\s+/g, " ").trim();
}

/** "45 days" → native words for the day count (no currency). */
export function daysToWords(days: number, lang: string): string {
  const W = LANGS[lang] ?? LANGS.hi;
  const n = Math.max(0, Math.round(days));
  if (n <= 99) return W.t[n];
  // 100–999 day counts: hundreds + remainder
  const h = Math.floor(n / 100), r = n % 100;
  return `${W.hundredPrefix(h)}${r ? " " + W.t[r] : ""}`.trim();
}
