import crypto from 'crypto';
import { buildSeedDataset, SEED_IDS } from '../seed/seedData';
import type { OpenSearchOfferDoc } from '../search/opensearch';
import { localSearchIndex, upsertOfferDoc } from '../search/opensearch';
import { computeEffectiveDays, type OfferForComparison } from '../utils/comparison';
import { partitionForKey, topicForEventType } from '../utils/stateMachines';
import type { OutboxRecord } from '../events/kafka';
import type { FulfilmentMode } from '../api/fees';
import type { HubHours } from '../api/eta';

export interface UserRow {
  user_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'customer' | 'admin' | 'rider';
}

export interface CategoryRow {
  category_id: string;
  category_name: string;
}

export interface ProductRow {
  product_id: string;
  name: string;
  description: string;
  brand: string;
  category_id: string;
  specs: Record<string, string | number | boolean>;
}

export interface DealerRow {
  dealer_id: string;
  shop_name: string;
  city: string;
  state: string;
  contact: string;
  dealer_rating: number;
  total_reviews: number;
  verified: boolean;
  supplier_status: string;
}

export interface DealerOfferRow {
  offer_id: string;
  product_id: string;
  dealer_id: string;
  purchase_price: number;
  selling_price: number;
  status: string;
  bangalore_delivery_days: number | null;
  transfer_days_min: number | null;
  transfer_days_max: number | null;
  eligible_modes: string[];
  warranty_months: number;
  warranty_note: string | null;
}

export interface StockLocationRow {
  location_id: string;
  name: string;
  city: string;
  state: string;
  location_type: 'warehouse' | 'hub' | 'holding' | 'quarantine';
  is_home: boolean;
  is_sellable: boolean;
}

export interface InventoryRow {
  inventory_id: string;
  offer_id: string;
  location_id: string;
  quantity: number;
  reserved_quantity: number;
}

export interface ReservationRow {
  reservation_id: string;
  offer_id: string;
  location_id: string;
  user_id: string;
  quantity: number;
  price_paise: number;
  status: 'reserved' | 'confirmed' | 'expired' | 'released';
  expires_at: string;
  request_key: string;
}

export interface CartRow {
  cart_id: string;
  user_id: string;
}

export interface CartItemRow {
  cart_item_id: string;
  cart_id: string;
  offer_id: string;
  quantity: number;
  price_snapshot: number;
  reservation_id: string | null;
  saved_for_later: boolean;
}

export interface OrderRow {
  order_id: string;
  user_id: string;
  items_total: number;
  discount_total: number;
  delivery_fee_total: number;
  total_amount: number;
  coupon_code: string | null;
  delivery_pin_code: string | null;
  status: string;
  placed_at: string;
}

export interface OrderItemRow {
  order_item_id: string;
  order_id: string;
  group_id: string | null;
  reservation_id: string;
  offer_id: string;
  dealer_id: string;
  quantity: number;
  line_price: number;
  discount_share: number;
  delivery_fee_share: number;
  item_paid_amount: number;
  paid_amount: number;
  item_refunded_amount: number;
  fee_refunded_amount: number;
  refunded_amount: number;
  stock_location_id: string;
  fulfilment_route: string;
  stock_finalised: boolean;
  promised_delivery_start: string | null;
  promised_delivery_end: string | null;
  delivered_at: string | null;
  item_status: 'placed' | 'confirmed' | 'cancelled' | 'delivered';
  cancelled_at: string | null;
}

export interface OfferPriceHistoryRow {
  history_id: number;
  offer_id: string;
  selling_price: number;
  valid_from: string;
  valid_to: string | null;
}

export interface ProcessedEventRow {
  event_id: string;
  consumer_name: string;
  processed_at: string;
}

export interface OfferStateVersionRow {
  offer_id: string;
  revision: number;
  updated_at: string;
}

