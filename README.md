# BazaarBridge — Multi-Dealer E-Commerce & Hybrid Fulfilment Platform (v7.2)

BazaarBridge is a full-stack local multi-dealer marketplace built with React, Vite, Tailwind CSS, Express, and TypeScript, architected for **Aiven PostgreSQL**, **Aiven Apache Kafka** (2 keyed topics × 2 partitions), **Aiven OpenSearch** (revision-guarded fuzzy search), and optional server-side **Gemini Shopping Assistant**.

---

## Quick Start (Local Development & Preview)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template (never commit .env)
cp .env.example .env

# 3. Start full-stack dev server (Express API + Vite frontend on port 3000)
npm run dev

# 4. Run unit & integration test suites
npm run test:unit
npm run test:integration

# 5. Run secret hygiene scan
bash scripts/check-secrets.sh
```

> **Environment Note (Aiven vs Local Sandbox Preview Mode)**:
> Real `pg`, `kafkajs`, and `@opensearch-project/opensearch` drivers plus the complete SQL schema (`backend/src/db/schema.sql`) and seeder (`backend/src/seed/seed.ts`) are built in and activate automatically when `PG_URI`, `KAFKA_BROKERS`, and `OPENSEARCH_URL` are configured in `.env`. When Aiven credentials are absent, the server runs transparently in **Local Sandbox Preview Mode** (visibly reported in `/api/health` and the Admin Dashboard) while enforcing every v7.2 schema invariant, atomic stock guard, 2-partition keyed outbox pipeline, 7 idempotent consumers, revision-guarded fuzzy search, and HMAC OTP proof rule.

---

## Connecting Live Aiven Services (PostgreSQL, Kafka, OpenSearch)

1. **Provision Aiven Services**:
   - Create an **Aiven for PostgreSQL** service and copy its Service URI into `PG_URI` in `.env`.
   - Create an **Aiven for Apache Kafka** service with two topics (`bazaar.core.events` and `bazaar.fulfilment.events`, 2 partitions each) and set `KAFKA_BROKERS`, `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` (or SSL certificate paths in `certs/`).
   - Create an **Aiven for OpenSearch** service and set `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, and `OPENSEARCH_PASSWORD`.
   - Set strong `JWT_SECRET`, `OTP_PEPPER`, and `SEED_ADMIN_PASSWORD` values in `.env`.

2. **Apply Schema & Seed Database**:
```bash
psql "$PG_URI" -f backend/src/db/schema.sql
npm run seed
```

3. **Run Production Build**:
```bash
npm run build
npm start
```

---

## Built vs Simulated Matrix

| Capability | Status | Details |
| --- | --- | --- |
| Multi-dealer catalog (40 SKUs, 6 dealers) | **Built (SAMPLE dataset)** | Authoritative BIGINT paise prices & inventory guards |
| 5-Category Dealer Comparison (`budget`, `fastest`, `rated`, `value`, `available`) | **Built** | Verbatim backend reasons, 45/25/20/10 weighted value score |
| Typo-tolerant Search + Live PG Recheck | **Built** | Fuzzy recall (`bluetoth`) + PG truth filter re-application & live Quick check |
| Atomic 10-Min Stock Reservations & Expiry Cleanup | **Built** | Idempotent `request_key`, `409 OUT_OF_STOCK`, `PRICE_CHANGED` recovery |
| Hybrid Fulfilment Splitting (Quick / Standard / Transfer) | **Built** | PIN check (`560034`, `560095`, `560038`), Quick→Standard downgrade, 3-step transfer |
| Transactional Outbox + 7 Idempotent Consumers | **Built** | Keyed 2-partition routing, `processed_events` dedup, Live-Proof Panel |
| Delivery OTP Proof Security | **Built** | HMAC `otp_proof` only in events/logs; raw OTP only for owning customer / admin autofill |
| Item Cancellation + T1–T4 Transfer Fall-Through | **Built** | Atomic gate, `cancel_on_receipt`, upsert restock, refund ledger |
| Payment Gateway & Refund Settlement | **SIMULATED** | Sandbox UPI confirmation & simulated refund credit consumer |
| Delivery Fees, Dealer Ratings, 30-Day Price History | **SAMPLE** | Clearly labelled demo constants (Quick ₹49, Std ₹29 / Free ≥₹999, Transfer ₹69) |
| Picker Queue, Rider Board, Support & Reviews (`/simulated/*`) | **SIMULATED** | Wrapped in `<SimulatedWrapper label="SIMULATED / SAMPLE DATA" />` |

---

## Feature Flags (`FEATURE_FLAGS` in `.env`)

| Flag | Default | Scope |
| --- | --- | --- |
| `FEATURE_ADDRESSES` | Enabled | Saved delivery addresses book in Checkout |
| `FEATURE_COUPONS` | Enabled | Promo coupon validation (`WELCOME100`, `SAVE10`, `LIMITED50`) |
| `FEATURE_WISHLIST` | Enabled | Wishlist toggle & `/wishlist` page |
| `FEATURE_SAVE_LATER` | Enabled | Move cart items to Saved for Later & restore |
| `FEATURE_COMPARE` | Enabled | Side-by-side product specs comparison (`/compare`) |
| `FEATURE_ALERTS` | Enabled | Price-drop & back-in-stock subscriptions |
| `FEATURE_ASSISTANT` | Enabled | Gemini (`gemini-4-hydrogen`) structured filter extraction + rule fallback (`/assistant`) |
| `FEATURE_SIM_SCREENS` | Enabled | Simulated ops & support pages (`/simulated/ops`, `/simulated/support`) |

---

## Not Attempted / Explicitly Out of Scope
- Live real-money payment gateway integration (Razorpay/Stripe) — intentionally sandboxed.
- Live SMS/WhatsApp OTP delivery provider — demo OTP is displayed to owning customer on `/orders/:id`.
- External third-party dealer ERP feeds or real-time GPS rider telemetry.

---

## Documentation
- `docs/agent-rules.md` — Core v7.2 engineering invariants
- `docs/api-contract.md` — Complete REST API specification
- `docs/service-contracts.md` — Kafka topics, partition keys, and 7 consumers
- `docs/demo-script.md` — Step-by-step live verification walkthrough
