# BazaarBridge REST API Contract (v7.2)

All monetary amounts are integers in **paise** (`100 paise = ₹1`). Authenticated routes expect `Authorization: Bearer <JWT>`.

## Authentication & System
- `GET /api/health` — Returns service version, infrastructure mode (`aiven_configured` vs `local_sandbox_preview`), active feature flags, and SAMPLE fee schedule.
- `POST /api/auth/login` — Rate-limited (10/min/IP). Body `{ email, password }`. Returns `{ token, user }`.
- `GET /api/auth/me` — Returns authenticated user profile.

## Catalog, Search & 5-Category Dealer Comparison
- `GET /api/products?category=&pin_code=` — Lists categories, dealers, and product summaries with live min price and dealer counts.
- `GET /api/products/:id` — Product detail, specs, and active offers. Records recently viewed (capped at 8).
- `GET /api/products/:id/offers?category=budget|fastest|rated|value|available` — Backend-ranked dealer offers with verbatim `reason` strings.
- `GET /api/products/:id/price-history` — 30-day SAMPLE price history with conditional `show_was_price`.
- `GET /api/products/:id/related` — Related products in the same category.
- `GET /api/products/compare?ids=uuid1,uuid2` (`FEATURE_COMPARE`) — Side-by-side product specifications.
- `GET /api/search/filters` — Live categories and cities with active offers from PostgreSQL.
- `GET /api/search?q=&category=&max_price=&city=&quick=` — Typo-tolerant OpenSearch candidate retrieval + PostgreSQL authoritative truth recheck & live Quick filter.
- `GET /api/outside-bangalore` — Section A (`In Bangalore stock (faster)`) and Section B (`Moved from another stock location (~2-3 days)`).

## Cart, Atomic Reservations & Checkout
- `GET /api/cart` — Active cart lines, saved-for-later lines, live price-change detection, and attached reservations.
- `POST /api/cart/items` — Add or update cart quantity (releases any attached reservation if quantity changes).
- `DELETE /api/cart/items/:cartItemId` — Deletes cart line and atomically releases attached hold.
- `POST /api/cart/items/:id/save-for-later` & `POST /api/cart/items/:id/restore` (`FEATURE_SAVE_LATER`).
- `POST /api/cart/reserve` — Body `{ offer_id, location_id?, quantity, request_key, cart_item_id? }`. Idempotent on `(user_id, request_key)`. Returns `201` with 10-minute `expires_at` or `409 OUT_OF_STOCK`.
- `POST /api/cart/release` — Body `{ reservation_id }`. Idempotent release (`409 CANNOT_RELEASE_CONFIRMED` if already ordered).
- `POST /api/check-pin` — Body `{ pin_code }`. Returns Quick eligibility (`560034`, `560095`, `560038`), hub capacity, ETA ranges, and SAMPLE fees.
- `POST /api/orders` — Body `{ reservation_ids, address, mode_preferences?, coupon_code? }`. Atomically confirms reservations, checks `PRICE_CHANGED` / `RESERVATION_EXPIRED`, splits Quick/Standard/Transfer groups, creates simulated payment, and enqueues `order-placed`.

## Order Tracking, Cancellation & Notifications
- `GET /api/orders` — Customer order history.
- `GET /api/orders/:id` — Full order detail, fulfilment groups, 3-step transfer state, shipment timeline, and owning-customer `SAMPLE DEMO OTP` (while undelivered).
- `POST /api/orders/:id/items/:orderItemId/cancel` — Body `{ request_key, reason_code? }`. Atomic gate (`409 ALREADY_CANCELLED_OR_TOO_LATE`), T1–T4 transfer fall-through, upsert restock, refund request, and `order-item-cancelled` outbox event.
- `GET /api/notifications` & `POST /api/notifications/mark-read`.

## Admin Operations, Simulator & Live Proof (`role === 'admin'`)
- `GET /api/admin/overview` — KPI metrics, hub status, reconciliation discrepancy count, and infrastructure mode.
- `GET /api/admin/groups` — All fulfilment groups, transfers, timelines, refunds, and truncated `otp_hash_preview`.
- `GET /api/admin/groups/:id/demo-otp` — Admin-only autofill helper for simulator testing.
- `POST /api/simulator/fire-event` — Body `{ group_id, event_type, otp?, note? }`. Hashes `otp` into `otp_proof` before writing to outbox.
- `POST /api/admin/refunds/:id/credit` — Enqueues `refund-credit-requested` (SIMULATED gateway).
- `POST /api/admin/hubs/:id/status` — Body `{ active }`. Pauses/resumes hub, bumps revisions in lock order, emits `inventory-updated` & `eta-updated`.
- `GET /api/admin/live-proof` — Recent outbox rows (with `otp_proof` hashes only), `processed_events`, OpenSearch revision comparison, and reconciliation report.

## Optional Feature-Flagged Endpoints
- `GET/POST/DELETE /api/addresses` (`FEATURE_ADDRESSES`)
- `GET /api/wishlist`, `POST /api/wishlist/toggle` (`FEATURE_WISHLIST`)
- `GET /api/recently-viewed`
- `POST /api/coupons/validate` (`FEATURE_COUPONS`)
- `POST /api/alerts/subscribe` (`FEATURE_ALERTS`)
- `POST /api/shopping-assistant` (`FEATURE_ASSISTANT`) — Structured Gemini filter extraction with deterministic rule-based fallback.