export interface PaymentRow {
  payment_id: string;
  order_id: string;
  amount: number;
  method: string;
  status: 'created' | 'pending' | 'successful' | 'failed' | 'expired' | 'refunded' | 'partially_refunded';
  gateway_ref: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface RefundRow {
  refund_id: string;
  order_item_id: string;
  case_id: string | null;
  item_amount: number;
  fee_amount: number;
  kind: 'path_a' | 'path_b';
  method: string;
  status: 'requested' | 'initiated' | 'credited' | 'failed';
  gateway_ref: string | null;
  idempotency_key: string | null;
  initiated_at: string | null;
  credited_at: string | null;
}

export interface AfterSalesCaseRow {
  case_id: string;
  order_item_id: string;
  user_id: string;
  type: 'cancellation' | 'return';
  reason_code: string | null;
  status: string;
  request_key: string;
  requested_at: string;
  closed_at: string | null;
}

export interface FulfilmentHubRow {
  hub_id: string;
  location_id: string;
  address: string;
  hours: HubHours;
  active: boolean;
  order_capacity: number;
  delivery_radius_km: number;
}

export interface HubServiceAreaRow {
  area_id: string;
  hub_id: string;
  pin_code: string;
}

export interface FulfilmentGroupRow {
  group_id: string;
  order_id: string;
  location_id: string;
  mode: FulfilmentMode;
  status: string;
  fee_total: number;
  eta_window_start: string | null;
  eta_window_end: string | null;
  eta_basis: Record<string, unknown> | null;
  otp_hash: string;
  created_at: string;
}

export interface StockTransferRow {
  transfer_id: string;
  order_item_id: string;
  group_id: string | null;
  offer_id: string; // v7.1
  from_location_id: string;
  to_location_id: string;
  quantity: number;
  status:
    | 'requested'
    | 'in_transit'
    | 'received_checked'
    | 'allocated'
    | 'cancelled_at_origin'
    | 'restocked_bangalore';
  cancel_on_receipt: boolean;
  requested_at: string;
  in_transit_at: string | null;
  received_at: string | null;
  allocated_at: string | null;
  settled_at: string | null;
}

export interface ShipmentTimelineRow {
  timeline_id: string;
  group_id: string;
  status: string;
  event_type: string;
  actor: string;
  note: string;
  created_at: string;
}

export interface NotificationRow {
  notification_id: string;
  user_id: string;
  message: string;
  event_ref: string | null;
  created_at: string;
  read_at: string | null;
}

export interface CustomerAddressRow {
  address_id: string;
  user_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pin_code: string;
  instructions: string | null;
  is_default: boolean;
  created_at: string;
}

export interface CouponRow {
  coupon_id: string;
  code: string;
  kind: 'fixed_paise' | 'percent';
  value: number;
  min_basket_paise: number;
  max_redemptions: number | null;
  redeemed_count: number;
  per_customer_limit: number;
  valid_from: string;
  valid_to: string;
  active: boolean;
}

export interface AlertSubscriptionRow {
  subscription_id: string;
  user_id: string;
  offer_id: string | null;
  product_id: string | null;
  type: 'back_in_stock' | 'price_drop';
  price_threshold_paise: number | null;
  active: boolean;
  created_at: string;
}

export class DomainError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Relational in-process mirror of schema.sql v7.2 used when PG_URI is not yet configured.
 * Enforces every constraint, trigger (price history, revision bumps, hub pause bumps),
 * atomic stock guard, upsert restock, and transactional rollback semantics.
 */
export class BazaarStore {
  users: UserRow[] = [];
  categories: CategoryRow[] = [];
  products: ProductRow[] = [];
  dealers: DealerRow[] = [];
  dealer_offers: DealerOfferRow[] = [];
  stock_locations: StockLocationRow[] = [];
  inventory: InventoryRow[] = [];
  reservations: ReservationRow[] = [];
  carts: CartRow[] = [];
  cart_items: CartItemRow[] = [];
  orders: OrderRow[] = [];
  order_items: OrderItemRow[] = [];
  offer_price_history: OfferPriceHistoryRow[] = [];
  outbox_events: OutboxRecord[] = [];
  processed_events: ProcessedEventRow[] = [];
  offer_state_versions: Map<string, OfferStateVersionRow> = new Map();
  payments: PaymentRow[] = [];
  refunds: RefundRow[] = [];
  after_sales_cases: AfterSalesCaseRow[] = [];
  fulfilment_hubs: FulfilmentHubRow[] = [];
  hub_service_areas: HubServiceAreaRow[] = [];
  fulfilment_groups: FulfilmentGroupRow[] = [];
  stock_transfers: StockTransferRow[] = [];
  shipment_timeline: ShipmentTimelineRow[] = [];
  notifications: NotificationRow[] = [];
  customer_addresses: CustomerAddressRow[] = [];
  user_wishlist: Array<{ wishlist_id: string; user_id: string; product_id: string; added_at: string }> = [];
  recently_viewed: Array<{ id: string; user_id: string; product_id: string; viewed_at: string }> = [];
  alert_subscriptions: AlertSubscriptionRow[] = [];
  coupons: CouponRow[] = [];
  coupon_customer_usage: Map<string, number> = new Map(); // `${coupon_id}:${user_id}` -> count
  coupon_redemptions: Array<{ redemption_id: string; coupon_id: string; user_id: string; order_id: string; redeemed_at: string }> = [];

