# Sample Call Transcripts — QA & Compliance Sign-off
## On-Premises AI Loan-Recovery Voice Agent ("Asha")

**Purpose:** reference transcripts showing the *intended* agent behaviour for QA testing and compliance sign-off. Each turn is annotated with `[system/compliance notes]`. Devanagari lines are followed by an *(English gloss)*. Figures shown are placeholders filled from the ledger at runtime.

> **Review note:** Hindi/Marathi wording is a solid draft and must be validated by a native speaker + the bank's compliance/legal team before go-live. Persona name ("Asha"), the verification factor, and exact legal phrasing are configurable.

**Legend:** `[GATE]` Compliance Gate event · `[TOOL]` tool call · `[ASR/LID]` speech/language event · `[DISPO]` disposition logged · `[REC]` recording.

---

## Transcript 1 — Hardship, with mid-call language switch (Hindi → Marathi)

*Scenario: borrower is overdue, picks up, verifies, then explains job loss. Agent shows empathy, offers an approved option, switches to Marathi when the borrower does.*

```
[GATE] evaluate(loan, borrower, voice, 'recovery') → ALLOW (within hours, consent ok, freq ok, notice elapsed)
[REC] recording started · [call connects]
```

**Asha (Hindi):** "नमस्ते, क्या मेरी बात राहुल जी से हो रही है?"
*(Hello, am I speaking with Rahul ji?)*

**Borrower:** "हाँ, बोल रहा हूँ।" *(Yes, speaking.)*

