# ⚡ JOBBER

### **Autonomous Freelance Escrow with Custom AI Arbitration & Dual-Sided Reputation**

Jobber is a decentralized freelance agreement marketplace and secure escrow platform running on **GenLayer**. It protects employers and contractors by holding funds in trust and resolving subjective completion disputes trustlessly using decentralized LLM validators.

---

## 📖 Table of Contents
1. [Core Problem & Solution](#-core-problem--solution)
2. [Standout Features](#-standout-features)
3. [Lifecycle Architecture](#-lifecycle-architecture)
4. [Intelligent Contract API](#-intelligent-contract-api)
5. [Tech Stack](#-tech-stack)
6. [Developer Quickstart](#-developer-quickstart)
7. [License](#-license)

---

## 🎯 Core Problem & Solution

Traditional freelance marketplaces (Upwork, Fiverr) charge high fees and resolve disputes through centralized support agents. This process is slow (weeks), opaque, and often biased. On the other hand, deterministic smart contracts (like on Ethereum) cannot understand text specifications or evaluate subjective work submissions (e.g., "does this landing page look modern and have dark-mode support?").

**Jobber** solves this on **GenLayer**:
1. **Custody**: Escrow amounts are locked on-chain in the Intelligent Contract.
2. **Subjective Judgment**: If a dispute arises, GenLayer's AI validator nodes read the original specification requirements, the contractor's deliverable, and the dispute reason to decide a fair split.
3. **Consensus**: Multiple AI nodes must agree on the categorical verdict, and their suggested split percentages must fall within a strict tolerance window, preventing manipulation.

---

## 🚀 Standout Features

### 1. Snap-Free Wallet Integration
Instead of forcing users to install a custom browser Snap to sign GenLayer payloads, Jobber configures the client to connect directly to standard EVM wallets (MetaMask, Rabby, Frame). The app registers the **GenLayer Studio Network** (Chain ID `61999`) using standard wallet API requests, allowing direct popup transaction signing for a frictionless web3 onboarding experience.

### 2. Dual-Sided Reputation & Ratings
Jobber implements a complete feedback loop. After an agreement is completed (either through mutual approval or AI arbitration), both parties can rate each other (1-5 stars). The average rating and review counts are tracked on-chain in the contract's state (`TreeMap`), and displayed directly on the custom frontend profile badge.

### 3. Fuzzy Tolerance Consensus
LLMs rarely return identical values for decimal splits. Jobber implements a hybrid consensus validation structure inside `resolve_dispute`:
- **Categorical Verdict**: The leader and validators must agree *exactly* on the categorical decision (`contractor`, `employer`, or `split`).
- **Fuzzy Percentage**: The payout split percentage must agree within a `±10%` tolerance window. If validator assessments align within this range, the transaction is verified and executed.

### 4. Robust JSON Extraction Shield
LLM validator outputs often include markdown blocks (e.g. ` ```json `) or conversational preamble text that causes naive JSON decoders to crash. Jobber's contract implements a robust string scanner that extracts the innermost `{ ... }` block before parsing, preventing contract execution reverts from format deviations.

---

## 🔄 Lifecycle Architecture

```
 Employer                   Contractor                  AI Validators
   │                            │                            │
   │── Post Job (Lock Escrow) ──>                            │
   │                            │                            │
   │                            │── Accept Agreement ───────>│
   │                            │                            │
   │                            │── Submit Deliverable ─────>│
   │                            │                            │
   │── [EITHER] Approve ────────> Releases Escrow            │
   │                            │                            │
   │── [OR] Raise Dispute ──────> State becomes Disputed      │
   │                                                         │
   │── Trigger Arbitration ──────────────────────────────────> Run Consensus
   │                                                         │ (Compare Verdicts
   │                                                         │ & Payout splits)
   │                                                         │       │
   │<───────────────── Disburse Payouts ─────────────────────│───────┘
   │
   │── Rate Contractor ─────────>
   │<──────── Rate Employer ────│
```

---

## 📜 Intelligent Contract API

The Intelligent Contract is implemented in Python and runs on **GenVM**.

| Method Name | Type | Payable | Description |
|:---|:---:|:---:|:---|
| `create_job(title, description, requirements, duration_hours)` | Write | **Yes** | Initializes a job agreement and locks the native escrow deposit. |
| `accept_job(job_id)` | Write | No | Registers the calling freelancer as the assigned contractor. |
| `submit_work(job_id, deliverable)` | Write | No | Submits the contractor's deliverable text before the deadline. |
| `approve_work(job_id)` | Write | No | Releases 100% of the locked escrow to the contractor. |
| `raise_dispute(job_id, reason)` | Write | No | Employer rejects deliverables and flags the job for arbitration. |
| `resolve_dispute(job_id)` | Write | No | Executes GenLayer AI arbitration to calculate and disburse the split. |
| `cancel_job(job_id)` | Write | No | Employer cancels an open job and gets a refund. |
| `claim_expired_refund(job_id)` | Write | No | Employer reclaims escrow if deadline passes without submission. |
| `rate_employer(job_id, score)` | Write | No | Allows contractor to rate employer (1 to 5). |
| `rate_contractor(job_id, score)` | Write | No | Allows employer to rate contractor (1 to 5). |
| `get_user_rating(address)` | View | No | Returns JSON representation of the address's reputation stats. |
| `get_job(job_id)` | View | No | Returns the full JSON representation of the job agreement state. |
| `get_job_count()` | View | No | Returns the total count of agreements posted. |

---

## 🛠️ Tech Stack

- **Smart Contract Engine**: Python (GenVM / GenLayer SDK)
- **Arbitration Consensus**: `gl.vm.run_nondet_unsafe` + custom validator closures
- **Frontend Framework**: Next.js (TypeScript, React 18, Static Build Export)
- **Network Interface**: `genlayer-js` SDK (Direct EVM Provider injection)
- **Styling System**: CSS Variables + Google Fonts (Outfit Display + Syne Body headers)

---

## 🚀 Developer Quickstart

### 1. Prerequisites
Ensure you have Node.js (v18+) and Python (v3.10+) installed.

### 2. Contract Validation
Run the GenLayer linter and typechecker locally to confirm contract safety:
```bash
# Verify AST and SDK semantic checks
genvm-lint check contracts/jobber_escrow.py

# Verify Type completeness
genvm-lint typecheck contracts/jobber_escrow.py
```

### 3. Deploy Contract
Deploy the contract to the GenLayer Studio Network.

**Option A (Python deployment)**:
```bash
pip install requests
python deploy.py
```

**Option B (JS/Node deployment)**:
```bash
cd deploy
npm install
node index.mjs
```

Take note of the output **Contract Address**.

### 4. Run Frontend Locally
1. Create a `frontend/.env.local` file:
   ```env
   NEXT_PUBLIC_CONTRACT_ADDRESS=your_deployed_contract_address_here
   ```
2. Run the Next.js dev server:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser. Configure MetaMask or Rabby to switch to RPC: `https://studio.genlayer.com/api` (Chain ID: `61999`).

---

## 📄 License
This project is licensed under the MIT License.