  private nextHistoryId = 1;
  private seeded = false;

  constructor() {
    this.seed();
  }

  seed(adminPasswordOverride?: string): void {
    const data = buildSeedDataset(adminPasswordOverride);

    this.users = data.users.map((u) => ({ ...u }));
    this.categories = data.categories.map((c) => ({ ...c }));
    this.products = data.products.map((p) => ({
      product_id: p.product_id,
      name: p.name,
      description: p.description,
      brand: p.brand,
      category_id: p.category_id,
      specs: { ...p.specs },
    }));
    this.dealers = data.dealers.map((d) => ({ ...d }));
    this.stock_locations = data.stock_locations.map((l) => ({ ...l }));
    this.fulfilment_hubs = data.fulfilment_hubs.map((h) => ({ ...h, hours: { ...h.hours } }));
    this.hub_service_areas = data.hub_service_areas.map((a) => ({ ...a }));

    this.dealer_offers = [];
    this.inventory = [];
    this.reservations = [];
    this.carts = [];
    this.cart_items = [];
    this.orders = [];
    this.order_items = [];
    this.offer_price_history = [];
    this.outbox_events = [];
    this.processed_events = [];
    this.offer_state_versions = new Map();
    this.payments = [];
    this.refunds = [];
    this.after_sales_cases = [];
    this.fulfilment_groups = [];
    this.stock_transfers = [];
    this.shipment_timeline = [];
    this.notifications = [];
    this.customer_addresses = data.customer_addresses.map((a) => ({
      ...a,
      created_at: new Date().toISOString(),
    }));
    this.user_wishlist = [];
    this.recently_viewed = [];
    this.alert_subscriptions = [];
    this.coupons = data.coupons.map((c) => ({ ...c }));
    this.coupon_customer_usage = new Map();
    this.coupon_redemptions = [];
    this.nextHistoryId = 1;

    const nowIso = new Date().toISOString();

    for (const o of data.dealer_offers) {
      this.dealer_offers.push({ ...o, eligible_modes: [...o.eligible_modes] });
      // trg_log_price on INSERT
      this.offer_price_history.push({
        history_id: this.nextHistoryId++,
        offer_id: o.offer_id,
        selling_price: o.selling_price,
        valid_from: nowIso,
        valid_to: null,
      });
      // trg_bump_rev_offer on INSERT
      this.bumpOfferRevision(o.offer_id);
    }

    for (const inv of data.inventory) {
      this.inventory.push({
        inventory_id: crypto.randomUUID(),
        offer_id: inv.offer_id,
        location_id: inv.location_id,
        quantity: inv.quantity,
        reserved_quantity: inv.reserved_quantity,
      });
      // trg_bump_rev_inventory on INSERT
      this.bumpOfferRevision(inv.offer_id);
    }

    // Add SAMPLE closed 30-day historical price rows (higher older price)
    for (const hist of data.historical_prices) {
      this.offer_price_history.push({
        history_id: this.nextHistoryId++,
        offer_id: hist.offer_id,
        selling_price: hist.selling_price,
        valid_from: hist.valid_from,
        valid_to: hist.valid_to,
      });
    }

    localSearchIndex.clear();
    for (const offer of this.dealer_offers) {
      const doc = this.buildOpenSearchDoc(offer.offer_id);
      if (doc) {
        localSearchIndex.upsert(doc);
      }
    }

    this.seeded = true;
  }

