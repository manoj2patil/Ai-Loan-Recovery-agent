# Sah-Ayak Roadmap v2 — Enterprise Edition (bank-evaluation ready)

Your v1 phases 1–5 stand as built. v2 adds the gap items (benchmarked against Credgenics /
Spocto X / CarmaOne / Dista) into the right phases. New items are marked ★.

## Phase 1 — Data & Compliance spine  (v1 complete + hardening)
- (as built) Loan portfolio, NPA/delinquency engine, Compliance Gate ALLOW/DEFER/BLOCK with audit
  trail, WhatsApp registry + gated send, interaction log, schemas.
- ★ **Security posture (explicit):** RBAC roles (officer/compliance/admin), PII data-masking in UI
  and exports, encryption at rest, session audit. (Table stakes in every bank RFP.)
- ★ **DND registry scrubbing:** scrub numbers against DND/DNC list inside the Compliance Gate
  (new check between consent and frequency-cap).

## Phase 2 — Voice pipeline  (v1 complete)
- (as built) Sarvam ASR/LLM/TTS, 11-language auto-switch, emotion → handoff, persistence,
  recording + transcript to audit trail.
- ★ **Production telephony:** Twilio Media Streams path (folder 06) with instant greeting,
  filler, barge-in, per-turn latency logging.

## Phase 3 — Orchestration & escalation  (v1 + payments closure ★)
- (as built) Orchestrator state machine, DPD escalation policy, guarantor workflow, PTP lifecycle.
- ★ **Payments module (highest-ROI gap):** secure UPI/payment-link generation per loan, links
  embedded in WhatsApp/voice, webhook reconciliation → auto-suppression on payment, receipt
  issuance, unmatched-payment queue. Orchestration without a payment link leaks conversions.
- ★ **On-call payment:** agent offers link mid-call; OTP-verified confirmation logged.

## Phase 4 — Intelligence layer  (v1 + depth ★)
- (as built) 6-factor explainable propensity, settlement recommender (105B), SARFAESI drafting,
  QA scorecard + hallucination detection.
- ★ **Signal expansion path:** grow propensity from 6 factors toward behavioral segmentation
  (payment velocity, channel responsiveness, time-of-day answer rates, geo/branch, product mix) —
  keep explainability as the differentiator vs the 400-signal black boxes.
- ★ **Best-time / best-channel model:** learn per-borrower contact windows within legal hours.

## Phase 5 — Scale & governance  (v1 complete)
- (as built) Governance dashboard, channel-mix economics, K8s/Helm registry, canary A/B + Qwen3
  fallback, GPU autoscaling, network graph, pilot planner with go/no-go gates.

## Phase 5.5 — Field & Legal (new ★)
- ★ **Field collections module:** visit scheduling from orchestrator (60+ DPD unreachable-by-phone),
  geo-tagged visit logging, visit outcome + photo/receipt capture, agent route view. (Benchmark:
  CG Collect drove 50% more visits, 3X field recoveries.)
- ★ **Legal case tracker (beyond drafting):** SARFAESI / Section 138 / Arbitration case records,
  hearing calendar with reminders, notice-clock tracking (13(2) 60-day, 13(4)), advocate
  assignment + outcome performance, document vault linkage.
- ★ **NACH mandate view:** mandate status per loan; bounce → orchestrator event.
- (later, optional) Skip-tracing — legally sensitive; only with counsel sign-off.

## What stays your moat (say this to the committee)
On-prem/air-gap deployment, CBS-native event triggers, compliance-by-architecture (gate with
veto + full reason trail), per-reply hallucination detection, and the guarantor network graph —
none of the cloud leaders offer this combination.
