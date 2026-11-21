import crypto from 'crypto';
import { isFeatureEnabled } from '../config/env';
import { store, DomainError } from '../db/store';
import { publishToAivenKafka, type OutboxRecord } from './kafka';
import { upsertOfferDoc } from '../search/opensearch';
import { verifyOtpProofConstantTime } from '../utils/otp';
import { resolveGroupTransition } from '../utils/stateMachines';

/**
 * Consumer pause registry for testing race conditions (cancel-before-finalise,
 * transfer-cancel-race, stale-index) identically to tests/helpers.js.
 */
const pausedConsumers = new Set<string>();
const deferredEvents = new Map<string, OutboxRecord[]>();

export function pauseConsumer(name: string): void {
  pausedConsumers.add(name);
}

export async function resumeConsumer(name: string): Promise<void> {
  pausedConsumers.delete(name);
  const queued = deferredEvents.get(name) ?? [];
  deferredEvents.delete(name);
  for (const ev of queued) {
    await dispatchToConsumer(name, ev);
  }
}

function isProcessed(eventId: string, consumerName: string): boolean {
  return store.processed_events.some(
    (p) => p.event_id === eventId && p.consumer_name === consumerName
  );
}

function markProcessed(eventId: string, consumerName: string): boolean {
  if (isProcessed(eventId, consumerName)) return false;
  store.processed_events.push({
    event_id: eventId,
    consumer_name: consumerName,
    processed_at: new Date().toISOString(),
  });
  return true;
}

/**
 * CONSUMER 1: inventory-finalizer (order-placed, PATTERN A)
 * - Lines ordered by (offer_id, stock_location_id) (v7.2 lock order)
 * - Conditional UPDATE on order_items serialises against cancel
 * - Guarded deduct_units (throws and rolls back marker if 0 rows)
 * - For transfer lines: creates stock_transfers row WITH offer_id and emits transfer_requested
 * - Emits ONE notification-created ("Order confirmed")
 */
export async function handleInventoryFinalizer(event: OutboxRecord): Promise<void> {
  const consumer = 'inventory-finalizer';
  const orderId = String(event.payload.order_id || '');
  if (!orderId) return;

  store.runAtomic(() => {
    if (!markProcessed(event.event_id, consumer)) return;

    const order = store.orders.find((o) => o.order_id === orderId);
    if (!order) return;

    // v7.2 lock order: ORDER BY offer_id, stock_location_id
    const items = store.order_items
      .filter((i) => i.order_id === orderId)
      .sort(
        (a, b) =>
          a.offer_id.localeCompare(b.offer_id) ||
          a.stock_location_id.localeCompare(b.stock_location_id)
      );

    const bangaloreWarehouse = store.getHomeWarehouse();
    let anyConfirmed = false;

    for (const item of items) {
      // Conditional gate: only finalise if not cancelled and not already finalised
      if (item.item_status === 'cancelled' || item.stock_finalised) {
        continue;
      }

      // Guarded deduct_units: throws INVENTORY_DEDUCTION_FAILED and rolls back marker if qty insufficient
      store.deductUnits(item.offer_id, item.stock_location_id, item.quantity);
      item.stock_finalised = true;
      item.item_status = 'confirmed';
      anyConfirmed = true;

      store.enqueueOutbox('inventory-updated', item.offer_id, {
        offer_id: item.offer_id,
        location_id: item.stock_location_id,
        reason: 'order_finalised',
      });

      if (item.fulfilment_route === 'transfer') {
        const existingTransfer = store.stock_transfers.find(
          (t) => t.order_item_id === item.order_item_id
        );
        if (!existingTransfer) {
          store.stock_transfers.push({
            transfer_id: crypto.randomUUID(),
            order_item_id: item.order_item_id,
            group_id: item.group_id,
            offer_id: item.offer_id, // v7.1: denormalized offer_id
            from_location_id: item.stock_location_id,
            to_location_id: bangaloreWarehouse.location_id,
            quantity: item.quantity,
            status: 'requested',
            cancel_on_receipt: false,
            requested_at: new Date().toISOString(),
            in_transit_at: null,
            received_at: null,
            allocated_at: null,
            settled_at: null,
          });
        }
        if (item.group_id) {
          store.enqueueOutbox('stock-transfer-status-updated', item.group_id, {
            group_id: item.group_id,
            order_item_id: item.order_item_id,
            event_type: 'transfer_requested',
          });
        }
      }
    }

    if (anyConfirmed && order.status === 'placed') {
      order.status = 'confirmed';
      store.enqueueOutbox('notification-created', order.user_id, {
        user_id: order.user_id,
        message: `Order ${order.order_id.slice(0, 8)} confirmed — stock reserved and deducted.`,
        event_ref: `order-confirmed:${order.order_id}`,
      });
    }
  });
}

