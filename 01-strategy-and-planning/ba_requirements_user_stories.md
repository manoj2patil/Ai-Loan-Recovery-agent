# Business Analyst Requirements & User-Story Pack
## On-Premises AI Loan-Recovery Voice Agent

**Audience:** Business Analyst, Product Owner, delivery team building the backlog/story map.
**Purpose:** translate the solution into epics → user stories → acceptance criteria, plus non-functional requirements, actors, dependencies, and scope — ready to load into a backlog (Jira/Azure DevOps).

> **Format note:** acceptance criteria use Given/When/Then. Story IDs are EPIC.STORY (e.g., E5.3). Priorities: M (Must), S (Should), C (Could) — MoSCoW. Phase maps to the delivery roadmap (P0–P5).

---

## 1. Vision (one paragraph for the BA's intro slide)

A compliance-first, on-premises AI agent that helps banks and NBFCs recover loans by contacting borrowers (and permitted guarantors) through multilingual voice calls and WhatsApp reminders. It reads live loan data from the core banking system, decides who to contact and what to say, enforces every RBI/DPDP rule in code before any contact, records everything, and hands off to human officers when needed — all without borrower data leaving the bank's premises.

---

## 2. Actors / personas

| Actor | Description |
|---|---|
| **Borrower** | The customer with the loan; receives calls/messages, can pay, dispute, or promise to pay. |
| **Guarantor** | Registered guarantor of a defaulting loan; a *permitted* contact when the borrower defaults. |
| **Recovery Officer (human agent)** | Bank/NBFC staff who handle escalations and takeovers; review AI activity. |
| **Compliance Officer** | Configures rules, audits interactions, handles complaints. |
| **System Admin** | Manages deployment, integrations, templates, languages. |
| **AI Agent** | The automated system actor that calls/messages and converses. |
| **Core Banking System (CBS)** | Source of truth for loans, customers, guarantors, ledger. |

---

## 3. Epics overview

| Epic | Title | Phase | Priority |
|---|---|---|---|
| E1 | Loan & customer data foundation | P0 | M |
| E2 | Delinquency & NPA tracking engine | P0 | M |
| E3 | Compliance Gate (governance & consent) | P0 | M |
| E4 | CBS event-driven triggers | P1 | M |
| E5 | WhatsApp reminders & messaging | P1 | M |
| E6 | Multilingual voice calling agent | P3 | M |
| E7 | Guarantor escalation | P2 | M |
| E8 | Interaction history & memory | P0/P2 | M |
| E9 | Payments & resolution | P1/P3 | S |
| E10 | Human handoff & agent assist | P2 | M |
| E11 | Intelligence (scoring, sentiment, early warning) | P4 | S |
| E12 | Reporting & analytics | P4 | S |
| E13 | Admin & configurable rule engine | P0/P5 | M |

---

## 4. Epics & user stories

### E1 — Loan & customer data foundation
- **E1.1 (M, P0)** As the *system*, I want to ingest customer, loan, installment, and guarantor data from the CBS into a recovery-side store, so the agent works without touching the live banking DB.
  - Given a read-only CBS connection, when sync runs, then customer/loan/installment/guarantor records are created/updated in the recovery store with a timestamp.
  - Given a sync failure, when it occurs, then it is logged and retried, and stale data is flagged.
- **E1.2 (M, P0)** As a *Recovery Officer*, I want to see a borrower's full loan profile (personal details, all loans, EMI amount, tenure), so I have context for any action.
  - Given a borrower ID, when I open the profile, then I see masked KYC identifiers, contact numbers (verified flag), all linked loans, and guarantors.
- **E1.3 (M, P0)** As the *system*, I want to track per-loan dues: pending installments count, installment amount, pending amount, total outstanding, next due date.
  - Given an installment schedule, when recomputed, then pending count, pending amount, total outstanding, and next due date are accurate and timestamped.

### E2 — Delinquency & NPA tracking engine
- **E2.1 (M, P0)** As the *system*, I want to compute Days-Past-Due (DPD) and DPD buckets (0–30 / 30–60 / 60–90 / 90+) per loan, so outreach can be segmented.
- **E2.2 (M, P0)** As the *system*, I want to classify asset status (Standard / Sub-standard / Doubtful / Loss) per RBI rules, so NPA loans are identified.
  - Given a loan overdue > 90 days, when classification runs, then it is marked NPA; Sub-standard if NPA ≤ 12 months, Doubtful if > 12 months.
- **E2.3 (M, P0)** As the *system*, I want to raise events on status change ("entered 30 DPD", "crossed into NPA", "guarantor escalation due"), so downstream workflows react.
- **E2.4 (S, P2)** As the *system*, I want to track legal-escalation states (SARFAESI, Section 138 cheque-bounce) with their statutory clocks.