  isSeeded(): boolean {
    return this.seeded;
  }

  // Trigger emulation: trg_bump_rev_offer / trg_bump_rev_inventory
  bumpOfferRevision(offerId: string): number {
    const existing = this.offer_state_versions.get(offerId);
    const nextRev = existing ? existing.revision + 1 : 1;
    this.offer_state_versions.set(offerId, {
      offer_id: offerId,
      revision: nextRev,
      updated_at: new Date().toISOString(),
    });
    return nextRev;
  }

  // Trigger emulation: trg_bump_rev_hub (v7.2 lock-ordered by offer_id)
  bumpRevisionForHubLocation(locationId: string): string[] {
    const affected = Array.from(
      new Set(this.inventory.filter((i) => i.location_id === locationId).map((i) => i.offer_id))
    ).sort();
    for (const offerId of affected) {
      this.bumpOfferRevision(offerId);
    }
    return affected;
  }

  // Trigger emulation: trg_log_price (uses monotonic timestamp so 2 changes in 1 txn stay valid)
  updateOfferPrice(offerId: string, newPricePaise: number): DealerOfferRow {
    if (!Number.isInteger(newPricePaise) || newPricePaise <= 0) {
      throw new DomainError(400, 'INVALID_PRICE', 'Selling price must be a positive integer in paise.');
    }
    const offer = this.dealer_offers.find((o) => o.offer_id === offerId);
    if (!offer) throw new DomainError(404, 'OFFER_NOT_FOUND', 'Offer not found.');
    if (offer.selling_price !== newPricePaise) {
      offer.selling_price = newPricePaise;
      const openRow = this.offer_price_history.find((h) => h.offer_id === offerId && h.valid_to === null);
      const nowMs = Date.now();
      const closeMs = openRow ? Math.max(nowMs, new Date(openRow.valid_from).getTime() + 1) : nowMs;
      if (openRow) {
        openRow.valid_to = new Date(closeMs).toISOString();
      }
      this.offer_price_history.push({
        history_id: this.nextHistoryId++,
        offer_id: offerId,
        selling_price: newPricePaise,
        valid_from: new Date(closeMs + 1).toISOString(),
        valid_to: null,
      });
      this.bumpOfferRevision(offerId);
      this.enqueueOutbox('offer-price-updated', offerId, {
        offer_id: offerId,
        selling_price: newPricePaise,
      });
    }
    return offer;
  }

  enqueueOutbox(eventType: string, aggregateKey: string, payload: Record<string, unknown>): OutboxRecord {
    const rec: OutboxRecord = {
      event_id: crypto.randomUUID(),
      event_type: eventType,
      aggregate_key: aggregateKey,
      payload,
      created_at: new Date().toISOString(),
      published_at: null,
      topic: topicForEventType(eventType),
      partition: partitionForKey(aggregateKey),
    };
    this.outbox_events.push(rec);
    return rec;
  }

  // Shared stock movement helpers (exact v7.2 guards)
  holdUnits(offerId: string, locationId: string, qty: number): void {
    const loc = this.stock_locations.find((l) => l.location_id === locationId);
    if (!loc || !loc.is_sellable) {
      throw new DomainError(409, 'LOCATION_NOT_SELLABLE', 'Stock location is not sellable.');
    }
    const inv = this.inventory.find((i) => i.offer_id === offerId && i.location_id === locationId);
    if (!inv || inv.quantity - inv.reserved_quantity < qty) {
      throw new DomainError(409, 'OUT_OF_STOCK', 'Sorry, this offer is no longer available in the requested quantity.');
    }
    inv.reserved_quantity += qty;
    this.bumpOfferRevision(offerId);
  }