/**
 * CONSUMER 2: search-sync (inventory-updated, offer-price-updated, PATTERN B)
 * External OpenSearch write happens OUTSIDE PG transaction with external_gte revision guard.
 */
export async function handleSearchSync(event: OutboxRecord): Promise<{ outcome: string }> {
  const consumer = 'search-sync';
  if (isProcessed(event.event_id, consumer)) {
    return { outcome: 'skipped' };
  }

  const offerId = String(event.payload.offer_id || event.aggregate_key);
  const doc = store.buildOpenSearchDoc(offerId);
  if (!doc) {
    store.runAtomic(() => {
      markProcessed(event.event_id, consumer);
    });
    return { outcome: 'missing_offer' };
  }

  // Step 3: external revision-guarded write (409 -> stale = SUCCESS)
  const result = await upsertOfferDoc(doc);

  // Step 4: commit marker in PG transaction AFTER external write succeeds
  store.runAtomic(() => {
    markProcessed(event.event_id, consumer);
  });

  return { outcome: result.outcome };
}

/**
 * CONSUMER 3: fulfilment-pipeline (bazaar.fulfilment.events, PATTERN A)
 * - Handles fulfilment-status-updated, stock-transfer-status-updated, eta-updated
 * - Verifies otp_proof via constant-time compare (never sees raw code)
 * - Keeps in_transit -> received_checked -> allocated as THREE distinct steps
 * - Receipt-with-cancel uses restock_units UPSERT reading offer_id from stock_transfers
 */
