# On-Premises AI Agent for CBS Loan Recovery — Detailed Build Plan

**Audience:** CBS vendor building an on-premises (air-gapped capable) AI collections/recovery agent for bank & NBFC customers in India.
**Deployment model:** Self-hosted, open-source-first, data never leaves the bank's perimeter.

---

## 0. Read this first — the compliance frame that shapes the whole design

Before any architecture, understand that in India a loan-recovery agent is one of the most heavily regulated software categories you can build. The RBI rules are not optional features — they are hard constraints that must be enforced *in code*, because "the buck stops with the Regulated Entity." If your agent misbehaves, the bank is penalised, and you (the vendor) lose the contract.

Non-negotiable rules to bake into the engine:

| Rule | Implementation requirement |
|---|---|
| **Contact window 8:00 AM – 7:00 PM only** | A hard scheduler gate. No call/voice/WhatsApp campaign message can be dispatched outside this window. Respect the borrower's local time. |
| **No third-party contact** (relatives, friends, neighbours, employer) — **only the borrower and the registered guarantor** | Contact list must be locked to verified borrower + guarantor records. No contact harvesting, ever. |
| **Female borrowers** | Latest RBI conduct rules require female borrowers be handled appropriately; for a voice agent, default to a female voice persona and flag for female human agents on escalation. |
| **30-day written notice** before assigning a recovery agent | The system tracks notice issuance and blocks "recovery mode" until the notice clock has elapsed. |
| **Identity disclosure within ~30 seconds** | Every call must open by stating the agent's name, the lender's name, and the call's purpose. RBI inspectors test this on randomly pulled recordings, so make it the fixed first turn of every voice script. |
| **Right-Party Contact (RPC) verification** | Before discussing any debt, confirm you are speaking to the actual borrower/guarantor (e.g. verify DOB, PIN code, or last digits of an ID). Discussing the loan with the wrong person is a privacy breach. This is standard in every serious collections product. |
| **Mandatory recording** of every interaction (call, message, visit), with **tiered retention** | Record + transcribe every call; store on Indian servers. Typical retention: 90 days minimum, 180 days as common internal policy, up to 7 years for litigation-track loans. Build tiered retention + export-on-demand for inspection requests. This is also your audit defence. |
| **No "digital bot siege"** — repeated automated calls (e.g. every 15 min) are explicitly illegal | Enforce per-borrower frequency caps and cool-down periods. |
| **AI "agent training" evidence** | RBI requires human recovery agents to complete ~100-hour training + IIBF certification. There is no formal AI-agent certification yet, but inspectors increasingly ask for the equivalent: documented script training, scenario coverage, and escalation handling. Produce and version this documentation as a deliverable. |
| **Calamitous timing / empathy** | Allow suppression flags (bereavement, medical emergency, festival) that pause all outreach. |
| **Responsible Business Conduct (2nd Amendment) Directions** | Effective 1 July 2026 — strengthens agent-conduct and escalation rules; design must be configurable to absorb tightening rules. |

**WhatsApp-specific catch (critical):** Meta's Business Messaging Policy lists *debt collection* as a restricted/prohibited category, while *payment reminders* fall under the permitted **Utility** template category. Practical consequence: the WhatsApp channel can be used for due-date reminders, statements, and repayment-support — **not** for aggressive late-stage delinquency messaging. Late-stage recovery must route to compliant voice/human channels, not WhatsApp templates.

**Data protection:** The Digital Personal Data Protection (DPDP) Act applies. You need explicit, timestamped consent per channel, India-based data storage, purpose limitation, and an easy opt-out. On-prem deployment helps you meet data-residency obligations cleanly.

> Design principle: every outreach action passes through a **Compliance Gate** service that can veto it. The AI never contacts anyone directly — it requests permission from the gate, which checks time-of-day, frequency caps, consent, suppression flags, notice status, and channel-eligibility before allowing dispatch.

---

## 1. High-level architecture

A layered design keeps the AI replaceable and the compliance layer authoritative.

```
                ┌─────────────────────────────────────────────────────┐
                │            BANK CORE BANKING SYSTEM (CBS)             │
                │   Loans · Customers · Guarantors · Repayment ledger   │
                └───────────────┬─────────────────────────────────────┘
                                │  (read via secure API / DB views / ETL)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       LOAN-RECOVERY DATA LAYER                             │
│  PostgreSQL (operational)  ·  Vector DB (history/RAG)  ·  Object store      │
│  (call recordings, docs)                                                   │
└───────────────┬───────────────────────────────────────┬──────────────────┘
                │                                         │
                ▼                                         ▼
┌───────────────────────────────┐         ┌──────────────────────────────────┐
│   DELINQUENCY / NPA ENGINE     │         │      COMPLIANCE GATE SERVICE      │
│  classifies overdue, computes  │◄───────►│  time window, frequency caps,     │
│  dues, NPA/Sub-standard, due   │         │  consent, suppression, notice,    │
│  dates, guarantor linkage      │         │  channel eligibility, recording   │
└───────────────┬───────────────┘         └──────────────┬───────────────────┘
                │                                          │ (allow / veto)
                ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    AI ORCHESTRATION LAYER (the "agent")                    │
│  LLM brain (reasoning, dialogue, decisions) + tool-calling + RAG memory    │
│  Decides WHAT to say/do; never bypasses the Compliance Gate                │
└───────┬──────────────────────────┬──────────────────────────┬─────────────┘
        ▼                          ▼                          ▼
┌────────────────┐     ┌──────────────────────────┐   ┌─────────────────────┐
│  WHATSAPP       │     │  VOICE-CALLING PIPELINE   │   │  HUMAN AGENT         │
│  channel        │     │  ASR → LLM → TTS over SIP │   │  handoff / dashboard │
│  (utility tmpl) │     │  multilingual, auto-switch│   │  (live takeover)     │
└────────────────┘     └──────────────────────────┘   └─────────────────────┘
```

