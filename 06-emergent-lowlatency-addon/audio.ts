// audio.ts — G.711 μ-law <-> 16-bit PCM and 8k<->16k resampling for Twilio Media Streams.
// Twilio sends/expects 8kHz μ-law mono. Sarvam ASR wants 16kHz PCM; TTS returns PCM.

const BIAS = 0x84;
const CLIP = 32635;

export function muLawDecodeSample(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

export function muLawEncodeSample(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Twilio μ-law bytes (8kHz) → Int16 PCM (8kHz). */
export function muLawToPcm(mu: Uint8Array): Int16Array {
  const out = new Int16Array(mu.length);
  for (let i = 0; i < mu.length; i++) out[i] = muLawDecodeSample(mu[i]);
  return out;
}

/** Int16 PCM (8kHz) → Twilio μ-law bytes (8kHz). */
export function pcmToMuLaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = muLawEncodeSample(pcm[i]);
  return out;
}

/** Upsample 8kHz → 16kHz (linear interpolation) for ASR. */
export function upsample8to16(pcm8: Int16Array): Int16Array {
  const out = new Int16Array(pcm8.length * 2);
  for (let i = 0; i < pcm8.length; i++) {
    const a = pcm8[i];
    const b = i + 1 < pcm8.length ? pcm8[i + 1] : a;
    out[i * 2] = a;
    out[i * 2 + 1] = (a + b) >> 1;
  }
  return out;
}

/** Downsample 16kHz → 8kHz (drop every other sample) for Twilio playback. */
export function downsample16to8(pcm16: Int16Array): Int16Array {
  const out = new Int16Array(Math.floor(pcm16.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = pcm16[i * 2];
  return out;
}

/** Wrap raw 16-bit PCM in a minimal WAV container (for the batch STT upload). */
export function pcmToWav(pcm: Int16Array, sampleRate = 16000): Buffer {
  const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);            // PCM
  header.writeUInt16LE(1, 22);            // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

/** Simple energy VAD for endpointing. Returns true if the frame is "speech". */
export function isSpeech(pcm: Int16Array, threshold = 500): boolean {
  let sum = 0;
  for (const s of pcm) sum += Math.abs(s);
  return sum / (pcm.length || 1) > threshold;
}