### E3 — Compliance Gate (governance & consent)
- **E3.1 (M, P0)** As a *Compliance Officer*, I want every outreach action to pass a gate that can veto it, so no contact happens outside the rules.
  - Given a requested contact, when it falls outside 08:00–19:00 borrower-local, then it is vetoed and logged.
  - Given frequency caps are exceeded, when contact is requested, then it is vetoed (no "bot siege").
- **E3.2 (M, P0)** As the *system*, I want to restrict contacts to the borrower and registered guarantor only, so third-party contact never happens.
- **E3.3 (M, P0)** As the *system*, I want to record per-channel consent (with timestamp/source) and honour opt-out, so DPDP is met.
- **E3.4 (M, P0)** As a *Compliance Officer*, I want suppression flags (bereavement/medical/festival), so outreach pauses for sensitive circumstances.
- **E3.5 (M, P0)** As the *system*, I want to block recovery-mode outreach until the 30-day notice clock has elapsed.
- **E3.6 (M, P0)** As the *system*, I want every voice call recorded and every message logged with timestamps, retained per policy, so there is a full audit trail.

### E4 — CBS event-driven triggers
- **E4.1 (M, P1)** As the *system*, I want to react in real time to CBS events (EMI bounce, payment received, DPD change, NPA flip, cheque return, partial payment).
- **E4.2 (M, P1)** As a *borrower who just paid*, I want all pending outreach to me to stop immediately, so I'm never chased after paying.
  - Given a `payment_received` event, when processed, then all queued outreach for that loan is suppressed within the SLA.

### E5 — WhatsApp reminders & messaging
- **E5.1 (M, P1)** As a *borrower*, I want a WhatsApp reminder before/at my EMI due date, so I can pay on time.
  - Given an upcoming due date and valid consent, when within calling hours, then an approved Utility template is sent in the borrower's preferred language.
- **E5.2 (M, P1)** As a *borrower*, I want a payment link in the message, so I can pay in-chat.
- **E5.3 (M, P1)** As the *system*, I want to restrict WhatsApp to Utility-category templates (reminders/confirmations), not late-stage dunning, so Meta policy is respected.
- **E5.4 (S, P1)** As a *borrower*, I want a payment confirmation message after I pay.

### E6 — Multilingual voice calling agent
- **E6.1 (M, P3)** As a *borrower*, I want to receive a natural-sounding voice call in my language about my overdue loan, so I understand my situation.
- **E6.2 (M, P3)** As a *borrower*, I want the agent to switch language when I switch, so the conversation feels natural.
  - Given the borrower speaks a different language for a sustained period, when detected, then ASR, voice, and dialogue switch to that language.
- **E6.3 (M, P3)** As a *borrower*, I want to interrupt the agent and be understood (barge-in), so it doesn't talk over me.
- **E6.4 (M, P3)** As the *system*, I want every call to open by stating the agent name, lender, and purpose within ~30 seconds, so identity-disclosure rules are met.
- **E6.5 (M, P3)** As the *system*, I want to verify I'm speaking to the right party before discussing the debt (RPC), so privacy is protected.
- **E6.6 (M, P3)** As the *system*, I want the spoken figures (balance, due date, amount) to come from the ledger, not be generated, so they are always correct.
- **E6.7 (S, P3)** As the *system*, I want to capture call disposition (promise-to-pay, dispute, wrong number, do-not-contact, hardship), so outcomes drive next steps.

### E7 — Guarantor escalation
- **E7.1 (M, P2)** As the *system*, I want to contact the registered guarantor when the guaranteed loan defaults past a configured threshold (after borrower notice), so they are informed.
  - Given the borrower has been duly notified and the threshold is crossed, when the gate approves, then the guarantor is contacted with a factual, non-coercive message about the default and resolution options.
- **E7.2 (M, P2)** As a *Compliance Officer*, I want guarantor message templates to be legally reviewed and version-controlled, so wording stays compliant.

### E8 — Interaction history & memory
- **E8.1 (M, P0)** As a *Recovery Officer*, I want a full history of every interaction (channel, time, language, outcome, recording link), so I can see what happened.
- **E8.2 (S, P2)** As the *AI Agent*, I want to recall relevant context from past conversations (e.g., a prior promise-to-pay date), so I don't repeat myself and sound informed.
- **E8.3 (M, P2)** As the *system*, I want to track which human officer handled each escalation and the outcome.

