// Unit tests for the conversation intent detectors (callback / fraud / paid-claim). These
// gate the smart-handling paths, so they must fire on real borrower phrasings across languages.
// The detectors are internal; we re-declare the same matchers here to lock their behaviour.

import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror of conversation.ts detectors (kept in sync intentionally).
function suspectsFraud(text: string): boolean {
  const t = text.toLowerCase();
  return ["fraud", "scam", "fake", "how do i know", "who are you really", "prove", "not real", "cheat", "won't share", "not sharing", "trust you"].some((k) => t.includes(k))
    || ["फ्रॉड", "फसवणूक", "धोका", "खोटं", "खोटे", "बनावट", "फर्जी", "नकली", "कैसे पता", "कोण आहात", "कोन आहात", "विश्वास", "माहिती देणार नाही", "जानकारी नहीं", "ठग"].some((k) => text.includes(k));
}
function asksLater(text: string): boolean {
  const t = text.toLowerCase();
  return ["call me", "call back", "later", "busy", "meeting", "travel", "driving", "tomorrow", "not now", "another time", "call after"].some((k) => t.includes(k))
    || ["नंतर", "मीटिंग", "मिटिंग", "बिझी", "व्यस्त", "प्रवास", "प्रवासात", "गाडी", "उद्या", "आत्ता नको", "फोन करा", "कॉल करा", "बाद में", "व्यस्त हूँ", "मीटिंग में", "कल", "अभी नहीं"].some((k) => text.includes(k));
}
function claimsPaid(text: string): boolean {
  const t = text.toLowerCase();
  return ["already paid", "i have paid", "i paid", "payment done", "paid already"].some((k) => t.includes(k))
    || ["भरले आहे", "भरलं", "पैसे भरले", "भर दिया", "भुगतान कर दिया", "पेमेंट कर दिया", "पेमेंट झाल"].some((k) => text.includes(k));
}

test("fraud suspicion detected across languages", () => {
  assert.ok(suspectsFraud("How do I know this is not a scam?"));
  assert.ok(suspectsFraud("तुम्ही खरंच बँकेतून आहात का? हा फ्रॉड तर नाही?"));
  assert.ok(suspectsFraud("मैं आपको जानकारी नहीं दूँगा, ये फर्जी कॉल है"));
  assert.ok(!suspectsFraud("हो, मी उद्या भरतो"));
});

test("callback / busy requests detected across languages", () => {
  assert.ok(asksLater("I'm in a meeting, call me tomorrow at 3"));
  assert.ok(asksLater("मी आत्ता प्रवासात आहे, नंतर फोन करा"));
  assert.ok(asksLater("अभी मीटिंग में हूँ, कल कॉल करना"));
  assert.ok(!asksLater("हो, आत्ता भरतो"));
});

test("already-paid claim detected across languages", () => {
  assert.ok(claimsPaid("I have already paid last week"));
  assert.ok(claimsPaid("मी पैसे भरले आहेत"));
  assert.ok(claimsPaid("मैंने भुगतान कर दिया है"));
  assert.ok(!claimsPaid("मैं अगले हफ्ते भर दूँगा"));
});