---

## 2. Requirement-by-requirement design

### Req 1 & 4 — Track every loan, customer details, dues, status, due date, guarantor

This is your **Loan-Recovery Data Layer**, fed from the CBS. Do **not** make the AI query the CBS directly; replicate the needed fields into a recovery-side store (PostgreSQL) via a read-only API or nightly + intraday ETL. This isolates the production banking system from AI workloads.

Core schema (operational tables):

- **customer**: customer_id, name, masked identifiers (KYC ref, not raw Aadhaar), preferred_language, phone(s) verified, address, consent records (per channel, with timestamp + source), suppression_flags.
- **loan**: loan_id, customer_id, product_type, principal, sanctioned_date, tenure, interest_rate, EMI_amount, disbursal_date.
- **installment**: loan_id, due_date, installment_amount, paid_flag, paid_date, days_past_due (DPD).
- **loan_status**: loan_id, total_outstanding, pending_amount, pending_installments_count, next_due_date, **asset_classification** (Standard / Sub-standard / Doubtful / Loss), DPD bucket.
- **guarantor**: guarantor_id, linked_loan_id, name, verified phone, consent, relationship.
- **interaction_log** (Req 2): every call/message/visit with timestamp, channel, language, outcome, recording reference, compliance-gate decision trail.

**NPA / asset classification logic** (standard RBI definitions to encode):
- Account becomes **NPA** when overdue **> 90 days**.
- **Sub-standard**: NPA for ≤ 12 months.
- **Doubtful**: NPA > 12 months.
- **Loss**: identified as uncollectible.
- For secured loans, SARFAESI timelines (e.g., 60-day notice) apply — track these as separate workflow states.

The **Delinquency/NPA Engine** runs on a schedule, recomputes DPD, pending amounts, total outstanding, next due date, and classification, and raises events ("entered 30 DPD", "crossed into NPA", "guarantor escalation due") that the orchestration layer consumes.

### Req 2 — Track customer and agent history

Two history stores:
1. **Structured history** (PostgreSQL `interaction_log`) — the auditable record of who was contacted, when, on what channel, in what language, and the result (promise-to-pay, dispute, no-answer, paid, etc.).
2. **Semantic memory** (vector database — e.g. **pgvector**, **Qdrant**, or **Milvus**) — embeddings of past conversation transcripts so the AI can recall "last time this customer said they'd pay after salary on the 5th." This powers context-aware, non-repetitive conversations and is what separates a smart agent from a robocaller.

"Agent history" also covers **human** agents: track which human handled an escalation, their notes, and outcomes, so the AI hands off with full context and learns from resolutions.

### Req 3 — Send loan information to the customer's WhatsApp

Use the **official WhatsApp Business API (WABA)** through a Business Solution Provider, integrated to your data layer. Key points for India:
- **No DLT/TRAI registration needed** (unlike SMS) — faster to launch.
- Messages must use **pre-approved templates**; **Utility** templates (EMI due reminder, payment confirmation, statement, loan-closure) are the compliant lane. Authentication templates handle OTP.
- Very low cost per message in India and ~98% open rates — ideal for reminders and "pay here" one-tap links.
- Embed **secure payment links** (UPI / payment gateway) so the customer pays inside the chat.
- **Consent + opt-out** enforced by the Compliance Gate. Collect consent at onboarding/loan-application with timestamp and channel.
- **Multilingual templates**: maintain Hindi + regional-language versions of each template (Devanagari etc. lift response rates in Tier-2/3).

Open-source self-host option for the messaging orchestration around WABA: **Chatwoot** (agent inbox + APIs) or a custom FastAPI microservice that holds template logic, consent checks, and webhook handling. The WABA connection itself is via Meta's Cloud API or an on-prem-friendly BSP.

### Req 5 — Guarantor escalation

Guarantors are one of the few **legally permitted** third parties to contact. Workflow:
1. Delinquency engine detects borrower default crossing a configured threshold (e.g., 60+ DPD, after the borrower has been duly notified).
2. Compliance Gate confirms: guarantor consent on file, within calling hours, frequency cap not breached, and that this is a guarantor (not an unrelated third party).
3. Agent contacts the guarantor with a **factual, non-coercive** message: that the loan they guaranteed is in default, the outstanding amount, and how to resolve it — never threats, never shaming.
4. Log everything; record voice calls.

Keep the tone strictly compliant — guarantor outreach is high legal-risk; the message templates here should be reviewed by the bank's legal/compliance team and version-controlled.

### Req 6 — Multilingual AI voice calling with automatic language switching

This is the technically hardest piece. The pipeline per call:

```
PSTN/Mobile  ─SIP─►  Telephony/Media server  ─audio─►  VAD + ASR  ─text─►  LLM (+RAG, +tools)
                                                                              │ text
   caller hears ◄── TTS ◄── selected-language voice ◄───────────────────────┘
                         ▲
                         └── Language Detector: if caller switches language,
                             ASR + TTS + LLM prompt switch to match
```