export async function handleFulfilmentPipeline(event: OutboxRecord): Promise<void> {
  const consumer = 'fulfilment-pipeline';

  store.runAtomic(() => {
    if (!markProcessed(event.event_id, consumer)) return;

    const groupId = String(event.payload.group_id || event.aggregate_key);
    const group = store.fulfilment_groups.find((g) => g.group_id === groupId);
    if (!group) return;
    const order = store.orders.find((o) => o.order_id === group.order_id);
    if (!order) return;

    const now = new Date().toISOString();

    if (event.event_type === 'eta-updated') {
      const start = event.payload.eta_window_start as string | undefined;
      const end = event.payload.eta_window_end as string | undefined;
      const basis = event.payload.eta_basis as Record<string, unknown> | undefined;
      if (start) group.eta_window_start = start;
      if (end) group.eta_window_end = end;
      if (basis) group.eta_basis = basis;

      const note = String(event.payload.note || 'Delivery ETA range revised due to hub availability update.');
      store.shipment_timeline.push({
        timeline_id: crypto.randomUUID(),
        group_id: group.group_id,
        status: group.status,
        event_type: 'eta_updated',
        actor: 'system',
        note,
        created_at: now,
      });
      store.enqueueOutbox('notification-created', order.user_id, {
        user_id: order.user_id,
        message: `Revised ETA for order ${order.order_id.slice(0, 8)} (${group.mode} group): ${note}`,
        event_ref: `eta-updated:${event.event_id}`,
      });
      return;
    }

    const subType = String(event.payload.event_type || '');

    if (event.event_type === 'fulfilment-status-updated') {
      if (subType === 'exception' || subType === 'otp_failed') {
        const note =
          subType === 'exception'
            ? String(event.payload.note || 'Delivery exception reported by rider simulator (SAMPLE).')
            : 'Delivery OTP verification failed — order NOT delivered.';
        store.shipment_timeline.push({
          timeline_id: crypto.randomUUID(),
          group_id: group.group_id,
          status: group.status,
          event_type: subType,
          actor: 'simulator',
          note,
          created_at: now,
        });
        store.enqueueOutbox('notification-created', order.user_id, {
          user_id: order.user_id,
          message: `Order ${order.order_id.slice(0, 8)}: ${note}`,
          event_ref: `fulfilment:${event.event_id}`,
        });
        return;
      }

      if (subType === 'otp_verified') {
        if (group.status === 'cancelled' || group.status === 'delivered') return;
        const proof = String(event.payload.otp_proof || '');
        const valid = verifyOtpProofConstantTime(group.otp_hash, proof);
        if (!valid) {
          // Non-matching proof writes otp_failed timeline row and NEVER delivers (ALL modes)
          store.shipment_timeline.push({
            timeline_id: crypto.randomUUID(),
            group_id: group.group_id,
            status: group.status,
            event_type: 'otp_failed',
            actor: 'simulator',
            note: 'OTP proof mismatch — delivery rejected.',
            created_at: now,
          });
          store.enqueueOutbox('notification-created', order.user_id, {
            user_id: order.user_id,
            message: `Order ${order.order_id.slice(0, 8)}: Wrong delivery OTP submitted; package not delivered.`,
            event_ref: `otp-failed:${event.event_id}`,
          });
          return;
        }

        // Valid proof -> delivered (on ALL three modes)
        group.status = 'delivered';
        const items = store.order_items.filter(
          (i) => i.group_id === group.group_id && i.item_status !== 'cancelled'
        );
        for (const item of items) {
          item.item_status = 'delivered';
          item.delivered_at = now;
        }

        store.shipment_timeline.push({
          timeline_id: crypto.randomUUID(),
          group_id: group.group_id,
          status: 'delivered',
          event_type: 'otp_verified',
          actor: 'simulator',
          note: `OTP proof verified (${group.mode} delivery completed).`,
          created_at: now,
        });
        store.enqueueOutbox('notification-created', order.user_id, {
          user_id: order.user_id,
          message: `Order ${order.order_id.slice(0, 8)} (${group.mode}) delivered after OTP proof verification.`,
          event_ref: `delivered:${event.event_id}`,
        });
        return;
      }

      const nextStatus = resolveGroupTransition(group.mode, group.status, subType);
      if (!nextStatus) return; // conditional gate matched 0 rows -> skip

      group.status = nextStatus;
      store.shipment_timeline.push({
        timeline_id: crypto.randomUUID(),
        group_id: group.group_id,
        status: nextStatus,
        event_type: subType,
        actor: 'simulator',
        note: `Shipment advanced to ${nextStatus.replace(/_/g, ' ')}.`,
        created_at: now,
      });
      store.enqueueOutbox('notification-created', order.user_id, {
        user_id: order.user_id,
        message: `Order ${order.order_id.slice(0, 8)} (${group.mode}): ${nextStatus.replace(/_/g, ' ')}.`,
        event_ref: `fulfilment:${event.event_id}`,
      });
      return;
    }

    if (event.event_type === 'stock-transfer-status-updated') {
      const transfers = store.stock_transfers.filter((t) =>
        event.payload.order_item_id
          ? t.order_item_id === event.payload.order_item_id
          : t.group_id === group.group_id
      );

      if (subType === 'transfer_requested') {
        if (group.status === 'reserved_at_origin') {
          group.status = 'transfer_requested';
          store.shipment_timeline.push({
            timeline_id: crypto.randomUUID(),
            group_id: group.group_id,
            status: 'transfer_requested',
            event_type: 'transfer_requested',
            actor: 'inventory-finalizer',
            note: 'Inter-location stock transfer requested from regional holding depot.',
            created_at: now,
          });
          store.enqueueOutbox('notification-created', order.user_id, {
            user_id: order.user_id,
            message: `Order ${order.order_id.slice(0, 8)}: Stock transfer requested from origin depot.`,
            event_ref: `transfer:${event.event_id}`,
          });
        }
        return;
      }

      if (subType === 'in_transit') {
        let matched = false;
        for (const t of transfers) {
          if (t.status === 'requested') {
            t.status = 'in_transit';
            t.in_transit_at = now;
            matched = true;
          }
        }
        if (!matched) return;
        if (group.status === 'transfer_requested') {
          group.status = 'in_transit_to_bangalore';
        }
        store.shipment_timeline.push({
          timeline_id: crypto.randomUUID(),
          group_id: group.group_id,
          status: group.status,
          event_type: 'in_transit',
          actor: 'simulator',
          note: 'Stock transfer dispatched and in transit to Bengaluru warehouse.',
          created_at: now,
        });
        store.enqueueOutbox('notification-created', order.user_id, {
          user_id: order.user_id,
          message: `Order ${order.order_id.slice(0, 8)}: Stock transfer is in transit to Bengaluru.`,
          event_ref: `transfer:${event.event_id}`,
        });
        return;
      }

      if (subType === 'received_checked') {
        let anyMatched = false;
        let anyRestockedOnReceipt = false;

        for (const t of transfers) {
          // Conditional UPDATE WHERE status = 'in_transit' RETURNING cancel_on_receipt, to_location_id, quantity, offer_id
          if (t.status !== 'in_transit') continue;
          t.status = 'received_checked';
          t.received_at = now;
          anyMatched = true;

          if (t.cancel_on_receipt) {
            // Conditional transition received_checked -> restocked_bangalore
            if (t.status === 'received_checked' && t.cancel_on_receipt) {
              t.status = 'restocked_bangalore';
              t.settled_at = now;
              // v7.1: offer_id read from stock_transfers RETURNING; upsert creates missing Bangalore row!
              store.restockUnits(t.offer_id, t.to_location_id, t.quantity);
              store.enqueueOutbox('inventory-updated', t.offer_id, {
                offer_id: t.offer_id,
                location_id: t.to_location_id,
                reason: 'transfer_receipt_cancel_restock',
              });
              anyRestockedOnReceipt = true;
            }
          }
        }

        if (!anyMatched) return;

        if (anyRestockedOnReceipt) {
          group.status = 'cancelled';
          store.shipment_timeline.push({
            timeline_id: crypto.randomUUID(),
            group_id: group.group_id,
            status: 'cancelled',
            event_type: 'received_checked_restocked',
            actor: 'simulator',
            note: 'Cancelled transfer received in Bengaluru and restocked into free Bengaluru warehouse inventory (upsert).',
            created_at: now,
          });
          store.enqueueOutbox('notification-created', order.user_id, {
            user_id: order.user_id,
            message: `Order ${order.order_id.slice(0, 8)}: Cancelled transfer arrived and was restocked.`,
            event_ref: `transfer:${event.event_id}`,
          });
        } else {
          // NO stock movement, NO allocation yet! Wait for separate allocate event.
          if (group.status === 'in_transit_to_bangalore') {
            group.status = 'received_checked';
          }
          store.shipment_timeline.push({
            timeline_id: crypto.randomUUID(),
            group_id: group.group_id,
            status: group.status,
            event_type: 'received_checked',
            actor: 'simulator',
            note: 'Transfer received and QC checked at Bengaluru warehouse (awaiting order allocation).',
            created_at: now,
          });
          store.enqueueOutbox('notification-created', order.user_id, {
            user_id: order.user_id,
            message: `Order ${order.order_id.slice(0, 8)}: Transferred units received and QC checked in Bengaluru.`,
            event_ref: `transfer:${event.event_id}`,
          });
        }
        return;
      }

      if (subType === 'allocated') {
        let matched = false;
        for (const t of transfers) {
          // Conditional UPDATE WHERE status = 'received_checked' AND cancel_on_receipt = false
          if (t.status === 'received_checked' && !t.cancel_on_receipt) {
            t.status = 'allocated';
            t.allocated_at = now;
            const item = store.order_items.find((i) => i.order_item_id === t.order_item_id);
            if (item) {
              // Units belong to this order; NEVER appear as free Bangalore stock (NO quantity change)
              item.stock_location_id = t.to_location_id;
            }
            matched = true;
          }
        }
        if (!matched) return;
        if (group.status === 'received_checked') {
          group.status = 'allocated';
        }
        store.shipment_timeline.push({
          timeline_id: crypto.randomUUID(),
          group_id: group.group_id,
          status: group.status,
          event_type: 'allocated',
          actor: 'simulator',
          note: 'Transferred stock allocated to customer order at Bengaluru warehouse (ready for packing).',
          created_at: now,
        });
        store.enqueueOutbox('notification-created', order.user_id, {
          user_id: order.user_id,
          message: `Order ${order.order_id.slice(0, 8)}: Stock allocated in Bengaluru and ready for packing.`,
          event_ref: `transfer:${event.event_id}`,
        });
      }
    }
  });
}

