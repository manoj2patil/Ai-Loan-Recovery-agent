# Database Schema Reference (generated from database-backup.json)

Real export from **Sahakar Krishi Vikas Cooperative Bank Ltd. (SKVCB)**. Field names are Prisma-style camelCase. Use these EXACT names when building models/migrations so the data loads with no mapping errors.

## Tables & row counts

| Table | Rows |
|---|---|
| Customer | 64 |
| Loan | 131 |
| Installment | 16344 |
| Guarantor | 99 |
| InteractionLog | 181 |
| WhatsappTemplate | 10 |
| WhatsappMessage | 84 |
| VoiceCall | 97 |
| AgentNote | 30 |
| SemanticMemory | 52 |
| SystemConfig | 26 |
| NpaRun | 1 |

## Key relationships

- `Loan.customerId` → `Customer.id` (internal cuid, NOT customerId)
- `Installment.loanId` → `Loan.id`
- `Guarantor.linkedLoanId` → `Loan.id`  (Guarantor.customerId may be null)
- `InteractionLog.customerId`/`loanId`, `VoiceCall.*`, `WhatsappMessage.*`, `AgentNote.*`, `SemanticMemory.customerId` → respective parents
- JSON-string columns: `consent*`, `suppressionFlags`, `complianceGate`, `variables`, `emotionTags`, `details`, `embedding` (stringified)