Recommended open-source components (India-tuned):
- **ASR (speech-to-text):** **AI4Bharat IndicConformer / IndicWhisper** (covers all 22 scheduled Indian languages, MIT-licensed, can run CPU-only for lighter loads), or **faster-whisper** for multilingual + speed. NVIDIA **NeMo Canary** if you want the strongest accuracy and have NVIDIA GPUs. These also plug into **Bhashini**, India's national language stack (MeitY).
- **TTS (text-to-speech):** **AI4Bharat Indic Parler-TTS** (18+ Indian languages, 69 voices, emotion control, auto-detects language from text) or **svara-TTS** (19 Indian languages, expressive, zero-shot voice cloning). **MeloTTS** is a CPU-friendly fallback with an Indian-English accent.
- **Language switching:** run a fast language-ID model on incoming audio/transcripts; when the detected language changes, swap the ASR target, the TTS voice, and inject the LLM system prompt for that language. The orchestration framework manages this mid-call.
- **Orchestration / real-time loop:** **Pipecat** (Python, easy STT→LLM→TTS pipelines, built-in interruption/barge-in handling, has telephony + even a WhatsApp transport) or **LiveKit Agents** (WebRTC-first, strongest community, native SIP telephony, semantic turn-detection). **Bolna** and **Dograh** are higher-level open-source platforms if you want more out-of-the-box, including no-code flows and on-prem Docker/K8s deployment.
- **Telephony:** **Asterisk / FreePBX** to terminate SIP trunks and expose numbers, bridged into the media stack. For Indian PSTN, use a SIP trunk provider (e.g., domestic providers / Plivo / Exotel-style). LiveKit's SIP egress converts SIP↔WebRTC so the agent treats a phone caller like any session.

Latency budget matters: aim for sub-300 ms end-to-end loop so conversation feels natural — that drives the choice of streaming ASR/TTS and a fast LLM, and is a major reason to keep models local on GPU.

**Compliance overlay on voice:** every call obeys the 8 AM–7 PM gate, frequency caps, recording, and identifies itself as an automated agent of the bank. No "every-15-minute" auto-dialing.

---

## 3. Open-source software stack (concrete picks)