  releaseHold(offerId: string, locationId: string, qty: number): void {
    const inv = this.inventory.find((i) => i.offer_id === offerId && i.location_id === locationId);
    if (!inv || inv.reserved_quantity < qty) {
      throw new DomainError(409, 'STOCK_RELEASE_FAILED', 'Unable to release stock reservation hold.');
    }
    inv.reserved_quantity -= qty;
    this.bumpOfferRevision(offerId);
  }

  deductUnits(offerId: string, locationId: string, qty: number): void {
    const inv = this.inventory.find((i) => i.offer_id === offerId && i.location_id === locationId);
    if (!inv || inv.quantity < qty || inv.reserved_quantity < qty) {
      throw new DomainError(500, 'INVENTORY_DEDUCTION_FAILED', 'Guarded inventory deduction failed.');
    }
    inv.quantity -= qty;
    inv.reserved_quantity -= qty;
    this.bumpOfferRevision(offerId);
  }

  // UPSERT: creates missing Bangalore inventory row on Section B cancel/restock!
  restockUnits(offerId: string, locationId: string, qty: number): number {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new DomainError(400, 'INVALID_QUANTITY', 'Restock quantity must be positive.');
    }
    const existing = this.inventory.find((i) => i.offer_id === offerId && i.location_id === locationId);
    if (existing) {
      existing.quantity += qty;
      this.bumpOfferRevision(offerId);
      return existing.quantity;
    }
    const created: InventoryRow = {
      inventory_id: crypto.randomUUID(),
      offer_id: offerId,
      location_id: locationId,
      quantity: qty,
      reserved_quantity: 0,
    };
    this.inventory.push(created);
    this.bumpOfferRevision(offerId);
    return created.quantity;
  }

  getHomeWarehouse(): StockLocationRow {
    const home = this.stock_locations.find((l) => l.is_home && l.is_sellable);
    if (!home) throw new Error('HOME_WAREHOUSE_MISSING');
    return home;
  }

  // Truth query per v7.2 (paused-hub units are NOT available!)
  getOfferTruth(offerId: string) {
    const offer = this.dealer_offers.find((o) => o.offer_id === offerId);
    if (!offer) return null;
    const revRow = this.offer_state_versions.get(offerId);
    const invRows = this.inventory.filter((i) => i.offer_id === offerId);

    let freeUnits = 0;
    let homeUnits = 0;
    let hubUnits = 0;
    let holdingUnits = 0;

    let bestLocation: StockLocationRow | null = null;
    let bestLocationPriority = 99;

    for (const inv of invRows) {
      const loc = this.stock_locations.find((l) => l.location_id === inv.location_id);
      if (!loc || !loc.is_sellable) continue;

      const hub = this.fulfilment_hubs.find((h) => h.location_id === loc.location_id);
      const hubActive = !hub || hub.active;
      const free = Math.max(0, inv.quantity - inv.reserved_quantity);

      if (hubActive) {
        freeUnits += free;
      }
      if (loc.is_home) {
        homeUnits += free;
      }
      if (loc.location_type === 'hub' && hubActive) {
        hubUnits += free;
      }
      if (loc.location_type === 'holding') {
        holdingUnits += free;
      }

      if (free > 0 && hubActive) {
        // Priority: active hub (if quick eligible) -> home warehouse -> holding
        const prio =
          loc.location_type === 'hub' && offer.eligible_modes.includes('quick')
            ? 1
            : loc.is_home
              ? 2
              : 3;
        if (prio < bestLocationPriority) {
          bestLocationPriority = prio;
          bestLocation = loc;
        }
      }
    }

    if (!bestLocation && invRows.length > 0) {
      const sellableRow = invRows.find((r) => {
        const l = this.stock_locations.find((x) => x.location_id === r.location_id);
        return l?.is_sellable;
      });
      if (sellableRow) {
        bestLocation = this.stock_locations.find((l) => l.location_id === sellableRow.location_id) ?? null;
      }
    }

    return {
      offer,
      revision: revRow?.revision ?? 1,
      free_units: freeUnits,
      home_units: homeUnits,
      hub_units: hubUnits,
      holding_units: holdingUnits,
      default_location: bestLocation ?? this.getHomeWarehouse(),
    };
  }