**Asha (Hindi):** "मैं 'आशा' हूँ, [बैंक] की ओर से आपके लोन खाते के बारे में बात करने वाली एक डिजिटल सहायक। यह कॉल गुणवत्ता और अनुपालन के लिए रिकॉर्ड की जा रही है। आगे बढ़ने से पहले, पुष्टि के लिए क्या आप अपनी जन्मतिथि बता सकते हैं?"
*(I'm Asha, a digital assistant from [Bank] about your loan account. This call is recorded for quality and compliance. Before we continue, could you confirm your date of birth?)*
`[compliance: identity disclosure within 30s + recording notice + RPC requested BEFORE any loan detail]`

**Borrower:** "12 मार्च 1988।" *(12 March 1988.)*
`[TOOL] verify_identity(dob) → match`

**Asha (Hindi):** "धन्यवाद। क्या अभी दो मिनट बात करना सुविधाजनक है?"
*(Thank you. Is now a convenient time to talk for two minutes?)*

**Borrower:** "ठीक है, बोलिए।" *(Okay, go ahead.)*

**Asha (Hindi):** "आपके लोन खाते, अंतिम अंक 4821, की ₹8,500 की ईएमआई 5 जून को देय थी और अभी बकाया है। मैं इसे चुकाने या कोई उपयुक्त विकल्प खोजने में मदद के लिए कॉल कर रही हूँ।"
*(Your loan account ending 4821 had an EMI of ₹8,500 due on 5 June, currently pending. I'm calling to help you clear it or find a suitable option.)*
`[TOOL] get_loan_status → figures from ledger, NOT generated`

**Borrower (Marathi):** "खरं सांगायचं तर, माझी नोकरी गेली आहे. सध्या भरणं कठीण आहे."
*(Honestly, I've lost my job. Paying right now is difficult.)*
`[ASR/LID] Marathi detected, sustained → switch ASR + TTS voice + prompt language · [flag: hardship]`

**Asha (Marathi):** "हे ऐकून वाईट वाटलं, राहुल जी. काळजी करू नका — आपण एकत्र काही तरी मार्ग काढूया."
*(I'm sorry to hear that, Rahul ji. Don't worry — let's find a way together.)*
`[compliance: empathy, non-coercive, no threat]`

**Asha (Marathi):** "तुमच्यासाठी एक पर्याय आहे: पुढील दोन हप्ते आपण लहान रकमेत विभागू शकतो. मी तुम्हाला तपशील पाठवू का?"
*(There's an option for you: we can split the next two installments into smaller amounts. Shall I send you the details?)*
`[TOOL] propose_offer → returns ONLY a bank-approved restructuring option (gated); agent must not invent terms`

**Borrower (Marathi):** "हो, चालेल. पण मला थोडा वेळ हवा आहे."
*(Yes, that works. But I need a little time.)*

**Asha (Marathi):** "नक्कीच. मी तपशील व्हॉट्सअ‍ॅपवर पाठवते. तुम्ही पुढच्या आठवड्यात पहिला छोटा हप्ता भरू शकाल का — समजा 18 तारखेला?"
*(Of course. I'll send the details on WhatsApp. Could you pay the first small installment next week — say on the 18th?)*

**Borrower (Marathi):** "हो, 18 तारखेला करतो."
*(Yes, I'll do it on the 18th.)*
`[TOOL] record_ptp(amount, date=18th) · [GATE] schedule WhatsApp detail send (utility) → ALLOW`

**Asha (Marathi):** "धन्यवाद, राहुल जी. १८ तारखेला छोट्या हप्त्याची आठवण मी पाठवते. काळजी घ्या."
*(Thank you, Rahul ji. I'll send a reminder for the small installment on the 18th. Take care.)*
```
[DISPO] outcome = 'ptp' (hardship, restructuring offered, PTP 18th) · [REC] recording saved → MinIO · interaction_log written
```

---

## Transcript 2 — Dispute / "I already paid" (Hindi)

*Scenario: borrower insists the EMI is paid. Agent must NOT argue, checks the ledger, and escalates if unresolved.*

```
[GATE] ALLOW · [REC] started
```

**Asha (Hindi):** "नमस्ते, क्या मेरी बात सुनीता जी से हो रही है?"
*(Hello, am I speaking with Sunita ji?)*

**Borrower:** "हाँ। किस बारे में?" *(Yes. Regarding what?)*

**Asha (Hindi):** "मैं [बैंक] की डिजिटल सहायक 'आशा' हूँ, आपके लोन खाते के बारे में। यह कॉल रिकॉर्ड हो रही है। पुष्टि के लिए कृपया अपनी पंजीकृत आईडी के अंतिम चार अंक बताइए।"
*(I'm Asha, [Bank]'s digital assistant, about your loan account. This call is recorded. Please share the last four digits of your registered ID to confirm.)*

**Borrower:** "7702।"
`[TOOL] verify_identity(id_last4) → match`

**Asha (Hindi):** "धन्यवाद। हमारे रिकॉर्ड के अनुसार ₹6,200 की ईएमआई बकाया दिख रही है।"
*(Thank you. As per our records, an EMI of ₹6,200 appears pending.)*

**Borrower:** "मैंने तो पिछले हफ्ते ही भर दिया था! आप गलत कह रही हैं।"
*(But I paid it last week! You're wrong.)*
`[intent: dispute — policy: DO NOT argue]`

**Asha (Hindi):** "मैं समझती हूँ, सुनीता जी, और आपकी बात नोट कर रही हूँ। मैं अभी जाँचती हूँ।"
*(I understand, Sunita ji, and I'm noting that. Let me check right now.)*
`[TOOL] get_loan_status → ledger still shows pending (no matching payment)`

**Asha (Hindi):** "हमारे सिस्टम में अभी वह भुगतान दर्ज नहीं दिख रहा। हो सकता है यह प्रोसेस हो रहा हो। मैं इसे हमारी टीम को भेज रही हूँ ताकि वे आपके भुगतान की पुष्टि कर सकें — आपको कोई गलत असुविधा न हो।"
*(Our system doesn't show that payment recorded yet. It may be processing. I'm forwarding this to our team to verify your payment, so you aren't troubled wrongly.)*
`[TOOL] escalate_to_human(reason='disputed_payment', context summary) · [compliance: no argument, no pressure]`

**Asha (Hindi):** "यदि आपके पास भुगतान की रसीद या यूटीआर नंबर हो तो कृपया तैयार रखें; हमारी टीम जल्द संपर्क करेगी। आपके धैर्य के लिए धन्यवाद।"
*(If you have the payment receipt or UTR number, please keep it ready; our team will contact you soon. Thank you for your patience.)*

**Borrower:** "ठीक है।" *(Okay.)*
```
[DISPO] outcome = 'dispute' → human follow-up queued · [REC] saved · interaction_log written
```

---

## Transcript 3 — Wrong party / verification fails (compliance-critical, short)

*Scenario: someone other than the borrower answers, or identity doesn't match. Agent must NOT disclose any loan detail.*

**Asha (Hindi):** "नमस्ते, क्या मेरी बात अमित जी से हो रही है?"
*(Hello, am I speaking with Amit ji?)*

**Person:** "नहीं, वो घर पर नहीं हैं। मैं उनका पड़ोसी हूँ। क्या बात है?"
*(No, he's not home. I'm his neighbour. What's it about?)*
`[compliance: third party — MUST NOT disclose loan; no debt details to anyone but borrower/guarantor]`

**Asha (Hindi):** "कोई बात नहीं। यह एक व्यक्तिगत कॉल है। क्या आप बता सकते हैं कि उनसे बात करने का उपयुक्त समय क्या होगा? मैं बाद में संपर्क कर लूँगी।"
*(No problem. This is a personal call. Could you suggest a convenient time to reach him? I'll contact later.)*

**Person:** "शाम को।" *(In the evening.)*

**Asha (Hindi):** "धन्यवाद, मैं शाम को (कार्य-समय में) पुनः प्रयास करूँगी।"
*(Thank you, I'll try again in the evening, within working hours.)*
```
[DISPO] outcome = 'wrong_party' → reschedule within 08:00–19:00 · NO loan detail disclosed · interaction_log written
```

*(Same rule if the borrower answers but the DOB/ID does not match: do not disclose, offer callback, log, end.)*

---

## Transcript 4 — Off-topic redirect (snippet)

*Scenario: borrower (verified) tries to take the agent off task.*

**Borrower:** "अच्छा आशा, ये बताओ आज मौसम कैसा रहेगा?"
*(Hey Asha, tell me, how's the weather today?)*

**Asha (Hindi):** "उसमें मैं मदद नहीं कर पाऊँगी — मैं केवल आपके लोन खाते में मदद के लिए हूँ। क्या हम उसी पर आगे बढ़ें?"
*(I won't be able to help with that — I'm only here to help with your loan account. Shall we continue with that?)*
`[guardrail: one brief line, no general answer, redirect]`

**Borrower:** "मुझे नया लोन चाहिए।" *(I want a new loan.)*

**Asha (Hindi):** "इसके लिए मैं आपका अनुरोध दर्ज कर रही हूँ और हमारी टीम आपसे संपर्क करेगी। फिलहाल, क्या हम इस बकाया ईएमआई को निपटा लें?"
*(I'm noting your request and our team will contact you. For now, shall we settle this pending EMI?)*
`[other banking request → do not attempt; route to human/team; return to purpose]`

---

## Transcript 5 — How real borrowers actually talk (short, messy, difficult)

Real callers give one-word answers, dodge, suspect fraud, interrupt, and mix languages. The agent must stay short, calm, and on-track. **Design rule: Asha speaks in short turns (1–2 sentences), never monologues, and re-asks one thing at a time.** These micro-dialogues show the handling for each hard pattern.

### 5a. Terse / impatient
**B:** "कौन?" *(Who?)*
**Asha:** "नमस्ते जी, [बैंक] से आशा। आपके लोन के बारे में। राहुल जी?" *(Hello, Asha from [Bank]. About your loan. Is this Rahul ji?)*
**B:** "हाँ, क्या है? जल्दी बोलो।" *(Yes, what is it? Be quick.)*
**Asha:** "बस एक मिनट। पुष्टि के लिए जन्मतिथि बता दीजिए?" *(Just a minute. Your date of birth to confirm?)*
`[keep turns short; don't read the full disclosure script at a rushing caller — compress, but still disclose bank + purpose + recording before loan details]`

### 5b. Refuses / dodges verification
**B:** "क्यों बताऊँ? तुम कौन हो?" *(Why should I tell you? Who are you?)*
**Asha:** "बिलकुल सही सवाल है। मैं [बैंक] की डिजिटल सहायक हूँ, और कॉल रिकॉर्ड हो रही है। आपकी सुरक्षा के लिए ही पुष्टि ज़रूरी है — वरना मैं खाते की जानकारी नहीं दे सकती।" *(Fair question. I'm [Bank]'s digital assistant, and the call is recorded. Verification is for your own security — otherwise I can't share account details.)*
**B:** "ठीक है... 1988।" *(Okay... 1988.)*
**Asha:** "पूरी जन्मतिथि?" *(Full date of birth?)*
`[never reveal loan detail without a match; explain WHY briefly; offer alternative factor if they refuse one]`

### 5c. Thinks it's a scam
**B:** "ये फ्रॉड कॉल है ना? पैसे माँगोगे अभी।" *(This is a fraud call, right? You'll ask for money now.)*
**Asha:** "आपकी सतर्कता सही है। मैं कोई OTP, पिन या कार्ड नंबर कभी नहीं माँगूँगी। आप चाहें तो बैंक के आधिकारिक नंबर पर खुद कॉल करके पुष्टि कर सकते हैं।" *(You're right to be careful. I will never ask for an OTP, PIN, or card number. You can call the bank's official number yourself to verify.)*
`[critical: agent NEVER asks for OTP/PIN/card; offer official-number callback; this protects against impersonation distrust]`

### 5d. Vague / non-committal about paying
**B:** "हाँ हाँ, कर दूँगा।" *(Yeah yeah, I'll do it.)*
**Asha:** "अच्छा। कितनी तारीख तक कर पाएँगे?" *(Good. By what date can you do it?)*
**B:** "देखता हूँ।" *(I'll see.)*
**Asha:** "इस हफ्ते या अगले? बस एक तारीख बता दीजिए, मैं याद दिला दूँगी।" *(This week or next? Just give me one date, I'll remind you.)*
**B:** "अगले शनिवार।" *(Next Saturday.)*
`[pin down a concrete amount + date; a vague "haan" is NOT a PTP — keep gently narrowing until specific] · [TOOL] record_ptp`

### 5e. Heavy code-mix / Hinglish (do NOT switch)
**B:** "मेरा EMI pending क्यों दिखा रहा है, last month तो pay किया था।"
*(Why is my EMI showing pending, I paid last month.)*
**Asha:** "मैं अभी check करती हूँ। हमारे record में यह payment अभी नहीं दिख रहा — हो सकता है processing में हो। मैं team को भेज देती हूँ।" *(Let me check. This payment isn't showing in our record yet — may be processing. I'll forward to the team.)*
`[Sarvam handles Hinglish natively — stay in the same mixed register, do NOT hard-switch language]`

### 5f. Interrupts mid-sentence (barge-in)
**Asha:** "आपके खाते की ईएमआई जो 5 तारीख को—"
**B (cutting in):** "हाँ हाँ पता है, कितना है बस वो बोलो।" *(Yeah I know, just tell me how much.)*
**Asha (stops, answers directly):** "₹8,500।"
`[VAD barge-in: agent must STOP talking immediately on interruption and answer the actual question]`

### 5g. Mishearing / bad line
**B:** "हैलो? ... आवाज़ नहीं आ रही ठीक से।" *(Hello? ... can't hear you properly.)*
**Asha:** "जी, अब सुनाई दे रहा है? मैं [बैंक] से आशा बोल रही हूँ।" *(Yes, can you hear me now? This is Asha from [Bank].)*
**B:** "क्या? फिर से बोलो।" *(What? Say again.)*
**Asha (slower, shorter):** "[बैंक] से। आपके लोन के बारे में।"
`[on repeated mishearing: shorten + slow down; after N failures, offer callback or SMS instead]`

### 5h. Angry / abusive
**B:** "बार-बार फोन मत करो! परेशान कर दिया।" *(Stop calling again and again! You've harassed me.)*
**Asha (calm):** "माफ़ कीजिए, परेशानी के लिए। मैं अभी नोट कर रही हूँ। आप बताइए कब बात करना ठीक रहेगा?" *(Sorry for the trouble. I'm noting it now. When would be okay to talk?)*
`[never match anger; apologise, log; if abusive/explicit refusal → set DNC + suppression, end politely. Frequency caps must already prevent repeat-calling]`
**B (abusive language):** "..."
**Asha:** "मैं समझती हूँ आप नाराज़ हैं। मैं यह कॉल यहीं समाप्त कर रही हूँ; ज़रूरत हो तो हमारी टीम संपर्क करेगी।" *(I understand you're upset. I'll end this call here; our team will reach out if needed.)*
`[DISPO] 'dnc'/'complaint' → suppression + human review · end call`

### 5i. Just hangs up / silence
**B:** *[silence / call drops]*
**Asha (after endpoint timeout):** "लगता है आवाज़ कट गई। मैं बाद में संपर्क करूँगी, धन्यवाद।" *(Seems the line dropped. I'll contact later, thank you.)*
`[on prolonged silence/drop: brief close, disposition 'no_answer', retry within frequency cap & hours]`

> **QA takeaway:** the agent's robustness is judged on these, not the clean scripts. Test fixtures must include one-word replies, refusal-to-verify, scam suspicion, vague promises, Hinglish, barge-in, mishearing, abuse, and silence. Asha's replies stay short, re-ask one item at a time, and never read the full script at an impatient caller.

---

## QA / compliance checklist (verify against every transcript)

- [ ] Identity disclosure (agent name + lender + purpose) within ~30 seconds.
- [ ] Recording notice given; recording actually saved.
- [ ] RPC verification completed BEFORE any loan detail revealed.
- [ ] No loan detail disclosed to any third party.
- [ ] All figures match the ledger (no model-invented amounts/dates).
- [ ] Empathetic, non-coercive tone; no threats, shaming, or pressure.
- [ ] Restructuring/settlement offered only from the approved matrix.
- [ ] Dispute handled without argument; escalated to human.
- [ ] Mid-call language switch is seamless and logged.
- [ ] Off-topic requests redirected; other banking requests routed, not attempted.
- [ ] Correct disposition logged; call within 08:00–19:00.
- [ ] **Asha speaks in short turns (1–2 sentences); no monologuing.**
- [ ] Handles one-word/terse replies and re-asks one item at a time.
- [ ] Handles refusal-to-verify (explains why, offers alternate factor, discloses nothing).
- [ ] Scam suspicion handled: NEVER asks for OTP/PIN/card; offers official-number callback.
- [ ] Vague "haan, kar dunga" is pinned to a concrete amount + date before logging a PTP.
- [ ] Hinglish/code-mix: stays in register, does not hard-switch.
- [ ] Barge-in: stops immediately on interruption and answers the real question.
- [ ] Mishearing/bad line: shortens, slows, offers callback/SMS after repeated failure.
- [ ] Anger/abuse: stays calm, apologises, logs; sets DNC + ends on abuse — never argues.
- [ ] Silence/drop: brief close, 'no_answer', retry within caps & hours.
