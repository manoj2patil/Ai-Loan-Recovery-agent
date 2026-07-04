# Hardware & Infrastructure Specification
## On-Premises AI Loan-Recovery Voice Agent

**Audience:** infrastructure / procurement / datacenter team.
**Purpose:** define the on-premises server and infrastructure required to run the AI loan-recovery agent (self-hosted LLM + speech-to-text + text-to-speech + database + telephony), 24×7, air-gap capable, with data residency in India.

---

## 1. Sizing principle

The dominant cost driver is **GPU VRAM** (to hold the LLM + speech models) and **concurrent voice-call volume**. Secondary drivers are CPU cores (telephony media + speech pre/post-processing + database) and **recording storage** (mandatory, continuously growing). Size the GPU first, then CPU/RAM, then storage.

VRAM rule of thumb: model weights ≈ 2 bytes/param at FP16/BF16, ≈ 0.5 bytes/param at 4-bit; add ~15–20% for KV-cache/activations.

---

## 2. Hardware tiers

### Tier 0 — Pilot / Proof-of-Concept
| Component | Specification |
|---|---|
| GPU | 1× NVIDIA RTX 5090 (32 GB) **or** 1× L40S (48 GB) |
| CPU | 16–24 cores (Ryzen 9 / Xeon / EPYC) |
| RAM | 128 GB |
| Storage | 2 TB NVMe SSD (OS + DB + models) + 4–8 TB for recordings |
| Capacity | LLM (30B-class, 4-bit) + ASR + TTS; ~5–10 concurrent calls; bulk messaging |
| Purpose | Validate the full voice loop end-to-end before production build |

### Tier B — Production start (recommended) — ≈ 50–100 concurrent calls
| Component | Specification |
|---|---|
| GPU | 2× NVIDIA A100 80 GB (or 2× H100). Add 2 more (total 4) when the large reasoning model runs live |
| GPU allocation | GPU-0: primary conversational LLM (BF16). GPU-1: ASR + TTS + language-ID + embeddings. GPU-2/3 (optional): large reasoning model, tensor-parallel |
| CPU | 32–64 cores (dual AMD EPYC or Intel Xeon Scalable) |
| RAM | 256–512 GB DDR5 ECC |
| Primary storage | 4 TB NVMe SSD, mirrored (RAID-1) — OS, database, model weights |
| Recording storage | 20–50 TB usable (RAID-6), expandable — ~0.5–1 MB per audio-minute compressed |
| Networking | 10 GbE internal, redundant; redundant links to SIP trunk |
| Power | Dual PSU, UPS-backed |

### Tier C — Scale / multi-tenant (vendor serving multiple banks)
| Component | Specification |
|---|---|
| GPU | 4–8× NVIDIA H100 / H200 across one or more nodes (AMD MI300X a viable alternative) |
| CPU | 64–128 cores per node |
| RAM | 512 GB – 1 TB per node |
| Storage | NVMe hot tier + 100 TB+ object store with tiered archival; full HA / replication |
| Topology | Kubernetes cluster, GPU autoscaling; separate nodes for telephony/media, inference, and data; DR site |
| Capacity | Hundreds–thousands of concurrent calls; multiple isolated bank tenants |

---

## 3. Storage detail (recordings)

- Voice recordings are **regulatory-mandatory** and stored continuously.
- Estimate: ~0.5–1 MB per audio-minute (compressed). Model expected call-minutes/day × retention period.
- **Tiered retention:** hot (90–180 days) on fast storage; cold/archive (up to 7 years for litigation-track loans) on cheaper tier.
- RAID-6 + off-box encrypted backups. Encryption at rest mandatory (sensitive PII + biometrics).

---

## 4. Networking & telephony

- 10 GbE (or higher) internal networking, redundant.
- SIP/VoIP trunk connectivity (Indian SIP provider) for PSTN/mobile termination.
- Static IP / firewall as required; isolated VLAN segment from the CBS and any shared tenant.

---

## 5. Software / OS prerequisites

- OS: Ubuntu Server 24.04 LTS.
- NVIDIA drivers + CUDA toolkit; container runtime (Docker) + Kubernetes for orchestration.
- **Air-gap capability:** ability to mirror model weights and packages internally so the system runs with no internet — required by bank security teams.

---

## 6. Reliability & security requirements

- Redundancy: UPS, dual power supplies, RAID on all data volumes, out-of-band management (IPMI/iDRAC/iLO).
- Target uptime SLA: 99.9%+.
- **Data residency:** all data and recordings on servers physically located in India.
- Encryption in transit and at rest; secrets in Vault/HSM.
- Network segmentation from the CBS; least-privilege read-only access to a CBS replica (never the live banking DB).
- If colocation: datacenter to hold ISO 27001 / SOC 2 / PCI-DSS, Tier III/IV, physical access control.

---

## 7. Scaling path

1. Start at **Tier B (2× A100 80 GB)**.
2. Measure real concurrency, GPU utilisation, ASR/TTS pressure, and KV-cache headroom.
3. Scale **GPUs horizontally** (add cards / nodes) as concurrent-call demand grows; add dedicated GPUs for the large reasoning model and for additional tenants.
4. Speech models (ASR/TTS) can be offloaded to CPU at low volume to free GPU for the LLM.

---

## 8. Procurement summary (for RFQ)

Request quotes for **Tier 0 (pilot)** and **Tier B (production)** together. Ask the vendor to:
- Recommend GPU model and count to run a 30B-class LLM **plus** speech-to-text and text-to-speech **concurrently in real time**.
- Quote hardware purchase **and** colocation/managed options.
- Confirm GPU availability, lead time, warranty, and on-site support.
- Confirm India data-residency and datacenter compliance certifications.
- State per-server power draw (kW), rack units (U), and cooling/power headroom for adding GPUs later.
