// src/lib/audio-cache.ts — tiny in-memory TTS cache shared between the turn webhook
// (which generates each reply's audio) and the /api/voice/tts route (which streams it to
// Twilio). Entries are short-lived; a call plays each clip once. Single-instance only —
// back with Redis/object storage when clustering.

const CACHE = new Map<string, { buf: Buffer; at: number }>();
const TTL_MS = 5 * 60_000;

export function putAudio(buf: Buffer): string {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  CACHE.set(id, { buf, at: Date.now() });
  // opportunistic GC
  const cut = Date.now() - TTL_MS;
  for (const [k, v] of CACHE) if (v.at < cut) CACHE.delete(k);
  return id;
}

export function getAudio(id: string): Buffer | null {
  return CACHE.get(id)?.buf ?? null;
}