### E9 — Payments & resolution
- **E9.1 (S, P1)** As a *borrower*, I want to pay via a one-tap link (WhatsApp/UPI), so paying is frictionless.
- **E9.2 (S, P3)** As a *borrower*, I want to pay during the call (IVR/DTMF or generated link), so I can resolve immediately.
- **E9.3 (C, P4)** As a *borrower in hardship*, I want a tailored restructuring/settlement offer within bank-approved limits, so I have a realistic way to pay.

### E10 — Human handoff & agent assist
- **E10.1 (M, P2)** As the *AI Agent*, I want to hand off to a human with full context when a case needs it (distress, dispute, complex negotiation).
- **E10.2 (S, P4)** As a *Recovery Officer*, I want real-time AI suggestions during my own calls (co-pilot), so I respond better.

### E11 — Intelligence (scoring, sentiment, early warning)
- **E11.1 (S, P4)** As the *system*, I want a propensity-to-pay and best-time-to-contact score per borrower, so outreach is prioritised and personalised.
- **E11.2 (S, P3/P4)** As the *system*, I want to detect borrower distress/anger in real time and adapt tone or escalate, so vulnerable customers are handled with care.
- **E11.3 (C, P4)** As the *system*, I want early-warning signals (e.g., from Account Aggregator) to flag risk before an EMI bounces.

### E12 — Reporting & analytics
- **E12.1 (S, P4)** As a *manager*, I want a dashboard of recovery rate, PTP conversion, contactability, channel/language mix, and cost-per-recovery.
- **E12.2 (S, P4)** As a *Compliance Officer*, I want automated QA on every call (not a sample) flagging any non-compliant language.

### E13 — Admin & configurable rule engine
- **E13.1 (M, P0)** As a *Compliance Officer*, I want to configure conduct rules (calling hours, frequency caps, thresholds, retention) without code changes, so we absorb RBI updates.
- **E13.2 (M, P5)** As a *System Admin*, I want to manage languages, voice personas, and message templates.
- **E13.3 (S, P5)** As a *System Admin*, I want multi-tenant isolation, so one deployment can serve multiple bank clients with separated data.

---

## 5. Non-functional requirements (NFRs)

| # | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Perceived voice-response latency < 800 ms per turn; ASR partials < 100 ms. |
| NFR-2 | Scalability | Tier-B target 50–100 concurrent calls; scale horizontally to hundreds–thousands. |
| NFR-3 | Availability | 24×7 operation; 99.9%+ uptime; no outreach outside 08:00–19:00 borrower-local. |
| NFR-4 | Data residency | All data and recordings stored on servers physically located in India. |
| NFR-5 | Security | Encryption in transit + at rest; least-privilege CBS access (read-only replica); secrets in Vault/HSM; network segmentation. |
| NFR-6 | Privacy (DPDP) | Per-channel consent; purpose limitation; easy opt-out; sensitive/biometric data explicitly consented and protected. |
| NFR-7 | Auditability | 100% of calls recorded; all interactions logged with gate-decision trail; tiered retention (90/180 days → up to 7 years litigation). |
| NFR-8 | Deployability | On-premises; air-gap (no-internet) capable; containerised. |
| NFR-9 | Language | Coverage of required Indian languages; automatic mid-call language switching; graceful Hinglish/code-mixed handling. |
| NFR-10 | Accuracy/Integrity | All financial figures sourced from the ledger; the model never generates balances or offers outside approved limits. |
| NFR-11 | Configurability | Conduct rules adjustable via config to absorb regulatory change. |

---

## 6. Dependencies & assumptions

- Read-only integration access to the CBS (API, DB views, or CDC) is available.
- WhatsApp Business API account and pre-approved Utility templates are provisioned.
- SIP trunk / telephony connectivity is available for outbound/inbound calls.
- Verified borrower and guarantor phone numbers and consent exist or are collected at onboarding.
- On-prem GPU infrastructure (see separate Hardware Specification) is provisioned.
- Legal/compliance team reviews and signs off all message/voice scripts and guarantor templates.

---

## 7. Out of scope (initial release)

- Contacting any third party other than borrower and registered guarantor.
- Field-collection / physical-visit scheduling.
- Cross-border (non-India) language coverage.
- Autonomous legal action without human/advocate approval.
- WhatsApp use for late-stage/aggressive recovery messaging.

---

## 8. Suggested story-mapping spine (for the BA's board)

P0 Foundation → E1, E2, E3, E8.1, E13.1
P1 Messaging → E4, E5, E9.1
P2 Escalation → E7, E8.2/8.3, E10.1
P3 Voice → E6, E9.2, E11.2 (basic)
P4 Intelligence → E11, E12
P5 Productisation → E13.2/13.3