/**
 * CONSUMER 4: notifier (notification-created, PATTERN A)
 * SOLE writer into the notifications table.
 */
export async function handleNotifier(event: OutboxRecord): Promise<void> {
  const consumer = 'notifier';
  store.runAtomic(() => {
    if (!markProcessed(event.event_id, consumer)) return;
    const userId = String(event.payload.user_id || event.aggregate_key);
    const message = String(event.payload.message || '');
    if (!userId || !message) return;

    store.notifications.unshift({
      notification_id: crypto.randomUUID(),
      user_id: userId,
      message,
      event_ref: event.payload.event_ref ? String(event.payload.event_ref) : event.event_id,
      created_at: new Date().toISOString(),
      read_at: null,
    });
  });
}

/**
 * CONSUMER 5: cancellation-handler (order-item-cancelled, PATTERN B)
 * Refreshes OpenSearch with revision guard first, then commits marker + ONE timeline row
 * + ONE notification-created ("Cancellation confirmed, refund initiated").
 */
export async function handleCancellationHandler(event: OutboxRecord): Promise<void> {
  const consumer = 'cancellation-handler';
  if (isProcessed(event.event_id, consumer)) return;

  const offerId = String(event.payload.offer_id || event.aggregate_key);
  const doc = store.buildOpenSearchDoc(offerId);
  if (doc) {
    await upsertOfferDoc(doc);
  }

  store.runAtomic(() => {
    if (!markProcessed(event.event_id, consumer)) return;

    const groupId = event.payload.group_id ? String(event.payload.group_id) : null;
    const userId = String(event.payload.user_id || '');
    const orderId = String(event.payload.order_id || '');

    if (groupId) {
      const group = store.fulfilment_groups.find((g) => g.group_id === groupId);
      store.shipment_timeline.push({
        timeline_id: crypto.randomUUID(),
        group_id: groupId,
        status: group?.status ?? 'cancelled',
        event_type: 'item_cancelled',
        actor: 'cancellation-handler',
        note: 'Order item cancelled; stock restored and refund initiated (SIMULATED gateway).',
        created_at: new Date().toISOString(),
      });
    }

    if (userId) {
      store.enqueueOutbox('notification-created', userId, {
        user_id: userId,
        message: `Cancellation confirmed for order ${orderId.slice(0, 8)} — refund initiated (SIMULATED).`,
        event_ref: `cancel:${event.event_id}`,
      });
    }
  });
}

