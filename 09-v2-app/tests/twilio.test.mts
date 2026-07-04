// Unit tests for the Twilio dispatch helpers — the VOICE LESSONS encoded as assertions:
// <Play>-only TwiML (never <Say>), XML escaping, env-driven mode switching.

import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.GREETING_AUDIO_URL;
delete process.env.MEDIA_STREAM_WSS;

const { escapeXml, smokeTwiml, twilioConfigured } = await import("../src/lib/twilio");

test("escapeXml handles the TwiML-killing characters", () => {
  assert.equal(escapeXml("a&b<c>\"d'"), "a&amp;b&lt;c&gt;&quot;d&apos;");
});

test("TwiML never contains <Say> (VOICE LESSON 2)", () => {
  process.env.GREETING_AUDIO_URL = "https://host/greet.mp3?a=1&b=2";
  const xml = smokeTwiml();
  assert.ok(!xml.includes("<Say"), "must never use <Say>");
  assert.ok(xml.includes("<Play>"), "greeting must use <Play>");
  assert.ok(xml.includes("&amp;"), "URL ampersands must be escaped");
  delete process.env.GREETING_AUDIO_URL;
});

test("TwiML upgrades to Media Streams when the bridge is configured", () => {
  process.env.MEDIA_STREAM_WSS = "wss://bridge/stream";
  const xml = smokeTwiml();
  assert.ok(xml.includes("<Connect><Stream"), "media-streams path");
  delete process.env.MEDIA_STREAM_WSS;
});

test("bare smoke TwiML is a valid pause+hangup", () => {
  const xml = smokeTwiml();
  assert.ok(xml.includes("<Pause") && xml.includes("<Hangup/>"));
});

test("dispatch mode is env-driven (unset = simulated)", () => {
  assert.equal(twilioConfigured(), false);
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  assert.equal(twilioConfigured(), true);
  delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM_NUMBER;
});
