import crypto from 'crypto';
import type { FulfilmentMode } from '../api/fees';

export const CORE_TOPIC = 'bazaar.core.events';
export const FULFILMENT_TOPIC = 'bazaar.fulfilment.events';
export const PARTITIONS_PER_TOPIC = 2;

export const CORE_EVENT_TYPES = new Set([
  'order-placed',
  'inventory-updated',
  'order-item-cancelled',
  'offer-price-updated',
  'refund-credit-requested',
  'notification-created',
]);

export const FULFILMENT_EVENT_TYPES = new Set([
  'fulfilment-status-updated',
  'stock-transfer-status-updated',
  'eta-updated',
]);

export function topicForEventType(eventType: string): string {
  if (FULFILMENT_EVENT_TYPES.has(eventType)) return FULFILMENT_TOPIC;
  return CORE_TOPIC;
}

export function partitionForKey(aggregateKey: string, partitions = PARTITIONS_PER_TOPIC): number {
  const hash = crypto.createHash('sha256').update(aggregateKey).digest();
  return hash.readUInt32BE(0) % partitions;
}

export const SIMULATOR_FULFILMENT_EVENTS = new Set([
  'picked',
  'packed',
  'rider_assigned',
  'picked_up',
  'out_for_delivery',
  'otp_verified',
  'otp_failed',
  'exception',
]);

export const SIMULATOR_TRANSFER_EVENTS = new Set([
  'transfer_requested',
  'in_transit',
  'received_checked',
  'allocated',
]);

// Non-cancellable group statuses (v7.2: transfer at in_transit_to_bangalore IS cancellable)
export const NON_CANCELLABLE_GROUP_STATUSES = new Set([
  'picked_up',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);

export function isGroupCancellable(groupStatus: string | null | undefined): boolean {
  if (!groupStatus) return true;
  return !NON_CANCELLABLE_GROUP_STATUSES.has(groupStatus);
}

// Expected -> next status map per fulfilment mode and simulator event_type
export const GROUP_TRANSITIONS: Record<
  FulfilmentMode,
  Record<string, { expected: string[]; next: string }>
> = {
  quick: {
    picked: { expected: ['order_accepted'], next: 'picked' },
    packed: { expected: ['picked'], next: 'packed' },
    rider_assigned: { expected: ['packed'], next: 'rider_assigned' },
    picked_up: { expected: ['rider_assigned'], next: 'picked_up' },
    out_for_delivery: { expected: ['picked_up'], next: 'out_for_delivery' },
    otp_verified: { expected: ['out_for_delivery'], next: 'delivered' },
  },
  standard: {
    picked: { expected: ['order_accepted'], next: 'processing' },
    packed: { expected: ['processing', 'order_accepted'], next: 'packed' },
    rider_assigned: { expected: ['packed'], next: 'rider_assigned' },
    picked_up: { expected: ['rider_assigned'], next: 'picked_up' },
    out_for_delivery: { expected: ['picked_up', 'in_transit'], next: 'out_for_delivery' },
    otp_verified: { expected: ['out_for_delivery'], next: 'delivered' },
  },
  transfer: {
    transfer_requested: { expected: ['reserved_at_origin'], next: 'transfer_requested' },
    in_transit: { expected: ['transfer_requested'], next: 'in_transit_to_bangalore' },
    received_checked: { expected: ['in_transit_to_bangalore'], next: 'received_checked' },
    allocated: { expected: ['received_checked'], next: 'allocated' },
    packed: { expected: ['allocated'], next: 'packed' },
    rider_assigned: { expected: ['packed'], next: 'rider_assigned' },
    picked_up: { expected: ['rider_assigned'], next: 'picked_up' },
    out_for_delivery: { expected: ['picked_up'], next: 'out_for_delivery' },
    otp_verified: { expected: ['out_for_delivery'], next: 'delivered' },
  },
};

export function resolveGroupTransition(
  mode: FulfilmentMode,
  currentStatus: string,
  eventType: string
): string | null {
  if (currentStatus === 'delivered' || currentStatus === 'cancelled') return null;
  const spec = GROUP_TRANSITIONS[mode]?.[eventType];
  if (!spec) return null;
  if (!spec.expected.includes(currentStatus)) return null;
  return spec.next;
}
