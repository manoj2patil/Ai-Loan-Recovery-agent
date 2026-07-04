# Full-Stack Production Technical Guide
## On-Premises AI Loan-Recovery Voice Agent — Built on Sarvam

**Scope:** a concrete, build-ready engineering guide for a production deployment. Covers the LLM brain (Sarvam), the serving engine, the real-time voice pipeline, the data and compliance layers, telephony, deployment topology, and hardware. Everything self-hostable, Apache-2.0/MIT, air-gap capable.

**Design rule that governs everything:** the ledger owns the *numbers*, the LLM owns the *language*, and the Compliance Gate owns the *permission to act*. The model never invents a balance and never contacts anyone without the gate's approval.

---

## 1. Production architecture at a glance

```
                         ┌──────────────────────────────────────┐
                         │   CORE BANKING SYSTEM (CBS)          │
                         │   loans · customers · guarantors     │
                         └──────────┬───────────────────────────┘
                                    │ CDC / triggers / webhooks
                                    ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ EVENT BUS (Kafka / Redis Streams)  ── EMI bounce, payment, NPA flip │
   └──────────┬──────────────────────────────────────────┬──────────────┘
              ▼                                            ▼
   ┌────────────────────────┐                  ┌────────────────────────────┐
   │ DATA LAYER             │                  │ COMPLIANCE GATE (service)  │
   │ PostgreSQL + pgvector  │◄────────────────►│ time-window, freq caps,    │
   │ MinIO (recordings)     │                  │ consent, suppression,      │
   └──────────┬─────────────┘                  │ notice clock, channel rules│
              │                                 └────────────┬───────────────┘
              ▼                                              │ allow / veto
   ┌────────────────────────────────────────────────────────▼───────────────┐
   │ AGENT ORCHESTRATOR (Pipecat / LiveKit Agents)                           │
   │  ┌─────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────────────┐  │
   │  │ VAD     │─►│ ASR          │─►│ LLM BRAIN   │─►│ TTS               │  │
   │  │ Silero  │  │ IndicConf.   │  │ Sarvam-30B  │  │ Indic Parler-TTS  │  │
   │  └─────────┘  │ (NeMo)       │  │ via SGLang  │  └───────────────────┘  │
   │               └──────┬───────┘  └─────────────┘                         │
   │                      ▼  language-ID (SpeechBrain ECAPA) → switch lang   │
   └──────────┬────────────────────────────────────────────┬───────────────┘
              ▼                                              ▼
   ┌────────────────────────┐                  ┌────────────────────────────┐
   │ TELEPHONY              │                  │ MESSAGING                  │
   │ Asterisk/FreePBX + SIP │                  │ WhatsApp Business API       │
   └────────────────────────┘                  │ (utility templates)         │
                                               └────────────────────────────┘
```

---

## 1A. Three build paths (decide this first)

There are three ways to build the voice layer. They share the same data/compliance backbone (sections 5–9); they differ only in who runs the speech+LLM stack.