/**
 * CONSUMER 6: refund-credit (refund-credit-requested, PATTERN A)
 * SOLE component that credits order_items refund totals and emits refund notification.
 * Enforces exact v7.2 conditional status gate + atomic capped UPDATE + failure rollback.
 */
export async function handleRefundCredit(event: OutboxRecord): Promise<void> {
  const consumer = 'refund-credit';
  const refundId = String(event.payload.refund_id || '');
  if (!refundId) return;

  let capExceeded = false;

  try {
    store.runAtomic(() => {
      if (!markProcessed(event.event_id, consumer)) return;

      const refund = store.refunds.find((r) => r.refund_id === refundId);
      if (!refund) return;

      // Conditional status gate: WHERE status IN ('requested','initiated')
      if (refund.status === 'credited' || refund.status === 'failed') {
        // Already settled -> commit marker, NO money movement
        return;
      }

      const item = store.order_items.find((i) => i.order_item_id === refund.order_item_id);
      if (!item) return;
      const order = store.orders.find((o) => o.order_id === item.order_id);

      const iAmt = refund.item_amount;
      const fAmt = refund.fee_amount;
      const maxItem = item.line_price - item.discount_share;
      const maxFee = item.delivery_fee_share;

      // Atomic cap check
      if (
        iAmt < 0 ||
        fAmt < 0 ||
        item.item_refunded_amount + iAmt > maxItem ||
        item.fee_refunded_amount + fAmt > maxFee
      ) {
        capExceeded = true;
        throw new DomainError(409, 'REFUND_CAP_EXCEEDED', 'Refund exceeds remaining refundable cap.');
      }

      refund.status = 'credited';
      refund.credited_at = new Date().toISOString();
      refund.gateway_ref =
        String(event.payload.gateway_ref || refund.gateway_ref || `SIM-REF-${refund.refund_id.slice(0, 8)}`);

      item.item_refunded_amount += iAmt;
      item.fee_refunded_amount += fAmt;
      item.refunded_amount = item.item_refunded_amount + item.fee_refunded_amount;

      // Update simulated payment status
      if (order) {
        const payment = store.payments.find((p) => p.order_id === order.order_id);
        if (payment) {
          const totalRefunded = store.order_items
            .filter((oi) => oi.order_id === order.order_id)
            .reduce((acc, oi) => acc + oi.refunded_amount, 0);
          payment.status = totalRefunded >= payment.amount ? 'refunded' : 'partially_refunded';
          payment.updated_at = new Date().toISOString();
        }
        store.enqueueOutbox('notification-created', order.user_id, {
          user_id: order.user_id,
          message: `Refund credited (SIMULATED): Rs.${((iAmt + fAmt) / 100).toFixed(2)} for order ${order.order_id.slice(0, 8)}.`,
          event_ref: `refund-credited:${refund.refund_id}`,
        });
      }
    });
  } catch (err) {
    if (capExceeded) {
      // Separate transaction: stop retry loop by marking refund failed, leaving order_items unchanged
      store.runAtomic(() => {
        const refund = store.refunds.find((r) => r.refund_id === refundId);
        if (refund && (refund.status === 'requested' || refund.status === 'initiated')) {
          refund.status = 'failed';
        }
        markProcessed(event.event_id, consumer);
      });
      return;
    }
    throw err;
  }
}