  buildOfferForComparison(offerId: string): OfferForComparison | null {
    const truth = this.getOfferTruth(offerId);
    if (!truth) return null;
    const { offer } = truth;
    const product = this.products.find((p) => p.product_id === offer.product_id);
    const dealer = this.dealers.find((d) => d.dealer_id === offer.dealer_id);
    if (!product || !dealer) return null;

    return {
      offer_id: offer.offer_id,
      product_id: offer.product_id,
      product_name: product.name,
      dealer_id: dealer.dealer_id,
      shop_name: dealer.shop_name,
      dealer_city: dealer.city,
      dealer_state: dealer.state,
      dealer_rating: dealer.dealer_rating,
      total_reviews: dealer.total_reviews,
      verified: dealer.verified,
      selling_price: offer.selling_price,
      status: offer.status,
      bangalore_delivery_days: offer.bangalore_delivery_days,
      transfer_days_min: offer.transfer_days_min,
      transfer_days_max: offer.transfer_days_max,
      eligible_modes: offer.eligible_modes,
      warranty_months: offer.warranty_months,
      warranty_note: offer.warranty_note,
      sellable_free_units: truth.free_units,
      home_free_units: truth.home_units,
      hub_free_units: truth.hub_units,
      default_location_id: truth.default_location.location_id,
      default_location_name: truth.default_location.name,
      default_location_city: truth.default_location.city,
      default_location_type: truth.default_location.location_type,
    };
  }

  buildOpenSearchDoc(offerId: string): OpenSearchOfferDoc | null {
    const truth = this.getOfferTruth(offerId);
    if (!truth) return null;
    const { offer } = truth;
    const product = this.products.find((p) => p.product_id === offer.product_id);
    const category = product ? this.categories.find((c) => c.category_id === product.category_id) : null;
    const dealer = this.dealers.find((d) => d.dealer_id === offer.dealer_id);
    if (!product || !category || !dealer) return null;

    const comp = this.buildOfferForComparison(offerId)!;
    const isOutside = dealer.city.toLowerCase() !== 'bengaluru';
    const hasHomeOrHub = truth.home_units > 0 || truth.hub_units > 0;

    return {
      offer_id: offer.offer_id,
      product_id: product.product_id,
      product_name: product.name,
      brand: product.brand,
      category_name: category.category_name,
      specs: product.specs,
      dealer_id: dealer.dealer_id,
      shop_name: dealer.shop_name,
      dealer_city: dealer.city,
      dealer_state: dealer.state,
      origin_city: hasHomeOrHub ? 'Bengaluru' : truth.default_location.city,
      origin_state: hasHomeOrHub ? 'Karnataka' : truth.default_location.state,
      is_outside_bangalore: isOutside,
      fulfilment_route: hasHomeOrHub ? 'standard' : 'transfer',
      selling_price: offer.selling_price,
      available_units: truth.free_units,
      home_units: truth.home_units,
      eligible_modes: offer.eligible_modes,
      bangalore_delivery_days: offer.bangalore_delivery_days,
      transfer_days_max: offer.transfer_days_max,
      effective_days: computeEffectiveDays(comp),
      dealer_rating: dealer.dealer_rating,
      total_reviews: dealer.total_reviews,
      verified: dealer.verified,
      warranty_months: offer.warranty_months,
      revision: truth.revision,
    };
  }

  async syncOfferToOpenSearch(offerId: string): Promise<{ revision: number; outcome: 'written' | 'stale' } | null> {
    const doc = this.buildOpenSearchDoc(offerId);
    if (!doc) return null;
    return upsertOfferDoc(doc);
  }

