// Unit tests for Indic language detection (mid-call switch relies on this being right).

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "../src/lib/language";

test("detects each Indic script", () => {
  assert.equal(detectLanguage("হ্যাঁ, আমি দিচ্ছি"), "bn");           // Bengali
  assert.equal(detectLanguage("હા, હું ચૂકવીશ"), "gu");             // Gujarati
  assert.equal(detectLanguage("ஆம், நான் செலுத்துகிறேன்"), "ta");   // Tamil
  assert.equal(detectLanguage("అవును, నేను చెల్లిస్తాను"), "te");    // Telugu
  assert.equal(detectLanguage("ಹೌದು, ನಾನು ಪಾವತಿಸುತ್ತೇನೆ"), "kn");  // Kannada
  assert.equal(detectLanguage("അതെ, ഞാൻ അടയ്ക്കാം"), "ml");        // Malayalam
  assert.equal(detectLanguage("ਹਾਂ, ਮੈਂ ਭੁਗਤਾਨ ਕਰਾਂਗਾ"), "pa");    // Punjabi
  assert.equal(detectLanguage("Yes, I will pay tomorrow"), "en");   // English
});

test("disambiguates Hindi vs Marathi (both Devanagari)", () => {
  assert.equal(detectLanguage("हाँ, मैं कल भुगतान कर दूँगा"), "hi");
  assert.equal(detectLanguage("हो, मी उद्या नक्की भरतो"), "mr");
  assert.equal(detectLanguage("माझा पगार उशिरा झाला आहे"), "mr");
  assert.equal(detectLanguage("मेरी तनख्वाह लेट हो गई है"), "hi");
});

test("returns null on no-signal input (keep current language)", () => {
  assert.equal(detectLanguage(""), null);
  assert.equal(detectLanguage("... ??? !!!"), null);
});

test("mid-call switch scenario: Hindi turn then Marathi turn", () => {
  // mirrors the real Samvaad log: borrower drifts Hindi -> Marathi
  assert.equal(detectLanguage("नहीं, अभी नहीं कर सकता हूँ"), "hi");
  assert.equal(detectLanguage("नाही, आता ऑफिसात मीटिंग आहे"), "mr");
});
