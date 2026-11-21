# BazaarBridge Engineering & Architecture Rules (v7.2)

1. **System of Record**: PostgreSQL (`backend/src/db/schema.sql`) is authoritative for prices (BIGINT paise), atomic stock reservations (`quantity - reserved_quantity >= qty`), order splitting, delivery fees, ETA windows, and OTP hashes.
2. **Event Backbone**: Transactional outbox rows (`outbox_events`) publish to two keyed Kafka topics (`bazaar.core.events` and `bazaar.fulfilment.events`, 2 partitions each). All 7 consumers enforce composite idempotency via `processed_events(event_id, consumer_name)`.
3. **Search Integrity**: OpenSearch returns candidate `offer_id`s only. Every `/api/search` response rechecks PostgreSQL truth and re-applies `category`, `city`, `max_price`, and live `quick` hub availability. Search sync uses `version_type: external_gte` against `offer_state_versions.revision`.
4. **OTP Proof Security**: Raw delivery OTPs never appear in outbox payloads, Kafka events, logs, or the Live-Proof Panel. `POST /api/simulator/fire-event` converts submitted OTPs to `otp_proof` HMAC digests before enqueuing.
5. **Honest Labelling**: Seeded catalog data, dealer ratings, 30-day price history, delivery fees, sandbox payments, refund credit worker, demo OTPs, and optional mock screens (`<SimulatedWrapper>`) are explicitly labelled `SAMPLE` or `SIMULATED`.
6. **Secret Hygiene**: All secrets live strictly in `.env` (git-ignored). Admin login is never prefilled. Run `bash scripts/check-secrets.sh` before every commit.