  /**
   * Transactional snapshot/rollback wrapper so any multi-step mutation (order placement,
   * cancellation, finalisation, refund credit) is 100% atomic on error.
   */
  runAtomic<T>(fn: () => T): T {
    const snap = {
      inventory: structuredClone(this.inventory),
      reservations: structuredClone(this.reservations),
      carts: structuredClone(this.carts),
      cart_items: structuredClone(this.cart_items),
      orders: structuredClone(this.orders),
      order_items: structuredClone(this.order_items),
      outbox_events: structuredClone(this.outbox_events),
      processed_events: structuredClone(this.processed_events),
      offer_state_versions: new Map(
        Array.from(this.offer_state_versions.entries()).map(([k, v]) => [k, { ...v }])
      ),
      payments: structuredClone(this.payments),
      refunds: structuredClone(this.refunds),
      after_sales_cases: structuredClone(this.after_sales_cases),
      fulfilment_groups: structuredClone(this.fulfilment_groups),
      stock_transfers: structuredClone(this.stock_transfers),
      shipment_timeline: structuredClone(this.shipment_timeline),
      notifications: structuredClone(this.notifications),
      coupons: structuredClone(this.coupons),
      coupon_customer_usage: new Map(this.coupon_customer_usage),
      coupon_redemptions: structuredClone(this.coupon_redemptions),
    };
    try {
      return fn();
    } catch (err) {
      this.inventory = snap.inventory;
      this.reservations = snap.reservations;
      this.carts = snap.carts;
      this.cart_items = snap.cart_items;
      this.orders = snap.orders;
      this.order_items = snap.order_items;
      this.outbox_events = snap.outbox_events;
      this.processed_events = snap.processed_events;
      this.offer_state_versions = snap.offer_state_versions;
      this.payments = snap.payments;
      this.refunds = snap.refunds;
      this.after_sales_cases = snap.after_sales_cases;
      this.fulfilment_groups = snap.fulfilment_groups;
      this.stock_transfers = snap.stock_transfers;
      this.shipment_timeline = snap.shipment_timeline;
      this.notifications = snap.notifications;
      this.coupons = snap.coupons;
      this.coupon_customer_usage = snap.coupon_customer_usage;
      this.coupon_redemptions = snap.coupon_redemptions;
      throw err;
    }
  }

  /**
   * Reconciliation query (v7.2): sum(paid_amount) per order MUST equal orders.total_amount
   * AND group.fee_total MUST equal sum(delivery_fee_share of its lines).
   * Returns mismatched rows (empty array = 0 discrepancies).
   */
  runReconciliationCheck(): Array<{ order_id: string; expected: number; actual: number; reason: string }> {
    const mismatches: Array<{ order_id: string; expected: number; actual: number; reason: string }> = [];
    for (const order of this.orders) {
      const items = this.order_items.filter((i) => i.order_id === order.order_id);
      const sumPaid = items.reduce((acc, i) => acc + i.paid_amount, 0);
      if (sumPaid !== order.total_amount) {
        mismatches.push({
          order_id: order.order_id,
          expected: order.total_amount,
          actual: sumPaid,
          reason: 'SUM(order_items.paid_amount) != orders.total_amount',
        });
      }
      const expectedTotal = order.items_total - order.discount_total + order.delivery_fee_total;
      if (expectedTotal !== order.total_amount) {
        mismatches.push({
          order_id: order.order_id,
          expected: expectedTotal,
          actual: order.total_amount,
          reason: 'items_total - discount_total + delivery_fee_total != total_amount',
        });
      }
      const groups = this.fulfilment_groups.filter((g) => g.order_id === order.order_id);
      for (const g of groups) {
        const groupItems = items.filter((i) => i.group_id === g.group_id);
        const sumFees = groupItems.reduce((acc, i) => acc + i.delivery_fee_share, 0);
        if (sumFees !== g.fee_total) {
          mismatches.push({
            order_id: order.order_id,
            expected: g.fee_total,
            actual: sumFees,
            reason: `group ${g.group_id} fee_total != SUM(delivery_fee_share)`,
          });
        }
      }
    }
    return mismatches;
  }

  getQuickGroupsCountToday(hubLocationId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.fulfilment_groups.filter(
      (g) =>
        g.location_id === hubLocationId &&
        g.mode === 'quick' &&
        g.status !== 'cancelled' &&
        g.created_at.startsWith(today)
    ).length;
  }

  getPickingQueueCount(hubLocationId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.fulfilment_groups.filter(
      (g) =>
        g.location_id === hubLocationId &&
        ['order_accepted', 'picked', 'packed'].includes(g.status) &&
        g.created_at.startsWith(today)
    ).length;
  }
}

export const store = new BazaarStore();
export { SEED_IDS };