/**
 * CONSUMER 7: alert-watcher (inventory-updated & order-item-cancelled, PATTERN A, FEATURE_ALERTS)
 * Matches alert_subscriptions ONLY when sellable free stock > 0 (quarantine never triggers alerts).
 */
export async function handleAlertWatcher(event: OutboxRecord): Promise<void> {
  if (!isFeatureEnabled('FEATURE_ALERTS')) return;
  const consumer = 'alert-watcher';
  const offerId = String(event.payload.offer_id || event.aggregate_key);

  store.runAtomic(() => {
    if (!markProcessed(event.event_id, consumer)) return;
    const truth = store.getOfferTruth(offerId);
    if (!truth || truth.free_units <= 0) return;

    const product = store.products.find((p) => p.product_id === truth.offer.product_id);
    const matchingSubs = store.alert_subscriptions.filter((sub) => {
      if (!sub.active) return false;
      const targetMatch =
        sub.offer_id === offerId ||
        (!sub.offer_id && sub.product_id === truth.offer.product_id);
      if (!targetMatch) return false;
      if (sub.type === 'back_in_stock') return truth.free_units > 0;
      if (sub.type === 'price_drop' && sub.price_threshold_paise != null) {
        return truth.offer.selling_price <= sub.price_threshold_paise;
      }
      return false;
    });

    for (const sub of matchingSubs) {
      sub.active = false; // trigger once per restock/drop
      store.enqueueOutbox('notification-created', sub.user_id, {
        user_id: sub.user_id,
        message: `Alert triggered for ${product?.name || 'watched product'}: available at Rs.${(truth.offer.selling_price / 100).toFixed(2)} (${truth.free_units} sellable units).`,
        event_ref: `alert:${sub.subscription_id}:${event.event_id}`,
      });
    }
  });
}

async function dispatchToConsumer(consumerName: string, event: OutboxRecord): Promise<void> {
  if (pausedConsumers.has(consumerName)) {
    const arr = deferredEvents.get(consumerName) ?? [];
    arr.push(event);
    deferredEvents.set(consumerName, arr);
    return;
  }

  switch (consumerName) {
    case 'inventory-finalizer':
      await handleInventoryFinalizer(event);
      break;
    case 'search-sync':
      await handleSearchSync(event);
      break;
    case 'fulfilment-pipeline':
      await handleFulfilmentPipeline(event);
      break;
    case 'notifier':
      await handleNotifier(event);
      break;
    case 'cancellation-handler':
      await handleCancellationHandler(event);
      break;
    case 'refund-credit':
      await handleRefundCredit(event);
      break;
    case 'alert-watcher':
      await handleAlertWatcher(event);
      break;
    default:
      break;
  }
}

