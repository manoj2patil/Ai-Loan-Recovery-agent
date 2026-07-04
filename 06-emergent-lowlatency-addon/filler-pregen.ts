// filler-pregen.ts — Pre-generate ALL filler phrases once at startup and warm the TTS cache.
// Run at media-server boot so onUserFinalTranscript can play a filler with ~0ms synthesis.

import fillers from "./fillers.json";
import { ttsSynthesize } from "./sarvam-streaming";

export async function pregenFillers() {
  const groups = [ (fillers as any).neutral, (fillers as any).empathetic ];
  const sig = new AbortController().signal;
  let n = 0;
  for (const group of groups) {
    for (const lang of Object.keys(group)) {
      for (const phrase of group[lang]) {
        try { await ttsSynthesize(phrase, lang, sig, 8000); n++; }  // fills the cache
        catch (e) { console.error("filler pregen failed", lang, phrase, e); }
      }
    }
  }
  console.log(`pregenerated ${n} filler clips`);
}

// Call this in media-stream-server.ts before accepting connections:
//   await pregenFillers();