| Path | What it is | Best when | Trade-off |
|---|---|---|---|
| **A — License Sarvam Samvaad** | Sarvam's managed conversational-agent platform; voice + WhatsApp + web, sub-500ms, CBS integration built in. Offered as **Cloud / Private-VPC / On-Prem air-gapped**. | You want fastest time-to-value and proven BFSI collections, and want to avoid latency engineering. | Licensing cost; less low-level control. |
| **B — Build with Sarvam cloud APIs** (this guide's voice layer) | LiveKit/Pipecat orchestration calling Sarvam APIs: **Saaras v3** STT, **sarvam-105b** LLM, **Bulbul v3** TTS, Silero VAD, Twilio telephony. | You want your own stack + flexibility but don't want to self-host models. | Cloud dependency (data leaves premises) unless VPC. |
| **C — Fully on-prem open-weight** (sections 2–4 below) | Self-host Sarvam open weights via SGLang + IndicConformer + Indic Parler-TTS + ECAPA LID. | Hard air-gap / data-residency mandate; no per-minute cost. | Most engineering; you own latency tuning. |

**Recommendation:** if a bank client mandates air-gap, evaluate **A (Samvaad On-Prem)** and **C**; otherwise pilot **B** (cookbook path) for speed, keeping **C** as the fallback if you must remove the cloud dependency. You can mix: build on B, swap the model layer to C later — the orchestration (LiveKit/Pipecat) stays the same.

### Sarvam cloud-API voice stack (Path B reference)
Mirrors Sarvam's official Collection-Agent cookbook (LiveKit) and Loan-Advisory cookbook (Pipecat):
- **STT:** `model="saaras:v3"`, `language="unknown"` → auto-detect + native code-mixing (this is your auto language switch; no separate LID needed).
- **LLM:** `model="sarvam-105b"` (drop to a smaller Sarvam model on the hot path if you need lower latency).
- **TTS:** `model="bulbul:v3"`, `speaker=<selected>` → see gender-voice logic in §4.4. Update `target_language_code` to match detected language.
- **VAD:** Silero (turn detection + barge-in).
- **Orchestration:** LiveKit Agents (`livekit-agents[sarvam,silero]`) or Pipecat (`pipecat-ai[daily,sarvam]`).
- **Telephony:** Twilio via LiveKit SIP (or Pipecat's Twilio transport). **WhatsApp:** Samvaad omnichannel or WhatsApp Business API; one agent brain, shared context across the Twilio voice line and the WhatsApp number.

> Whichever path: the call still runs through the **Compliance Gate** (§7), figures still come from the **ledger** (not the model), and every call is **recorded**.

---

## 2. The LLM brain — Sarvam

### 2.1 Why Sarvam, and which size where
Both Sarvam-30B and Sarvam-105B are **Apache-2.0 open weights** (Hugging Face: `sarvamai/sarvam-30b`, `sarvamai/sarvam-105b`; also on AI Kosh), trained end-to-end in India, covering the 22 scheduled Indian languages + English with native handling of code-mixed Hinglish. Use a **two-model split**:

| Role | Model | Why |
|---|---|---|
| **Real-time voice dialogue** (the hot path) | **Sarvam-30B** | MoE, ~2.4B active params, 32K context, tuned for conversational quality + low latency + reliable tool-calls in Indian languages. Fits a single 80 GB GPU at bf16, or a 24 GB GPU at 4-bit. |
| **Complex negotiation / multi-agent reasoning / batch analytics** (the cold path) | **Sarvam-105B** | MoE, ~10.3B active, 128K context, stronger agentic/reasoning. Runs tensor-parallel across ~4 GPUs. Invoke only for hard cases, not every call. |

**Practical rule:** 30B answers the call; 105B is escalated to for multi-turn settlement reasoning or when the 30B's confidence/guardrails flag a hard case. This keeps per-call latency and cost low.

### 2.2 What the brain is and isn't allowed to do
- **Allowed:** choose what to say, pick tone/language, decide the next conversational move, call tools (`get_loan_status`, `record_PTP`, `propose_offer`, `escalate_to_human`, `request_outreach` — the last always routes through the Compliance Gate).
- **Forbidden:** compute or state a balance/EMI from its own memory (always tool-fetched from the ledger), contact anyone directly, or offer terms outside the bank-approved matrix.

### 2.3 Quantization & precision
- **Production quality:** run **bf16** (or **FP8** where supported) on a datacenter GPU for best accuracy.
- **Cost/edge:** **Q4_K_M / Q8_0** quantized builds run the 30B on a single 24–32 GB GPU with minimal quality loss — useful for pilot nodes and the dev laptop.
- Keep KV-cache headroom: budget weights + ~15–20% for KV/activations.

---

## 3. LLM serving — the engine that runs Sarvam

### 3.1 Engine choice (in priority order for *this* workload)
1. **SGLang — primary.** It's the cleanest current path for the `sarvam_moe` architecture (the HF model cards ship SGLang examples), **and** its **RadixAttention prefix caching** is a direct win here: every recovery call reuses the same long system prompt + policy preamble, so SGLang reuses that cached computation instead of recomputing it (~29% throughput gain on shared-prefix workloads). For an agent with a fixed system prompt across thousands of calls, this is significant.
2. **vLLM — adopt when native Sarvam support lands.** vLLM is the broader production default (PagedAttention, widest hardware, simplest ops). As of early 2026 it needed Sarvam's fork or a patch; check whether the native-support PR has merged before standardising on it.
3. **TensorRT-LLM — for lowest latency once the model is frozen.** Best raw latency on NVIDIA, but requires per-model engine compilation and artifact management; adopt only after the model choice is final and you need the tightest voice-loop latency.

Avoid TGI (maintenance mode). Use Ollama/llama.cpp only for local dev — and note llama.cpp/Ollama support for `sarvam_moe` was still pending upstream merge in early 2026.

### 3.2 Reference SGLang launch (illustrative)
Serve the 30B as an OpenAI-compatible endpoint with tensor parallelism across 2 GPUs, radix (prefix) cache on:

```bash
python -m sglang.launch_server \
  --model-path sarvamai/sarvam-30b \
  --tp-size 2 \
  --dtype bfloat16 \
  --mem-fraction-static 0.80 \
  --trust-remote-code \
  --context-length 32768 \
  --host 0.0.0.0 --port 30000
# radix cache (prefix reuse) is on by default — keep it on for the shared system prompt
```

For Sarvam-105B, use `--tp-size 4` and a 128K context window on the cold-path node. Both expose `/v1/chat/completions`, so the orchestrator talks to them through a standard OpenAI-style client.

### 3.3 Serving configuration that matters in production
- **Continuous (in-flight) batching:** on by default in all three engines — the single biggest throughput unlock; new calls join the running batch as slots free.
- **Prefix caching:** put the entire static system prompt + compliance preamble + tool schema at the *front* of every request so the radix cache hits. Put per-call dynamic data (borrower facts) after it.
- **Streaming tokens:** enable token streaming so TTS can start speaking before the full reply is generated — critical for latency.
- **Concurrency / KV pressure:** size `mem-fraction-static` so the KV cache can hold your target concurrent calls; monitor and cap admitted requests to protect tail latency.
- **Structured output / tool-calls:** use the engine's JSON/structured-output mode for reliable tool invocation; validate every tool call before executing.
- **Two pools:** run the hot-path 30B pool and the cold-path 105B pool as separate services so a slow reasoning job never blocks a live call.

---

## 4. The real-time voice pipeline

Target end-to-end loop: **sub-800 ms** perceived (ASR partials < 100 ms, LLM TTFT low via streaming, TTS first-audio fast).

### 4.1 Components
| Stage | Component | Notes |
|---|---|---|
| Voice activity detection | **Silero VAD** | Lightweight; detects speech start/stop, enables barge-in. |
| ASR (speech→text) | **AI4Bharat IndicConformer 600M** (NeMo runtime) | All 22 Indian languages, MIT. Hybrid CTC/RNNT; use the **RNNT streaming** path for word-by-word partials < 100 ms, 10× faster / 3× less VRAM than encoder-decoder. Export via NeMo → ONNX/TensorRT (FP16) for throughput. Fine-tune on loan/banking vocabulary and regional accents. |
| Language ID | **SpeechBrain VoxLingua107 (ECAPA-TDNN)** + ASR's own per-utterance LID | Run continuously; on a stable language change, swap ASR target + TTS voice + LLM system-prompt language. Don't hard-switch on every code-mixed word — let Sarvam handle Hinglish natively. |
| LLM | **Sarvam-30B via SGLang** | See §2–3. |
| TTS (text→speech) | **AI4Bharat Indic Parler-TTS** (Apache-2.0) | 18+ Indian languages, emotion tags (`<happy>`/`<sad>`/`<anger>`/`<fear>`) → drives sentiment-adaptive tone. Alternates: **svara-TTS** (19 langs, voice cloning), **MeloTTS** (CPU fallback). Stream audio out chunk-by-chunk. |
| Orchestration | **Pipecat** or **LiveKit Agents** | Manage the STT→LLM→TTS loop, barge-in/interruption, turn detection, and SIP transport. LiveKit's SIP egress converts SIP↔WebRTC so a phone caller is just another session. |
| Telephony | **Asterisk / FreePBX** + Indian SIP trunk | Terminates PSTN/mobile; bridges into the media stack. Records every call (mandatory). |

### 4.2 Language auto-switch logic (mid-call)
1. ECAPA LID + ASR LID emit a language probability every ~1–2 s.
2. A debounce/hysteresis filter confirms a *sustained* switch (avoid flapping on a single English word).
3. On confirmed switch: set ASR decode language, select the matching TTS voice, and inject the language directive into the Sarvam system prompt for the next turn.
4. Log the switch event in the interaction record.

### 4.3 Sentiment-adaptive behaviour
A streaming speech-emotion model + text sentiment on the live transcript feed a policy layer. On detected distress/anger/hardship: soften the Parler-TTS emotion tag, slow pace, offer forbearance, or trigger human handoff — and flag a vulnerability marker for compliance.

### 4.4 Gender-matched voice selection
Match the agent voice to the borrower's gender (and satisfy the RBI expectation that female borrowers are handled by a female agent).

- **Primary method — from CBS data (recommended):** read the borrower's gender from the customer record and pick the voice *before the call*. Deterministic, no awkward mid-call change.
  - Bulbul v3 pools: **female speakers** (Ritu, Priya, Neha, Pooja, Kavya, Ishita, Shreya, Roopa, Tanya, Shruti, Suhani, Kavitha, Rupali, Simran) and **male speakers** (Shubh, Aditya, Anand, Rahul, Rohan, Amit, Dev, Tarun, Varun, …).
  - For open-weight Path C, hold an equivalent curated male/female voice set in Indic Parler-TTS and select the same way.
- **Fallback method — audio gender detection:** if CBS gender is missing, run a lightweight gender classifier on the borrower's first 1–2 turns, then set the voice. Use a debounce so the voice doesn't flip; avoid switching voice once the call is underway unless confidence is high.
- **Config:** keep a `voice_persona` map in `config_rule` → `{ "female": "<speaker>", "male": "<speaker>", "default": "<speaker>" }`, language-keyed. Selecting voice is independent of the spoken *language* (which auto-switches per §4.2), so a female persona stays female across a Hindi→Marathi switch — pick the matching-gender voice in the new language.

---

## 5. Data, memory & recordings layer

- **PostgreSQL** — operational store: customers, loans, installments, `loan_status` (Standard/Sub-standard/Doubtful/Loss + DPD), guarantors, and the auditable `interaction_log` (timestamp, channel, language, outcome, recording ref, gate decision).
- **pgvector** (on the same Postgres) or **Qdrant** — semantic memory: embeddings of past call transcripts so the agent recalls prior promises and context (RAG). Embed with a local multilingual embedding model.
- **MinIO** (S3-compatible, on-prem) — call recordings + documents, encrypted at rest, with **tiered retention** (e.g., 90/180 days hot, up to 7 years for litigation-track), exportable on inspection request.
- Mirror only the needed fields from CBS via read-only replica / CDC — never let AI workloads touch the live banking DB directly.

---

## 6. Event-driven triggers (your CBS advantage)

- CBS emits events via **change-data-capture / DB triggers / webhooks** onto **Kafka or Redis Streams**: `emi_bounced`, `payment_received`, `dpd_bucket_changed`, `npa_classified`, `cheque_returned`, `partial_payment`.
- A rules engine consumes events → asks the orchestrator to act → which asks the **Compliance Gate** for permission.
- First-class rule: `payment_received → immediately suppress all outreach` (never dun someone who just paid — compliance + reputation).

---

## 7. Compliance Gate (the authoritative veto)

A standalone service every outreach must pass through. It checks, per action:
- **Time window** 8:00 AM – 7:00 PM borrower-local; **frequency caps** + cool-downs (no bot siege).
- **Consent** on file for the channel (DPDP); **suppression flags** (bereavement/medical/festival).
- **30-day notice** clock elapsed before recovery-mode outreach.
- **Channel eligibility** — WhatsApp only for Utility reminders, not late-stage dunning.
- **Contact whitelist** — borrower + registered guarantor only; never third parties.
- **Recording on** for voice; **identity disclosure** as the fixed first turn.
Implement it as an agent/tool with hard veto power in the multi-agent layer, and log every decision.

---

## 8. Messaging layer

- **WhatsApp Business API** (Meta Cloud API / BSP) with pre-approved **Utility** templates: EMI-due reminder, payment confirmation, statement, with embedded UPI/payment links. Maintain Hindi + regional-language template versions.
- Optional **Chatwoot** for human agent inbox + handoff.
- All sends gated by §7.

---

## 9. Deployment topology

- **Containerised** (Docker) and orchestrated with **Kubernetes**; can run fully **air-gapped** (mirror model weights + packages internally).
- **Service separation:**
  - GPU node(s): SGLang-Sarvam-30B (hot pool), Sarvam-105B (cold pool), IndicConformer ASR, Parler-TTS, LID/emotion.
  - CPU node(s): telephony/media (Asterisk), orchestrator, Compliance Gate, event bus, APIs.
  - Data node(s): PostgreSQL (+ replica), MinIO, vector DB.
- **Observability:** Prometheus + Grafana (latency, GPU util, concurrent calls, WER), **Langfuse** for LLM tracing, and per-call QA on every recording.
- **Security:** network-segmented from CBS; least-privilege read-only CBS replica; secrets in Vault/HSM; encryption in transit + at rest.

---

## 10. Hardware (production)

Start at **Tier B** and scale GPUs horizontally.

**Tier B — production start (≈50–100 concurrent calls)**
- **GPU:** 2× NVIDIA A100 80 GB (or 2× H100). Allocation: GPU-0 runs **Sarvam-30B (bf16) via SGLang**; GPU-1 runs **ASR + TTS + LID + embeddings**. Add a 3rd–4th GPU (tp=4) when you need the **105B** cold pool live.
- **CPU:** 32–64 cores (dual EPYC/Xeon) — telephony media + ASR pre/post + DB are CPU-heavy.
- **RAM:** 256–512 GB.
- **Storage:** 4 TB NVMe (OS/DB/models, mirrored) + **20–50 TB** recording store (RAID-6, expandable; ~0.5–1 MB per audio-minute compressed).
- **Network:** 10 GbE internal, redundant SIP-trunk links.

**Tier C — scale / multi-tenant**
- 4–8× H100/H200 across nodes; K8s GPU autoscaling; separate telephony/inference/data nodes; 100 TB+ object store with tiered archival; DR site.

**Pilot note:** the 30B at Q4 runs on a single 24–32 GB GPU, so a one-box pilot (1× RTX 5090 / L40S) can validate the full loop before Tier B.

---

## 11. Latency budget (target per turn)

| Stage | Target |
|---|---|
| VAD + endpointing | ~20–50 ms |
| ASR streaming partial | < 100 ms |
| LLM time-to-first-token (Sarvam-30B, streaming) | ~150–300 ms |
| TTS first audio chunk | ~100–200 ms |
| **Perceived response** | **< 800 ms** |

Keep models local on GPU, stream at every stage, and enable barge-in so the borrower can interrupt naturally.

### 11.1 Anti-lag checklist (build streaming-first — this prevents the 10–15s lag)
A 10–15 second gap means the pipeline is **non-streaming / request-response**. Sarvam's own stack targets sub-500ms; the target here is **0.5–1.5s per turn**. Enforce all of these:

- [ ] **Streaming orchestration** — use LiveKit Agents or Pipecat. Never a hand-rolled "record → POST audio → await full text → await full LLM → await full TTS → play" loop.
- [ ] **Streaming STT** — consume partial transcripts as the borrower speaks; don't wait for the whole utterance to be uploaded.
- [ ] **Streaming LLM** — token-by-token; start TTS on the first sentence/clause, don't wait for the full completion.
- [ ] **Streaming TTS** — play audio chunks as they're synthesized; don't generate a whole WAV before playback.
- [ ] **Fast endpointing (VAD)** — Silero turn detection so "borrower stopped" is decided in ~200–300ms, not on a long silence timeout.
- [ ] **Barge-in enabled** — borrower can interrupt; agent stops speaking immediately.
- [ ] **Right-sized hot-path model** — smaller model = lower time-to-first-token; reserve the 105B/cold path for hard cases only.
- [ ] **Prefix caching on** — static system prompt cached (SGLang radix / provider equivalent) so it isn't recomputed each turn.
- [ ] **Network locality** — keep STT/LLM/TTS in-region (or on-prem); avoid cross-continent API round-trips and cold starts.
- [ ] **Warm pools** — keep model workers warm; no per-call cold start.
- [ ] **Telephony codec/buffer tuning** — minimise jitter-buffer and transcode delay on the Twilio/SIP leg.

**Common root causes → fix**
| Symptom | Likely cause | Fix |
|---|---|---|
| 10–15s before agent replies | Fully sequential, non-streaming pipeline | Adopt LiveKit/Pipecat streaming (above) |
| Long pause after borrower stops | VAD silence-timeout too high / no endpointing | Silero turn detection, tune endpoint silence to ~300–500ms |
| Agent talks over borrower / can't be interrupted | No barge-in | Enable VAD-driven interruption |
| First reply slow, later ones ok | Cold start | Warm worker pool, keep-alive |
| Consistent ~1–2s overhead | Distant API region | Move in-region / on-prem; enable prefix cache |

---

## 12. Build order (maps to phases)

1. Data layer + NPA engine + Compliance Gate (no outreach yet).
2. CBS event bus + suppression rules.
3. WhatsApp utility reminders (gated).
4. Voice pipeline: IndicConformer + Sarvam-30B (SGLang) + Parler-TTS + Asterisk; 2–3 languages; recording on.
5. Language auto-switch + sentiment-adaptive tone.
6. Guarantor escalation + PTP + human handoff.
7. Cold-path Sarvam-105B + multi-agent negotiation (Compliance Gate as veto agent).
8. Analytics, auto-QA, A/B testing, multi-tenancy.

---

### One-line stack summary
**Sarvam-30B (Apache-2.0) on SGLang** for the live voice brain, **Sarvam-105B** for hard reasoning, **IndicConformer** ASR, **Indic Parler-TTS**, **SpeechBrain ECAPA** language-ID, **Pipecat/LiveKit + Asterisk** for telephony, **PostgreSQL/pgvector/MinIO** for data, a **Kafka/Redis** CBS event bus, and a **Compliance Gate** vetoing every action — containerised, air-gap-capable, on 2× A100 80 GB to start.
