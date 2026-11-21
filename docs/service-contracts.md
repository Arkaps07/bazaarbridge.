# BazaarBridge Service & Event Contracts (v7.2)

## Kafka Topics & Partitioning
| Topic | Partitions | Partition Key | Events |
| --- | --- | --- | --- |
| `bazaar.core.events` | 2 | `order_id` or `offer_id` or `order_item_id` | `order-placed`, `inventory-updated`, `offer-price-updated`, `order-item-cancelled`, `refund-credit-requested` |
| `bazaar.fulfilment.events` | 2 | `group_id` or `user_id` | `fulfilment-status-updated`, `stock-transfer-status-updated`, `eta-updated`, `notification-created` |

## 7 Idempotent Consumers (`processed_events(event_id, consumer_name)`)
1. `inventory-finalizer` — Consumes `order-placed`; deducts reserved stock atomically (`stock_finalised = TRUE`), triggers `inventory-updated`.
2. `search-sync` — Consumes `inventory-updated`, `offer-price-updated`; reads PostgreSQL truth + `offer_state_versions.revision` and upserts OpenSearch with `version_type: external_gte`.
3. `fulfilment-pipeline` — Consumes `fulfilment-status-updated`, `stock-transfer-status-updated`, `eta-updated`; enforces valid state transitions, constant-time HMAC `otp_proof` verification, and 3-step transfer lifecycle (`in_transit` → `received_checked` → `allocated`) including `cancel_on_receipt` restock.
4. `notifier` — Consumes `order-placed`, `fulfilment-status-updated`, `stock-transfer-status-updated`, `eta-updated`, `notification-created`; inserts customer notifications.
5. `cancellation-handler` — Consumes `order-item-cancelled`; transitions refund from `requested` → `initiated` and emits `inventory-updated` + `notification-created`.
6. `refund-credit` — Consumes `refund-credit-requested`; idempotently credits refund (`initiated` → `credited`, SIMULATED gateway) and updates `order_items.refunded_amount`.
7. `alert-watcher` — Consumes `inventory-updated`, `offer-price-updated`; checks active `back_in_stock` and `price_drop` subscriptions and emits `notification-created`.