export async function dispatchEventToConsumers(event: OutboxRecord): Promise<void> {
  switch (event.event_type) {
    case 'order-placed':
      await dispatchToConsumer('inventory-finalizer', event);
      break;
    case 'inventory-updated':
      await dispatchToConsumer('search-sync', event);
      await dispatchToConsumer('alert-watcher', event);
      break;
    case 'offer-price-updated':
      await dispatchToConsumer('search-sync', event);
      break;
    case 'order-item-cancelled':
      await dispatchToConsumer('cancellation-handler', event);
      await dispatchToConsumer('alert-watcher', event);
      break;
    case 'refund-credit-requested':
      await dispatchToConsumer('refund-credit', event);
      break;
    case 'notification-created':
      await dispatchToConsumer('notifier', event);
      break;
    case 'fulfilment-status-updated':
    case 'stock-transfer-status-updated':
    case 'eta-updated':
      await dispatchToConsumer('fulfilment-pipeline', event);
      break;
    default:
      // Unknown event types: log and skip, never crash
      break;
  }
}

/**
 * Drains unpublished outbox_events in created_at order, publishes to Kafka (if configured),
 * marks published_at, and runs all subscribed consumers. Loops until downstream outbox events settle.
 */
export async function flushOutbox(): Promise<number> {
  let totalProcessed = 0;
  let safetyCounter = 0;

  while (safetyCounter < 20) {
    safetyCounter += 1;
    const unpublished = store.outbox_events
      .filter((e) => e.published_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    if (unpublished.length === 0) break;

    for (const ev of unpublished) {
      const meta = await publishToAivenKafka(ev);
      ev.topic = meta.topic;
      ev.partition = meta.partition;
      ev.published_at = new Date().toISOString();
      await dispatchEventToConsumers(ev);
      totalProcessed += 1;
    }
  }

  return totalProcessed;
}

/**
 * Reservation expiry cleanup (v7.2: ONLY marks status='reserved' AND expires_at < now() as 'expired',
 * restores reserved_quantity in offer_id, location_id order, NEVER touches 'confirmed').
 */
export async function runReservationExpiryCleanup(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  let expiredCount = 0;

  store.runAtomic(() => {
    const expired = store.reservations
      .filter((r) => r.status === 'reserved' && new Date(r.expires_at).getTime() < nowMs)
      .sort(
        (a, b) =>
          a.offer_id.localeCompare(b.offer_id) || a.location_id.localeCompare(b.location_id)
      );

    const affectedOffers = new Set<string>();
    for (const r of expired) {
      r.status = 'expired';
      store.releaseHold(r.offer_id, r.location_id, r.quantity);
      affectedOffers.add(r.offer_id);
      expiredCount += 1;
    }

    for (const offerId of affectedOffers) {
      store.enqueueOutbox('inventory-updated', offerId, {
        offer_id: offerId,
        reason: 'reservation_expired',
      });
    }
  });

  if (expiredCount > 0) {
    await flushOutbox();
  }
  return expiredCount;
}

/**
 * SIMULATED refund-stub worker: transitions 'requested' refunds older than delayMs -> 'initiated'
 * and enqueues 'refund-credit-requested' (key = order_item_id). Never touches money directly.
 */
export async function runRefundStubWorker(delayMs = 2500): Promise<number> {
  const cutoff = Date.now() - delayMs;
  let enqueued = 0;

  store.runAtomic(() => {
    for (const refund of store.refunds) {
      if (refund.status !== 'requested') continue;
      const c = store.after_sales_cases.find((ac) => ac.case_id === refund.case_id);
      const requestedAt = c ? new Date(c.requested_at).getTime() : 0;
      if (requestedAt <= cutoff) {
        refund.status = 'initiated';
        refund.initiated_at = new Date().toISOString();
        store.enqueueOutbox('refund-credit-requested', refund.order_item_id, {
          refund_id: refund.refund_id,
          order_item_id: refund.order_item_id,
          source: 'refund-stub-worker (SIMULATED)',
        });
        enqueued += 1;
      }
    }
  });

  if (enqueued > 0) {
    await flushOutbox();
  }
  return enqueued;
}