## Customer

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69aoa000tst8ouopkj3dg |
| customerId | string | no | CUST10001 |
| name | string | no | Rema Thampi |
| maskedAadhaar | string | yes | XXXX-XXXX-0738 |
| maskedPan | string | yes | EBP6818C |
| preferredLanguage | string | no | ml |
| phone | string | no | +919224931447 |
| altPhone | string | yes | +917570299310 |
| email | string | yes | rema.thampi0@email.com |
| addressLine | string | yes | 5, Subhash Marg |
| city | string | no | Kozhikode |
| state | string | yes | Kerala |
| pincode | string | yes | 673001 |
| consentSms | json-string | no | {"granted":true,"ts":"2026-06-26T16:55:13.737... |
| consentWhatsapp | json-string | no | {"granted":true,"ts":"2026-06-26T16:55:13.737... |
| consentVoice | json-string | no | {"granted":true,"ts":"2026-06-26T16:55:13.737... |
| suppressionFlags | json-string | no | {"doNotCall":false,"bankruptcyNotice":false,"... |
| createdAt | datetime | no | 2026-06-26T16:55:13.738Z |
| updatedAt | datetime | no | 2026-06-26T16:55:13.738Z |

*`preferredLanguage` values:* bn, en, gu, hi, kn, ml, mr, pa, ta, te

*`state` values:* Andhra Pradesh, Bihar, Gujarat, Karnataka, Kerala, Madhya Pradesh, Maharashtra, Punjab, Rajasthan, Tamil Nadu, Telangana, West Bengal

## Loan

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69aoc000vst8o4cy0dfzq |
| loanId | string | no | LN500001 |
| customerId | string | no | cmqv69aoa000tst8ouopkj3dg |
| productType | string | no | PERSONAL |
| principal | int | no | 416839 |
| sanctionedDate | datetime | no | 2023-07-17T16:55:13.737Z |
| tenureMonths | int | no | 180 |
| interestRate | float|int | no | 13.5 |
| emiAmount | int | no | 5412 |
| disbursalDate | datetime | no | 2023-08-08T16:55:13.737Z |
| totalOutstanding | int | no | 936276 |
| pendingAmount | int | no | 936276 |
| pendingInstallments | int | no | 173 |
| nextDueDate | datetime | yes | 2026-07-23T16:55:13.737Z |
| assetClassification | string | no | DOUBTFUL |
| dpd | int | no | 1023 |
| npaSinceDate | datetime | yes | 2023-12-06T16:55:13.737Z |
| sarfaesiNoticeDate | datetime | yes | 2025-01-26T16:55:13.737Z |
| lastRecomputedAt | datetime | yes | 2026-06-26T16:55:13.737Z |
| createdAt | datetime | no | 2026-06-26T16:55:13.740Z |
| updatedAt | datetime | no | 2026-06-26T16:55:13.742Z |

*`productType` values:* AGRICULTURE, AUTO, EDUCATION, GOLD, HOME, HOMELOAN, MSME, MSMELOAN, PERSONAL, PERSONALLO, TWOWHEELER

*`assetClassification` values:* DOUBTFUL, LOSS, STANDARD, SUB_STANDARD

## Installment

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69aof000xst8o8smwjlja |
| loanId | string | no | cmqv69aoc000vst8o4cy0dfzq |
| installmentNo | int | no | 1 |
| dueDate | datetime | no | 2023-09-07T16:55:13.737Z |
| installmentAmount | int | no | 5412 |
| paidFlag | bool | no | False |
| paidDate | datetime | yes | 2025-02-26T16:55:13.737Z |
| paidAmount | int | no | 0 |
| daysPastDue | int | no | 1023 |
| createdAt | datetime | no | 2026-06-26T16:55:13.744Z |
| updatedAt | datetime | no | 2026-06-26T16:55:13.744Z |

## Guarantor

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69av800hpst8ojmawg550 |
| guarantorId | string | no | GRT70003 |
| linkedLoanId | string | no | cmqv69aue00fnst8oruj9te15 |
| customerId | string | yes | cmqv69aoa000tst8ouopkj3dg |
| name | string | no | Pradeep Thampi |
| phone | string | no | +919956052981 |
| relationship | string | no | SPOUSE |
| consentWhatsapp | json-string | no | {"granted":false,"ts":"2026-06-26T16:55:13.73... |
| consentVoice | json-string | no | {"granted":true,"ts":"2026-06-26T16:55:13.737... |
| escalationStatus | string | no | NONE |
| lastEscalatedAt | datetime | yes | 2026-06-09T16:55:13.737Z |
| createdAt | datetime | no | 2026-06-26T16:55:13.989Z |
| updatedAt | datetime | no | 2026-06-26T16:55:13.989Z |

*`relationship` values:* BUSINESS_PARTNER, COLLEAGUE, PARENT, SIBLING, SPOUSE

*`escalationStatus` values:* ELIGIBLE, NONE, NOTIFIED

## InteractionLog

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69kg30pn2st8ooz4rfiwv |
| customerId | string | no | cmqv69e7w09gjst8or2q5td4p |
| loanId | string | no | cmqv69e7x09glst8opcqeu1yk |
| channel | string | no | WHATSAPP |
| direction | string | no | OUTBOUND |
| language | string | no | gu |
| startedAt | datetime | no | 2026-06-23T16:55:13.737Z |
| endedAt | datetime | yes | 2026-06-23T16:59:13.737Z |
| outcome | string | yes | NO_ANSWER |
| outcomeNotes | datetime|string | yes | Customer disputes the outstanding amount |
| promiseToPayDate | datetime | yes | 2026-07-06T16:55:13.737Z |
| promiseToPayAmount | int | yes | 3077 |
| recordingUrl | string | yes | recordings/LN500511-1781369713737.wav |
| transcript | datetime|string | yes | Agent: कॉल की, कोई ने उठाई नहीं। |
| sentimentScore | float | yes | 0.7340915420101666 |
| complianceGate | json-string | no | {"consent":true,"withinHours":true,"freqCapOk... |
| agentType | string | no | AI |
| humanAgentId | string | yes | AGT-007 |
| createdAt | datetime | no | 2026-06-26T16:55:26.403Z |

*`channel` values:* SMS, VISIT, VOICE, WHATSAPP

*`language` values:* bn, en, gu, hi, kn, ml, mr, pa, ta, te

*`outcome` values:* CALLBACK, DISPUTE, HARDSHIP, INITIAL_CONTACT, NO_ANSWER, PAID, PARTIAL_PAYMENT, PROMISE_TO_PAY, REFUSED, VERIFICATION, VERIFICATION_PENDING

*`agentType` values:* AI, HUMAN

## WhatsappTemplate

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69any000jst8okz3yxwrv |
| templateName | string | no | emi_due_reminder |
| category | string | no | UTILITY |
| language | string | no | hi |
| bodyText | string | no | प्रिय {{1}} जी, आपके ऋण (खाता {{2}}) की किस्त... |
| headerType | string | no | TEXT |
| headerText | string | no | EMI अनुस्मारक |
| buttonText | string | yes | अभी भुगतान करें |
| buttonUrl | json-string | yes | {{5}} |
| status | string | no | APPROVED |
| variablesSchema | json-string | no | ["customer_name","loan_id","emi_amount","due_... |
| createdAt | datetime | no | 2026-06-26T16:55:13.727Z |
| updatedAt | datetime | no | 2026-06-26T16:55:13.727Z |

*`language` values:* en, hi, ta, te

*`headerText` values:* EMI Reminder, EMI अनुस्मारक, EMI நினைவூட்டல், EMI రిమైండర్, NPA वर्गीकरण सूचना, ऋण बंद पुष्टि, गारंटर सूचना, भुगतान पुष्टि, वादा याद दिलाना, ⚠️ अतिदेय सूचना

*`buttonText` values:* Pay Now, अभी भुगतान करें, भुगतान करें, இப்போது செலுத்தவும்

## WhatsappMessage

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69kjd0ptqst8o4lki842o |
| customerId | string | no | cmqv69c5t03yust8obo5q245n |
| loanId | string | no | cmqv69c7i043mst8owvqlft1s |
| templateId | string | yes | cmqv69ao4000ost8ocmkjzkjw |
| direction | string | no | OUTBOUND |
| toPhone | string | no | +919369874551 |
| fromPhone | string | yes | +918000000000 |
| body | datetime|string | no | प्रिय Sunita Dubey जी, आपके ऋण (LN500092) की ... |
| status | string | no | DELIVERED |
| wamid | string | yes | wamid.kvta1fgwp3 |
| errorMessage | null | yes | None |
| variables | json-string | no | {"customer_name":"Sunita Dubey","loan_id":"LN... |
| sentAt | datetime | no | 2026-06-13T16:55:13.737Z |
| deliveredAt | datetime | yes | 2026-06-13T16:55:13.737Z |
| readAt | datetime | yes | 2026-06-19T17:09:37.737Z |
| createdAt | datetime | no | 2026-06-26T16:55:26.522Z |

*`status` values:* DELIVERED, FAILED, READ, SENT

## VoiceCall

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69kl80py6st8o5v9hz6al |
| customerId | string | no | cmqv69bjx029ast8o11thncbg |
| loanId | string | no | cmqv69bjy029cst8oka5m7ee4 |
| direction | string | no | OUTBOUND |
| toPhone | string | no | +918955276364 |
| fromPhone | string | yes | +918000000000 |
| language | string | no | te |
| detectedLanguage | string | yes | te |
| startedAt | datetime | no | 2026-06-25T16:55:13.737Z |
| endedAt | datetime | yes | 2026-06-25T16:57:45.737Z |
| durationSec | int | no | 152 |
| status | string | no | COMPLETED |
| outcome | string | yes | PAID |
| transcript | datetime|string | yes | AI Agent: नमस्ते, मैं सहकारी बैंक से बोल रहा ... |
| recordingUrl | string | yes | recordings/voice-LN500051-1782406513737.wav |
| ttsEngine | string | no | sarvam |
| asrEngine | string | no | indic-conformer |
| llmEngine | string | no | sarvam-30b |
| llmModel | string | yes | sarvam-30b |
| sentimentScore | float | yes | -0.93935606380065 |
| emotionTags | json-string | no | ["anxious"] |
| complianceGate | json-string | no | {"consent":true,"withinHours":true,"freqCapOk... |
| agentType | string | no | AI |
| humanAgentId | null | yes | None |
| createdAt | datetime | no | 2026-06-26T16:55:26.588Z |

*`fromPhone` values:* +16292911768, +918000000000

*`language` values:* bn, en, gu, hi, kn, ml, mr, pa, ta, te

*`detectedLanguage` values:* bn, en, gu, hi, kn, ml, mr, pa, ta, te

*`status` values:* COMPLETED, INITIATED, NO_ANSWER

*`outcome` values:* CALLBACK, DISPUTE, HARDSHIP, NO_ANSWER, PAID, PROMISE_TO_PAY, REFUSED, VERIFICATION_PENDING

*`ttsEngine` values:* indic-parler, sarvam

*`asrEngine` values:* indic-conformer, sarvam, twilio-gather

*`llmEngine` values:* sarvam-105b, sarvam-30b

*`llmModel` values:* sarvam-105b, sarvam-30b

## AgentNote

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69kmg0q0est8otue65mdo |
| customerId | string | no | cmqv69jrn0nxist8ohwo8r0mq |
| loanId | string | no | cmqv69jro0nxkst8o9fks6pdr |
| agentId | string | no | AGT-012 |
| agentName | string | no | Sneha Patil |
| note | string | no | Dispute regarding interest calculation, escal... |
| tags | json-string | no | ["dispute"] |
| createdAt | datetime | no | 2026-06-26T16:55:26.633Z |

*`agentName` values:* Priya Nair, Rahul Verma, Sneha Patil

## SemanticMemory

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69kn00q22st8o0hqvwys6 |
| customerId | string | no | cmqv69b9c01hkst8oxjo64qiy |
| sourceInteractionId | string | yes | cmqv8vfm30006st0u8m06wshx |
| content | datetime|string | no | Guarantor is cooperative and willing to mediate. |
| embedding | null | yes | None |
| language | string | no | bn |
| createdAt | datetime | no | 2026-06-26T16:55:26.652Z |

*`language` values:* bn, en, gu, hi, kn, ml, mr, pa, ta, te

## SystemConfig

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69anj0000st8oadjytf4u |
| key | string | no | LLM_ENGINE |
| value | string | no | sarvam-30b |
| category | string | no | LLM |
| description | string | no | Live voice brain LLM |
| isSecret | bool | no | False |
| updatedAt | datetime | no | 2026-06-26T16:55:13.711Z |

*`category` values:* ASR, BANK, COMPLIANCE, LLM, NPA, SARVAM, TTS, WABA

## NpaRun

| Field | Type | Nullable | Example |
|---|---|---|---|
| id | string | no | cmqv69knf0q3fst8onnvanm4h |
| startedAt | datetime | no | 2026-06-25T16:55:13.737Z |
| finishedAt | datetime | no | 2026-06-25T16:55:13.737Z |
| loansProcessed | int | no | 0 |
| newNpaCount | int | no | 0 |
| escalatedToGuarantor | int | no | 0 |
| status | string | no | COMPLETED |
| details | json-string | no | {"note":"Initial baseline — run engine from d... |

## JSON-string sub-schemas (parse these)

```
consentSms/Whatsapp/Voice : {"granted": bool, "ts": iso, "source": str}
suppressionFlags          : {"doNotCall": bool, "bankruptcyNotice": bool, "deceased": bool}
complianceGate            : {"consent": bool, "withinHours": bool, "freqCapOk": bool, "thirdPartyOk": bool}
```

## SystemConfig (rule engine + stack — drives the whole system)

| key | value |
|---|---|
| LLM_ENGINE | sarvam-30b |
| LLM_REASONING_ENGINE | sarvam-105b |
| LLM_SERVING | SGLang |
| ASR_ENGINE | indic-conformer |
| TTS_ENGINE | indic-parler |
| LANG_ID | speechbrain-ecapa |
| WABA_PROVIDER | meta-cloud-api |
| WABA_PHONE_NUMBER_ID | 108XXXXXXXX |
| WABA_BUSINESS_ID | BANK_COOP_001 |
| CALLING_HOURS_START | 9 |
| CALLING_HOURS_END | 19 |
| MAX_CALLS_PER_DAY | 2 |
| MAX_WHATSAPP_PER_DAY | 3 |
| GUARANTOR_DPD_THRESHOLD | 60 |
| NPA_DPD_THRESHOLD | 90 |
| SARFAESI_NOTICE_DAYS | 60 |
| CBS_API_URL | https://cbs.bank.coop/api/v1 |
| CBS_ETL_SCHEDULE | 0 */4 * * * |
| SARVAM_API_KEY_PRESENT | true |
| BANK_NAME | Sahakar Krishi Vikas Cooperative Bank Ltd. |
| BANK_SHORT_NAME | SKVCB |
| BANK_IFSC | SKVC0000001 |
| BANK_RBI_REG | UBD-MH-2018-045 |
| BANK_HO_ADDRESS | 1, Bank House, Shankar Seth Road, Budhwar Peth, Pune, Mah... |
| BANK_HO_PHONE | +91-20-2445-0100 |
| BANK_HO_EMAIL | recovery@skvcbank.coop |