| Layer | Recommended open-source choice | Notes |
|---|---|---|
| LLM "brain" | **Qwen 3** (8B / 14B / 30B) — Apache 2.0, 100+ languages incl. strong Indic; or **Gemma 3** (multilingual, check license terms); **Llama** family; **Mistral 7B** for light loads | Pick by hardware tier; Qwen3 is the strong default for multilingual reasoning. Larger models (70B+ / DeepSeek MoE) only if you can fund multi-GPU. |
| LLM serving | **vLLM** (production throughput, batching) or **Ollama** (simple, great for pilot) | vLLM for concurrency; Ollama for dev. |
| ASR | **AI4Bharat IndicConformer / IndicWhisper**, **faster-whisper**, **NVIDIA NeMo Canary** | India-language coverage is the deciding factor. |
| TTS | **AI4Bharat Indic Parler-TTS**, **svara-TTS**, **MeloTTS** | Auto language detection + emotion. |
| Voice orchestration | **Pipecat** or **LiveKit Agents** (framework); **Bolna**/**Dograh** (platform) | Barge-in, turn detection, SIP. |
| Telephony | **Asterisk / FreePBX** + SIP trunk | PSTN bridge. |
| Messaging | **WhatsApp Business API** (Meta Cloud API / BSP) + **Chatwoot** for agent inbox | Utility templates only for collections-adjacent. |
| Operational DB | **PostgreSQL** | Loans, dues, logs. |
| Vector / memory | **pgvector**, **Qdrant**, or **Milvus** | Conversation memory + RAG. |
| Object storage | **MinIO** (S3-compatible, on-prem) | Call recordings, documents. |
| Workflow / queue | **Temporal** or **Celery + Redis** | Scheduling campaigns, retries, notice clocks. |
| LLM gateway (optional) | **Bifrost** or **LiteLLM** | Unify model access, budgets, audit, MCP. |
| Observability | **Prometheus + Grafana**, **Langfuse** (LLM tracing) | Latency, WER, call outcomes. |
| Orchestration/Deploy | **Docker + Kubernetes** | On-prem, air-gap capable. |

---

## 4. Competitive landscape — who is already building this (and the gap you fill)

This is a real, crowded market — which is good news (proven demand) and a warning (you must differentiate). What follows is who is active as of mid-2026.

### India — BFSI collections platforms & voice-AI specialists
- **Credgenics** — the most established SaaS debt-collections platform for banks, NBFCs, HFCs, MFIs, fintechs, and ARCs. Full lifecycle: predictive/GenAI analytics, digital dunning, predictive dialer, GenAI voicebot, WhatsApp, litigation management, field-collections app, payments portal, and Online Dispute Resolution (ODR). The breadth benchmark to study.
- **CarmaOne** — positions itself as a unified "operating system" tying together Loan Origination (LOS), Loan Management (LMS), and recovery, with generative-AI voice agents in 15+ Indian languages, Account-Aggregator-driven predictive early-warning, and legal escalation (SARFAESI, cheque-bounce/Section 138) tracking.
- **Gnani.ai (Collect365)** — AI voicebots automating pre-due and post-due outreach end-to-end, multilingual, with PTP capture, dynamic scheduling, and risk-based segmentation. Strong with large NBFCs; longer enterprise procurement cycles.
- **Caller Digital** — voice AI built specifically for NBFC collections with RBI compliance treated as an architectural guarantee (calling-hour enforcement, identity disclosure, retention), organised around DPD buckets (0–30 / 30–60 / 60+).
- **Spocto / Spocto X (Yubi-owned)** — AI debt-collection used widely by **public-sector banks**; predictive analytics, hyper-personalised borrower engagement, early-delinquency focus. One of the larger players by revenue. Strong on prevention, but not a full LMS — it layers on existing loan platforms.
- **DPDzero, CredResolve, Moonflow, FREED, Rezolv, Recovr** — newer venture-funded collections-tech startups (early-stage to growth) competing on AI engagement and resolution.
- **Dista Collect** — AI- and location-intelligent collections (field-ops + geo-routing), full lifecycle, RBI-audit-ready, strong for field-heavy NBFC/MFI portfolios.
- **DrishtiSoft** — dialer/contact-centre infrastructure for large outbound calling operations (millions of calls/month); not lending-native.
- **LeadSquared (Collections CRM), FICO Debt Manager** — collections CRM and enterprise decisioning respectively.
- **Saarthi.ai** — multilingual voice/language technology for business communication.
- **Vodex** — voice-AI collections startup (originally Bengaluru) now focused on the US market under FDCPA/TCPA, with warm transfer to humans and ISO 27001 / SOC 2 / HIPAA-aligned audit trails.
- **Others active in the Indian NBFC voice-AI space:** Floatbot, UnleashX, CubeRoot, Subverse AI, Tabbly, and various system integrators. **Knowlarity** is cloud-telephony/dialer infrastructure (not an autonomous AI agent) that the AI layer sits on top of.

### Global (mostly US/EU)
- **Skit.ai** (formerly Vernacular.ai) — turnkey voice-AI collections used by 120+ teams; handles RPC verification, Mini-Miranda disclosure, disposition capture, settlement/installment negotiation, and on-/off-call payments.
- **Prodigal** — agentic AI for consumer-finance servicing and collections, with agent-assist, QA/speech analytics, and propensity-to-pay scoring, trained on a very large corpus of consumer-finance interactions.
- **InDebted** and **TrueAccord** — digital-first collectors that operate as the *collector of record* on a contingency (% of recovered) model, strong on empathy-led consumer experience.
- **Equabli, Floatbot, Retell AI, EVEcalls, Ainora (EU/GDPR + EU AI Act)** — voice/omnichannel platforms.
- **Sedric.ai** — a complementary *compliance-monitoring* layer that watches whatever agent you deploy for violations (validates the "real-time compliance monitoring" feature below).

### The layer above the voice-bots — core-banking & lending/collections platforms
These are your peers as a CBS vendor; several already advertise "AI collections," so know what they actually ship:
- **Nucleus Software FinnOne Neo Collections** — a long-established Indian lending suite (LOS/LMS/Collections) with ML for **early delinquency detection and NPA prediction**, configurable follow-up workflows, and a 360° collections view. Deep CBS integration, deployed across banks/HFCs in India, SE Asia, the Middle East. The incumbent to respect.
- **M2P Core Lending Suite (CLS)** — positioned as the most complete AI-native Indian lending platform in 2026, embedding AI at every lifecycle stage (origination → underwriting → LMS → collections), RBI-2025-aligned co-lending, on a single data model.
- **Finezza, Finflux, and similar** — integrated lending + collections + bureau-analytics platforms for NBFCs/MFIs.
- **The core-banking cores themselves** — Finacle (Infosys), TCS BaNCS, Temenos, Oracle FLEXCUBE, FIS, Finastra, Thought Machine, Mambu — ship analytics/AI *add-ons* but not a dedicated Indian-multilingual on-prem **voice recovery agent**; collections usually comes via a partner module.
- **Cooperative / RRB / small-bank cores (your likely turf)** — Laser Soft Probanker, Craft Silicon Bankers Realm, C-Edge, Data Mate, Info Dynamic and similar serve co-op/rural banks. These segments are the **least served** by sophisticated AI recovery — a real opening for a CBS-native add-on.

### Who actually offers ON-PREM / self-hosted voice (your true peer set — and it's a short list)
This is the decisive finding: self-hosted voice AI is *rare*. Industry surveys in 2026 state plainly that very few voice-AI platforms offer self-hosted deployment, and that cloud-only voice is a hard blocker for financial-services teams that must keep call recordings on-premises. The handful that do:
- **Dograh AI** — the closest direct analog to what you're building: **open-source (BSD-2-Clause), full self-host / air-gap**, the entire STT→LLM→TTS runtime can run with zero internet, FDCPA-style call-window enforcement, local Whisper/Coqui/Piper. Study this one hard — it is your nearest competitor and a useful reference architecture.
- **Rasa / Rasa Voice** — self-hosted-from-day-one voice infrastructure, bring-your-own ASR/TTS, on-prem/hybrid. General platform, not collections-specific or India-tuned.
- **Deepgram** — on-prem **ASR** for regulated industries (via confidential-computing partnerships). A component, not a full agent.
- **Retell AI, Bland AI, Vapi** — primarily cloud, but offer on-prem / air-gapped options and bring-your-own-LLM.
- Everyone else in collections (Skit.ai, Prodigal, Equabli, Credgenics, Gnani, CarmaOne) is **cloud SaaS / vendor-managed**.

**The white space (where "best" lives):** no vendor today combines *all* of — on-prem/air-gap **+** open-source economics **+** CBS-native integration **+** Indian-multilingual voice (AI4Bharat/Bhashini) **+** RBI-compliance-by-architecture. Dograh has on-prem + open-source but is US/FDCPA-shaped and not CBS-native; the Indian collections leaders have RBI-fit and multilingual voice but are cloud. That intersection is your unoccupied position.

> Counter-current to plan around: some advisors push Indian NBFCs toward *cloud* AI (Azure/AWS with India residency), suggesting even on-prem starters migrate to cloud within ~18 months. Your bet is the opposite — that cooperative banks, security-conscious REs, and air-gapped sites will keep wanting on-prem. Make the on-prem experience so clean (one-box install, no internet needed) that staying on-prem is the easy choice, not the painful one.

### Commercial models in the market (useful for your pricing)
Three patterns dominate: **per-minute** (~$0.10–0.50 per AI voice minute), **contingency** (10–25% of recovered balances, used by collectors-of-record), and **enterprise platform fees** (annual, bundling minutes + integrations + managed services). Indian NBFC engagements often carry six-figure-rupee monthly minimums and 8–16 week procurement cycles (≈4 weeks of legal redlining alone).

### Your differentiation as a CBS vendor (this is the thesis)
The deep-dive confirms it: almost every collections AI is **cloud SaaS**, genuine self-hosted voice is rare, and *none* is natively embedded in the cores you already supply. Your defensible angles:
1. **On-prem / data-residency** — borrower data and call recordings never leave the bank's perimeter (clean DPDP + RBI localisation story; appeals to security teams).
2. **CBS-native** — pre-built, deep integration with the cores you already sell, instead of a generic API bolt-on with stale CSV syncs.
3. **No per-minute / per-recovery lock-in** — open-source stack converts variable vendor fees into owned infrastructure (the economics flip in your favour above moderate call volume).
4. **Compliance-by-architecture** — the Compliance Gate as a hard guarantee, not a configurable "feature," is exactly what the strongest incumbents market on.
5. **Multilingual depth via Indian open models** (AI4Bharat / Bhashini) without paying a proprietary TTS/ASR vendor per minute.

> Reality check: the incumbents are mature and feature-rich. Do not try to out-feature Credgenics on day one. Win a beachhead on **on-prem + CBS-native + compliance-by-design** for your existing bank/NBFC customers, then expand.

---

## 5. Req 7 — Additional features to make this a top-of-market agent

Researched against what leading collections-AI and voice-AI products now ship. Grouped by impact:

**Intelligence & strategy**
- **Risk/propensity scoring**: ML model predicting likelihood-to-pay and best-time-to-contact per borrower, so the agent prioritises and personalises instead of blasting everyone.
- **Best-channel & best-time optimisation**: learn whether each borrower responds to WhatsApp, voice, or SMS, and at what hour (within legal window).
- **Promise-to-Pay (PTP) tracking** with automated, gentle follow-up if a promise is broken.
- **Dynamic settlement / restructuring offers**: the agent can present pre-approved restructuring, EMI deferral, or one-time-settlement options (within bank-defined guardrails) and route acceptances to humans.
- **Sentiment & distress detection** on calls: if the borrower is distressed, angry, or mentions hardship/bereavement, auto-soften, pause, or escalate to a human — both compliance and CX win.

**Conversation quality**
- **Barge-in / interruption handling** and natural turn-taking (table stakes for credible voice).
- **Code-mixing** support (Hinglish and similar) — Indian callers mix languages within a sentence.
- **Voice persona consistency** + emotion-aware TTS.
- **Seamless human handoff** with full context, and **live "whisper"/co-pilot** for human agents (AI suggests replies in real time).

**Collections workflow (what the market treats as standard)**
- **DPD-bucket segmentation as the operating model**: AI runs the high-volume **0–30 DPD** reminder bucket autonomously; **30–60** moves to AI-assisted negotiation; **60+** routes to human DRAs with AI as co-pilot. Design call flows and escalation rules per bucket — this is how every serious Indian deployment is structured.
- **Right-Party Contact (RPC) verification** at call start (DOB / PIN / last digits of an ID) before any debt is discussed.
- **Disposition capture**: cleanly handle and record outcomes — promise-to-pay, dispute, wrong number, "do not contact," deceased, attorney/representative, hardship — and branch accordingly.
- **Account-Aggregator-driven early warning**: pull consented financial-health signals (e.g., falling GST filings, liquidity drops) to flag a borrower into a high-risk bucket *before* the EMI bounces, and nudge toward restructuring proactively (reactive → predictive).
- **Legal-escalation tracking**: workflow states for **SARFAESI** (secured loans) and **Section 138** (cheque-bounce) so late-stage accounts move into the right legal track with the clock tracked.

**Payments & resolution**
- **Embedded payment** (UPI/one-tap links in WhatsApp, IVR/DTMF pay-by-phone, or agentic payment link generation mid-call).
- **Self-service repayment portal** the agent can deep-link to.

**Compliance & trust (your differentiator in BFSI)**
- **Built-in Compliance Gate** (as designed above) — sell this as the headline feature; banks buy *defensible* automation.
- **Full audit trail + tamper-evident call recordings** with retention policies.
- **Real-time compliance monitoring**: flag any call that drifts toward prohibited language; auto-QA every call instead of sampling 2%.
- **Consent & DPDP management console**.
- **Configurable rule engine** so each bank/NBFC can tune to its own policies and absorb RBI changes (e.g., the July 2026 RBC amendment) without code changes.

**Operations**
- **Campaign manager** (segment by DPD bucket, product, geography, language) with frequency-cap enforcement.
- **Analytics dashboard**: recovery rate, PTP conversion, contactability, cost-per-recovery, channel ROI, language distribution.
- **A/B testing** of scripts/voices.
- **CBS-agnostic connectors** (since you're a CBS vendor, ship adapters for the common cores you serve).
- **Multi-tenancy** (one deployment serving multiple bank clients with strict data isolation) — important for a vendor product.
- **Outbound + inbound**: also answer inbound borrower calls ("I want to pay", "I dispute this") 24×7.

---

## 6. Advanced / next-generation feature deep-dives (where "best in market" is won)

These are the capabilities that separate a credible product from a category leader. Each is described as: what it is → how to build it on your on-prem/open-source stack → value → compliance/risk → who already has it.

### 6.1 Hyper-personalised payment plans using Generative AI
**What:** instead of one-size dunning, the agent generates a tailored repayment/restructuring/settlement offer per borrower — sized to their income cycle, past payment behaviour, and stated hardship.
**Build:** propensity model picks a strategy → the LLM drafts the offer **within a bank-approved guardrail matrix** (constrained generation: the agent may only offer terms from a pre-authorised set) → present over voice/WhatsApp → route acceptance to a human/CBS for booking. Never let the model invent terms freely.
**Value:** higher promise-to-pay conversion; feels like help, not harassment.
**Compliance/risk:** every offer must be bank-pre-approved, logged, and free of discriminatory pricing; keep a human approval step for anything outside the matrix.
**Who:** Credgenics and Spocto market "hyper-personalised journeys"; truly generative, constrained offers are still emerging — room to lead.

### 6.2 Borrower–guarantor network graph
**What:** model borrowers, guarantors, co-borrowers, and loans as a graph to reveal shared guarantors, cross-default exposure, concentration, and circular guarantees.
**Build:** a graph store (Neo4j, ArangoDB, or pgRouting/Apache AGE on your existing Postgres) with people/loans as nodes and "guarantees"/"co-borrows" as edges; run centrality and community-detection to find high-leverage guarantors and risk clusters, feeding the early-warning and guarantor-escalation (Req 5) workflows.
**Value:** see systemic risk a flat table hides; prioritise the guarantor whose single intervention unlocks several accounts.
**Compliance/risk:** use the graph **only** to act on legally permitted contacts (borrower + registered guarantor). Never use it to discover and dun unrelated third parties — that is exactly what RBI prohibits.
**Who:** rarely done well in collections — a genuine differentiator.

### 6.3 Voice-biometric verification (with the 2026 caveat that changes the design)
**What:** verify the caller by voiceprint to speed Right-Party Contact.
**The catch you must design around:** in 2026 voice alone is no longer trustworthy. Modern tools can clone a convincing voice from ~3 seconds of audio, 84% of financial organisations faced sophisticated voice attacks in the past year, and surveys show the vast majority of banks are rethinking voice biometrics because of cloning. RBI has mandated liveness/spoof detection for Video KYC. So **never make a voiceprint the sole gatekeeper.**
**Build:** layered identity — open-source speaker verification (SpeechBrain/ECAPA-TDNN or NVIDIA NeMo speaker models) **+** anti-spoofing/liveness (ASVspoof-style detectors) **+** device/line signals **+** a knowledge factor (DOB/PIN) **+** a risk engine that combines them. Treat the voiceprint as one behavioural signal, not a key.
**Value:** faster verification, fraud reduction, and it protects *your* outbound agent from being impersonated.
**Compliance/risk:** voiceprints are sensitive biometric data under DPDP — explicit consent, encryption, and retention limits are mandatory.

### 6.4 Sentiment-adaptive dialogue
**What:** detect emotion, distress, or anger in real time and adapt — soften tone, slow down, offer forbearance, or hand off to a human.
**Build:** a streaming speech-emotion model plus text-sentiment on the live transcript, feeding a policy layer that rewrites the LLM's system prompt mid-call or triggers escalation/forbearance scripts when hardship or vulnerability markers appear.
**Value:** this *is* compliance — RBI's empathy/calamity expectations and vulnerable-customer handling (the bar regulators like the UK FCA now enforce) require it; it also cuts complaints and lifts resolution.
**Who:** Skit.ai, Ainora and others emphasise distress detection; it's now an evaluation criterion in regulated markets, not a nice-to-have.

### 6.5 Automatic legal-notice drafting
**What:** auto-draft demand notices, SARFAESI 13(2) notices, Section 138 (cheque-bounce) notices, and arbitration filings, pre-populated from CBS data in correct statutory format and language, queued for advocate review.
**Build:** a versioned legal-template library + LLM fill + RAG over approved formats + **mandatory human-in-the-loop advocate approval** + e-sign/dispatch + hearing/notice-clock tracking.
**Value:** compresses the slowest part of late-stage recovery; consistency and a clean audit trail.
**Compliance/risk:** statutory wording and timelines are unforgiving and unsupervised legal drafting risks unauthorised practice of law — the advocate-review gate is non-negotiable.
**Who:** Credgenics is strong here (notice generation + Section 138/SARFAESI litigation tracking + advocate performance) — study it as the benchmark.

### 6.6 CBS-event-driven triggers (your single biggest structural advantage)
**What:** the agent reacts to real-time core-banking events — EMI bounce, payment received, DPD-bucket change, NPA classification, cheque return, partial payment — instead of running nightly batches.
**Build:** an event bus (Kafka or Redis Streams) fed by the CBS via change-data-capture / DB triggers / webhooks → rules engine → orchestrator picks the action (remind, pause, escalate, thank). Make "borrower just paid → suppress all outreach immediately" a first-class event.
**Value:** timely and relevant outreach, and a hard compliance win — you never dun someone who already paid (a common, reputation-wrecking failure of batch systems).
**Why it's your moat:** you **own the CBS.** Native event hooks are something no external SaaS can match — they're stuck with stale CSV syncs and API polling. Lead your pitch with this.

### 6.7 Multi-agent architecture for complex negotiation
**What:** rather than one monolithic prompt, a team of specialised agents collaborates — a Negotiator, a Policy/eligibility checker, a Compliance/guardrail agent (with veto power), an Account-knowledge agent, and an Escalation agent — coordinated by a supervisor.
**Build:** an orchestration framework (LangGraph, CrewAI, or AutoGen — or a custom supervisor) running on your local LLM; each agent has a narrow role, its own tools, and explicit constraints. Your **Compliance Gate becomes an agent that can veto** any proposed action before it reaches the borrower.
**Value:** more robust, auditable, and safer than a single prompt for multi-turn settlement negotiation; each decision has a traceable owner.
**Compliance/risk:** bound the loop (max turns, timeouts) to control latency and cost; log every inter-agent message for audit. This is cutting-edge — a strong "most advanced agent in the market" claim if executed well.

### 6.8 Voice naturalness + sentiment: benchmark vs. self-host (build-vs-license decision)
A common question: which Indian providers already do natural, human-like voice with sentiment detection — and should you license one or build it yourself? Since the field is almost entirely **cloud/API**, and your product is **on-prem / air-gap**, the practical answer is *match their quality with open models locally*, using them as benchmarks. Decide deliberately:

| Capability | Market benchmark (cloud) | Your on-prem self-host path |
|---|---|---|
| **Real-time sentiment / emotion detection** | **Gnani.ai (Inya.ai)** — the BFSI leader; live emotion from tone, pitch, pace, volume, pauses; triggers de-escalation/escalation. **SquadStack** (trained on 600M+ real calls), **Ringg AI** (sentiment monitoring, SOC-2/ISO 27001) | Open-source speech-emotion-recognition (SER) model in the pipeline (SpeechBrain / wav2vec2-SER / NeMo) + text-sentiment on the live transcript, feeding the policy layer from §6.4 |
| **Natural, human-like Indian voice (TTS)** | **Sarvam AI (Bulbul v3)** — 35+ voices, sub-250ms, emotion control, Hinglish code-switch, top-ranked in a 20K-vote blind study. **Smallest.ai** (ultra-realistic), **ElevenLabs** (best raw quality, global) | **AI4Bharat** (IIT-Madras, open, self-hostable) as the base; **Sarvam open-weight models** can be hosted yourself for near-Bulbul quality; Indic Parler-TTS / svara-TTS as alternates |
| **Turnkey BFSI deployment + compliance** | **Caller Digital** (TRAI/DPDP templates), **Gnani** (Tier-1 BFSI, voice biometrics) | Your own Compliance Gate + AI4Bharat/Sarvam voices; this *is* your differentiator |

**Decision rule:** if the bank insists on on-prem/air-gap (your core thesis), **self-host** using AI4Bharat + open Sarvam models + an open SER model — treat Gnani (sentiment) and Sarvam/Bulbul (naturalness) as the quality bars to hit. Only if a specific client will tolerate a private/managed deployment should you consider **licensing** Gnani or Sarvam under an on-prem contract — they are the two most likely to offer it to a bank. Either way, do an A/B listening test of your self-hosted voice against Bulbul v3 early, so you know how big the quality gap is before committing.

> How these sequence: 6.6 (CBS event triggers) is foundational and plays to your strength — build it early. 6.4 (sentiment) and 6.3 (layered voice verification) ride on the voice pipeline you're already building, and 6.8 tells you whether to build or license that layer. 6.1, 6.2, 6.5, and 6.7 are the differentiation layer (Phase 4+), best added once the compliant core is proven.

---

## 7. Req 8 — Hardware / machine configuration

On-prem sizing is driven mostly by **GPU VRAM** (for the LLM + ASR + TTS) and by **how many concurrent voice calls** you must serve. Quick rules from current practice:

- VRAM for model weights ≈ **2 bytes/param at FP16**, **0.5 bytes/param at 4-bit (INT4/Q4)**. Add ~10–20% for KV-cache/activations. So a 70B model ≈ ~35–40 GB at Q4, ~140 GB at FP16.
- 7–8B models run on **~8 GB VRAM** (Q4); 30B-class wants a **24 GB** floor; 70B wants **40 GB+**.
- For 24×7 production, prefer **datacenter GPUs** (ECC, built for continuous load) over consumer cards.

### Tier A — Pilot / PoC (single bank, low volume, dev)
- **GPU:** 1× NVIDIA RTX 4090 / 5090 (24–32 GB) **or** 1× L40S (48 GB).
- **CPU:** 16–24 cores (Ryzen 9 / Xeon / EPYC).
- **RAM:** 128 GB.
- **Storage:** 2 TB NVMe SSD (OS + DB + models) + 4–8 TB for recordings.
- **Capacity:** runs Qwen3-8B/14B (quantized) + ASR + TTS; ~5–10 concurrent voice calls, plus bulk WhatsApp/SMS reminders.
- **Note:** consumer GPU is fine for pilot; no ECC = higher error risk for production.

### Tier B — Production, mid volume (recommended starting production)
- **GPU:** 2× NVIDIA A100 80 GB **or** 2–4× L40S (48 GB) **or** 2× H100. Split: dedicated GPU(s) for the LLM (vLLM), shared GPU for ASR+TTS.
- **CPU:** 32–64 cores (dual EPYC / Xeon Scalable) — telephony media + ASR pre/post-processing + DB are CPU-heavy.
- **RAM:** 256–512 GB.
- **Storage:** 4 TB NVMe (OS/DB/models, mirrored) + **bulk recording store**: call recordings are *mandatory* and grow fast — budget on the order of ~0.5–1 MB per audio-minute compressed, so plan tens of TB with a retention policy (e.g., MinIO over a 20–50 TB array). Use RAID + backups.
- **Networking:** 10 GbE internal; redundant links to SIP trunk.
- **Capacity:** ~50–100 concurrent voice calls + high-volume messaging.

### Tier C — Scale / multi-tenant (vendor serving many banks)
- **GPU:** 4–8× H100 / H200 (or A100 80 GB) in one or more nodes; AMD MI300X is a viable alternative. Large MoE models (DeepSeek-class) live here.
- **CPU:** 64–128 cores per node.
- **RAM:** 512 GB – 1 TB per node.
- **Storage:** NVMe tier for hot data + large object store (100 TB+) for recordings with tiered archival; full HA/replication.
- **Topology:** Kubernetes cluster, GPU autoscaling, separate nodes for telephony/media vs. inference vs. data; DR site.
- **Capacity:** hundreds–thousands of concurrent calls, multiple isolated bank tenants.

### General requirements (all tiers)
- **OS:** Ubuntu Server LTS (24.04) with NVIDIA drivers + CUDA.
- **Air-gap option:** mirror model weights and packages internally so the box can run with no internet — important for bank security teams.
- **Redundancy:** UPS, dual PSU, RAID, off-box encrypted backups; recordings and PII encrypted at rest (DPDP) and in transit.
- **Security:** network segmentation from the CBS, least-privilege DB access (read-only replica from CBS), HSM/Vault for secrets.

> Sizing heuristic: start at **Tier B with 2× A100 80 GB**, measure real concurrency and ASR/TTS GPU pressure, then scale GPUs horizontally. Voice ASR/TTS can be offloaded to CPU (IndicConformer/MeloTTS support this) to free GPU for the LLM if call volume is modest.

---

## 8. Phased implementation roadmap

**Phase 0 — Foundations (compliance + data) — 4–6 weeks**
CBS connector + recovery data layer + Delinquency/NPA engine + Compliance Gate + consent/DPDP store. Nothing reaches a customer yet. This de-risks the legal core first.

**Phase 1 — WhatsApp utility channel — 3–4 weeks**
WABA integration, multilingual utility templates (EMI reminder, due-date, payment link, statement), opt-in/opt-out. Highest ROI, lowest risk. Mirrors how Indian banks roll out (transactional alerts first).

**Phase 2 — Guarantor & escalation workflows — 2–3 weeks**
Compliant guarantor outreach, PTP tracking, suppression flags, frequency caps, human-handoff dashboard.

**Phase 3 — Multilingual voice agent — 6–10 weeks**
ASR/TTS/LLM pipeline, telephony, language auto-switch, barge-in, recording, real-time compliance monitoring. Start outbound reminders in 2–3 languages, expand coverage.

**Phase 3.5 — Parallel pilot (the market-standard go-live) — 4–6 weeks**
Pick one controlled segment — typically **5,000–10,000 accounts in the 0–30 DPD bucket** — in Hindi + English first. Run the AI agent **alongside** the existing human team and compare recovery rate, connect rate, PTP conversion, and compliance score head-to-head. Iterate scripts on real call analytics before widening buckets and languages. This is how Indian NBFCs de-risk adoption.

**Phase 4 — Intelligence layer — ongoing**
Propensity scoring, best-time/channel optimisation, sentiment/distress detection, settlement offers, Account-Aggregator early warning, analytics, A/B testing, auto-QA.

**Phase 5 — Productisation — ongoing**
Multi-tenancy, configurable rule engine per client, CBS-agnostic adapters, packaging for your bank/NBFC customers.

---

## 9. Key risks & mitigations

- **Mature incumbents** (Credgenics, CarmaOne, Gnani, Skit.ai, Prodigal): don't compete head-on on breadth. Win on on-prem + CBS-native + compliance-by-design for your existing customers first.
- **Regulatory drift** (RBI tightens rules, e.g., July 2026 RBC amendment): keep all conduct rules in a **configurable rule engine**, not hard-coded. Sell configurability as a feature.
- **WhatsApp policy violation** (treating it as a collections channel): restrict WhatsApp to Utility reminders; route real recovery to voice/human.
- **Hallucination on financial facts**: never let the LLM compute or invent dues — it reads exact figures from the data layer via tool calls; numbers come from the ledger, language comes from the LLM.
- **Voice latency / unnatural calls**: keep models local on GPU, use streaming ASR/TTS, enforce barge-in; budget sub-300 ms loop.
- **PII leakage**: on-prem + encryption + least-privilege + air-gap option; mask identifiers; DPDP-aligned retention.
- **Reputational / harassment claims**: real-time compliance monitoring + full recordings are both protection and proof.

---

### One-line summary
Build a **compliance-gated, on-prem, open-source agent**: PostgreSQL + NPA engine for the facts, a Qwen3-class local LLM for reasoning, AI4Bharat ASR/TTS + Pipecat/LiveKit + Asterisk for multilingual voice, WhatsApp Business API (utility templates) for reminders — all sitting behind a Compliance Gate that enforces RBI/DPDP/Meta rules in code, on a 2× A100-class machine to start, scaling to an H100/H200 cluster.
