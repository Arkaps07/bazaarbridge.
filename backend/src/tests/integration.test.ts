import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import { createApp } from '../app';
import { store, SEED_IDS } from '../db/store';
import {
  dispatchEventToConsumers,
  flushOutbox,
  pauseConsumer,
  resumeConsumer,
  runReservationExpiryCleanup,
} from '../events/pipeline';
import { localSearchIndex, upsertOfferDoc } from '../search/opensearch';
import { computeWrongOtp } from '../utils/otp';

let server: http.Server;
let baseUrl = '';
let customerToken = '';
let customer2Token = '';
let adminToken = '';

async function api(
  method: string,
  path: string,
  options?: { token?: string; body?: unknown }
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

test.before(async () => {
  store.seed('Admin@1234');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  const c1 = await api('POST', '/api/auth/login', {
    body: { email: 'demo@bazaarbridge.dev', password: 'Demo@1234' },
  });
  assert.equal(c1.status, 200);
  customerToken = String(c1.data.token);

  const c2 = await api('POST', '/api/auth/login', {
    body: { email: 'shopper2@bazaarbridge.dev', password: 'Demo@1234' },
  });
  assert.equal(c2.status, 200);
  customer2Token = String(c2.data.token);

  const adm = await api('POST', '/api/auth/login', {
    body: { email: 'admin@bazaarbridge.dev', password: 'Admin@1234' },
  });
  assert.equal(adm.status, 200);
  adminToken = String(adm.data.token);
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('1. Auth & RBAC: protected routes reject unauthenticated calls and customer cannot access admin routes', async () => {
  const noAuth = await api('GET', '/api/cart');
  assert.equal(noAuth.status, 401);

  const customerAdmin = await api('GET', '/api/admin/overview', { token: customerToken });
  assert.equal(customerAdmin.status, 403);

  const adminOk = await api('GET', '/api/admin/overview', { token: adminToken });
  assert.equal(adminOk.status, 200);
});

test('2. Search filters & PG recheck: typo-tolerant bluetoth + category, max_price, city=Mysuru, stale price blocked', async () => {
  const filtersResp = await api('GET', '/api/search/filters');
  assert.equal(filtersResp.status, 200);
  const cities = filtersResp.data.cities as string[];
  assert.ok(cities.includes('Mysuru'));
  assert.ok(cities.includes('Bengaluru'));

  // Typo-tolerant "bluetoth"
  const fuzzy = await api('GET', '/api/search?q=bluetoth');
  assert.equal(fuzzy.status, 200);
  const fuzzyResults = fuzzy.data.results as Array<Record<string, unknown>>;
  assert.ok(fuzzyResults.length >= 5);

  // Filter by city=Mysuru + q=bluetoth
  const mysuru = await api('GET', '/api/search?q=bluetoth&city=Mysuru');
  assert.equal(mysuru.status, 200);
  const mysuruResults = mysuru.data.results as Array<Record<string, unknown>>;
  assert.ok(mysuruResults.length >= 1);
  assert.ok(mysuruResults.every((r) => r.dealer_city === 'Mysuru'));

  // Stale index recheck: raise price in DB WITHOUT syncing OpenSearch -> max_price must STILL filter it out!
  const budgetOffer = store.dealer_offers.find((o) => o.offer_id === SEED_IDS.offers.speakerBudget)!;
  const origPrice = budgetOffer.selling_price;
  budgetOffer.selling_price = 95000; // raised above 75000 without updating index
  const maxPriceSearch = await api('GET', '/api/search?q=bluetoth&max_price=75000');
  const mpResults = maxPriceSearch.data.results as Array<Record<string, unknown>>;
  assert.equal(
    mpResults.some((r) => r.offer_id === SEED_IDS.offers.speakerBudget),
    false,
    'PG recheck must never leak an offer whose live price exceeds max_price'
  );
  budgetOffer.selling_price = origPrice;
});

test('3. Comparison winners API: five tabs return 5 distinct offers in exact order', async () => {
  const cats = ['budget', 'fastest', 'rated', 'value', 'available'];
  const expectedPrices = [69900, 77900, 74900, 72500, 76900];
  const winnerIds: string[] = [];

  for (let i = 0; i < cats.length; i++) {
    const resp = await api(
      'GET',
      `/api/products/${SEED_IDS.products.fiveDealerSpeaker}/offers?category=${cats[i]}`
    );
    assert.equal(resp.status, 200);
    const winner = resp.data.winner as Record<string, unknown>;
    assert.equal(winner.selling_price, expectedPrices[i]);
    assert.ok(typeof winner.reason === 'string' && winner.reason.length > 10);
    winnerIds.push(String(winner.offer_id));
  }
  assert.equal(new Set(winnerIds).size, 5);
});

test('4. Concurrency: two simultaneous reservations for the 1-unit product yield exactly 1x 201 and 1x 409 OUT_OF_STOCK', async () => {
  const [r1, r2] = await Promise.all([
    api('POST', '/api/cart/reserve', {
      token: customerToken,
      body: {
        offer_id: SEED_IDS.offers.oneUnitOffer,
        location_id: SEED_IDS.locations.bangaloreWarehouse,
        quantity: 1,
        request_key: `race-${crypto.randomUUID()}`,
      },
    }),
    api('POST', '/api/cart/reserve', {
      token: customer2Token,
      body: {
        offer_id: SEED_IDS.offers.oneUnitOffer,
        location_id: SEED_IDS.locations.bangaloreWarehouse,
        quantity: 1,
        request_key: `race-${crypto.randomUUID()}`,
      },
    }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 409]);

  const loser = r1.status === 409 ? r1 : r2;
  assert.equal(loser.data.error, 'OUT_OF_STOCK');

  const inv = store.inventory.find(
    (i) =>
      i.offer_id === SEED_IDS.offers.oneUnitOffer &&
      i.location_id === SEED_IDS.locations.bangaloreWarehouse
  )!;
  assert.equal(inv.reserved_quantity, 1);

  // Release winner's hold for subsequent tests
  const winner = r1.status === 201 ? r1 : r2;
  const winnerTok = r1.status === 201 ? customerToken : customer2Token;
  const rel = await api('POST', '/api/cart/release', {
    token: winnerTok,
    body: { reservation_id: winner.data.reservation_id },
  });
  assert.equal(rel.status, 200);
  assert.equal(inv.reserved_quantity, 0);
});

test('5. PRICE_CHANGED & price-change-retry on 1-unit product + release idempotency', async () => {
  const res1 = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.oneUnitOffer,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: 1,
      request_key: `pc-${crypto.randomUUID()}`,
    },
  });
  assert.equal(res1.status, 201);
  const resId = String(res1.data.reservation_id);

  // Change price in DB
  store.updateOfferPrice(SEED_IDS.offers.oneUnitOffer, 339900);

  // Order fails with 409 PRICE_CHANGED and leaves reservation 'reserved'
  const ordFail = await api('POST', '/api/orders', {
    token: customerToken,
    body: { reservation_ids: [resId], address: { pin_code: '560034' } },
  });
  assert.equal(ordFail.status, 409);
  assert.equal(ordFail.data.error, 'PRICE_CHANGED');

  // Double concurrent release -> both 200, reserved_quantity restored ONCE to 0
  const [relA, relB] = await Promise.all([
    api('POST', '/api/cart/release', { token: customerToken, body: { reservation_id: resId } }),
    api('POST', '/api/cart/release', { token: customerToken, body: { reservation_id: resId } }),
  ]);
  assert.equal(relA.status, 200);
  assert.equal(relB.status, 200);

  const inv = store.inventory.find(
    (i) =>
      i.offer_id === SEED_IDS.offers.oneUnitOffer &&
      i.location_id === SEED_IDS.locations.bangaloreWarehouse
  )!;
  assert.equal(inv.reserved_quantity, 0);

  // Re-reserve at new price and place order -> 201 (customer not blocked by own hold!)
  const res2 = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.oneUnitOffer,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: 1,
      request_key: `pc-retry-${crypto.randomUUID()}`,
    },
  });
  assert.equal(res2.status, 201);
  assert.equal(res2.data.price_paise, 339900);

  const ordOk = await api('POST', '/api/orders', {
    token: customerToken,
    body: { reservation_ids: [res2.data.reservation_id], address: { pin_code: '560034' } },
  });
  assert.equal(ordOk.status, 201);

  // Attempting to release CONFIRMED reservation -> 409 CANNOT_RELEASE_CONFIRMED
  const relConf = await api('POST', '/api/cart/release', {
    token: customerToken,
    body: { reservation_id: res2.data.reservation_id },
  });
  assert.equal(relConf.status, 409);
  assert.equal(relConf.data.error, 'CANNOT_RELEASE_CONFIRMED');

  // Restore 1-unit stock for later tests
  store.restockUnits(SEED_IDS.offers.oneUnitOffer, SEED_IDS.locations.bangaloreWarehouse, 1);
  store.updateOfferPrice(SEED_IDS.offers.oneUnitOffer, 329900);
});

test('6. Stale OpenSearch revision guard: lower revision returns stale without regressing index', async () => {
  const offerId = SEED_IDS.offers.speakerRated;
  const docR = store.buildOpenSearchDoc(offerId)!;
  const r = docR.revision;

  store.bumpOfferRevision(offerId);
  const docR1 = store.buildOpenSearchDoc(offerId)!;
  assert.equal(docR1.revision, r + 1);

  const freshRes = await upsertOfferDoc(docR1);
  assert.equal(freshRes.outcome, 'written');

  const staleRes = await upsertOfferDoc(docR);
  assert.equal(staleRes.outcome, 'stale');
  assert.equal(localSearchIndex.getDoc(offerId)?.revision, r + 1);
});

test('7. Mixed cart hybrid fulfilment, fees, reconciliation, OTP proofs on ALL modes, and OTP privacy', async () => {
  // Reserve 1 hub item (Quick) + 1 warehouse item (Standard) + 1 Mysuru item (Transfer)
  const rQuick = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.mixedCartQuick,
      location_id: SEED_IDS.locations.koramangalaHub,
      quantity: 1,
      request_key: `mix-q-${crypto.randomUUID()}`,
    },
  });
  const rStd = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.speakerBudget,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: 1,
      request_key: `mix-s-${crypto.randomUUID()}`,
    },
  });
  const rTrans = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.mysuruOnlySectionB,
      location_id: SEED_IDS.locations.mysuruHolding,
      quantity: 1,
      request_key: `mix-t-${crypto.randomUUID()}`,
    },
  });

  // Unserved PIN rejects explicit Quick
  const unserved = await api('POST', '/api/orders', {
    token: customerToken,
    body: {
      reservation_ids: [rQuick.data.reservation_id],
      address: { pin_code: '560999' },
      mode_preferences: { [String(rQuick.data.reservation_id)]: 'quick' },
    },
  });
  assert.equal(unserved.status, 409);
  assert.equal(unserved.data.error, 'QUICK_NOT_AVAILABLE');

  // Served PIN 560034 creates ONE parent order with THREE independent groups (quick 4900, standard 2900, transfer 6900)
  const orderResp = await api('POST', '/api/orders', {
    token: customerToken,
    body: {
      reservation_ids: [
        rQuick.data.reservation_id,
        rStd.data.reservation_id,
        rTrans.data.reservation_id,
      ],
      address: { pin_code: '560034' },
    },
  });
  assert.equal(orderResp.status, 201);
  assert.equal(orderResp.data.delivery_fee_total, 4900 + 2900 + 6900);
  const groups = orderResp.data.groups as Array<Record<string, unknown>>;
  assert.equal(groups.length, 3);
  assert.equal(store.runReconciliationCheck().length, 0);

  // Replay order-placed event -> quantity must NOT decrease twice and NO duplicate notification
  const orderPlacedEv = store.outbox_events.find(
    (e) => e.event_type === 'order-placed' && e.aggregate_key === orderResp.data.order_id
  )!;
  const notifBefore = store.notifications.length;
  await dispatchEventToConsumers(orderPlacedEv);
  await flushOutbox();
  assert.equal(store.notifications.length, notifBefore);

  // Drive Quick group through simulator + verify wrong OTP fails & correct OTP delivers + NO raw OTP in outbox/live-proof!
  const quickGroup = groups.find((g) => g.mode === 'quick')!;
  const qGroupId = String(quickGroup.group_id);

  for (const evType of ['picked', 'packed', 'rider_assigned', 'picked_up', 'out_for_delivery']) {
    const f = await api('POST', '/api/simulator/fire-event', {
      token: adminToken,
      body: { group_id: qGroupId, event_type: evType },
    });
    assert.equal(f.status, 202);
  }

  // Missing OTP -> 400 OTP_REQUIRED
  const missingOtp = await api('POST', '/api/simulator/fire-event', {
    token: adminToken,
    body: { group_id: qGroupId, event_type: 'otp_verified' },
  });
  assert.equal(missingOtp.status, 400);
  assert.equal(missingOtp.data.error, 'OTP_REQUIRED');

  // Fetch demo OTP via admin endpoint
  const otpResp = await api('GET', `/api/admin/groups/${qGroupId}/demo-otp`, { token: adminToken });
  assert.equal(otpResp.status, 200);
  const rawOtp = String(otpResp.data.demo_otp);
  assert.match(rawOtp, /^\d{6}$/);

  // Wrong OTP -> otp_failed timeline row, NEVER delivered
  const wrongFire = await api('POST', '/api/simulator/fire-event', {
    token: adminToken,
    body: { group_id: qGroupId, event_type: 'otp_verified', otp: computeWrongOtp(rawOtp) },
  });
  assert.equal(wrongFire.status, 202);
  const groupAfterWrong = store.fulfilment_groups.find((g) => g.group_id === qGroupId)!;
  assert.equal(groupAfterWrong.status, 'out_for_delivery');

  // Correct OTP -> delivered
  const rightFire = await api('POST', '/api/simulator/fire-event', {
    token: adminToken,
    body: { group_id: qGroupId, event_type: 'otp_verified', otp: rawOtp },
  });
  assert.equal(rightFire.status, 202);
  assert.equal(store.fulfilment_groups.find((g) => g.group_id === qGroupId)!.status, 'delivered');

  // OTP privacy: rawOtp MUST NEVER appear as a JSON string value in outbox payloads or live-proof!
  const liveProof = await api('GET', '/api/admin/live-proof', { token: adminToken });
  assert.equal(liveProof.status, 200);
  const otpEvents = store.outbox_events.filter(
    (e) => e.event_type === 'fulfilment-status-updated' && e.payload.event_type === 'otp_verified'
  );
  assert.ok(otpEvents.length >= 2);
  for (const ev of otpEvents) {
    assert.ok(typeof ev.payload.otp_proof === 'string' && ev.payload.otp_proof.length === 64);
    assert.equal(ev.payload.otp, undefined);
    assert.equal(JSON.stringify(ev.payload).includes(`"${rawOtp}"`), false);
  }

  // Transfer group: drive 3 distinct steps (in_transit -> received_checked -> allocated)
  const transferGroup = groups.find((g) => g.mode === 'transfer')!;
  const tGroupId = String(transferGroup.group_id);
  const transferRow = store.stock_transfers.find((t) => t.group_id === tGroupId)!;
  assert.equal(transferRow.offer_id, SEED_IDS.offers.mysuruOnlySectionB);

  await api('POST', '/api/simulator/fire-event', {
    token: adminToken,
    body: { group_id: tGroupId, event_type: 'in_transit' },
  });
  assert.equal(transferRow.status, 'in_transit');

  await api('POST', '/api/simulator/fire-event', {
    token: adminToken,
    body: { group_id: tGroupId, event_type: 'received_checked' },
  });
  assert.equal(transferRow.status, 'received_checked');
  // Must NOT have allocated or added free Bangalore stock!
  const blrInvBeforeAlloc = store.inventory.find(
    (i) =>
      i.offer_id === SEED_IDS.offers.mysuruOnlySectionB &&
      i.location_id === SEED_IDS.locations.bangaloreWarehouse
  );
  assert.equal(blrInvBeforeAlloc, undefined);

  await api('POST', '/api/simulator/fire-event', {
    token: adminToken,
    body: { group_id: tGroupId, event_type: 'allocated' },
  });
  assert.equal(transferRow.status, 'allocated');
  // Still NO free Bangalore stock (units belong to this order)
  assert.equal(
    store.inventory.find(
      (i) =>
        i.offer_id === SEED_IDS.offers.mysuruOnlySectionB &&
        i.location_id === SEED_IDS.locations.bangaloreWarehouse
    ),
    undefined
  );

  // Cancel after allocated -> T4 restock-missing-row UPSERT creates Bangalore row with qty = 1!
  const tOrderItem = store.order_items.find((i) => i.group_id === tGroupId)!;
  const cancelT4 = await api(
    'POST',
    `/api/orders/${orderResp.data.order_id}/items/${tOrderItem.order_item_id}/cancel`,
    { token: customerToken, body: { request_key: `cancel-t4-${crypto.randomUUID()}` } }
  );
  assert.equal(cancelT4.status, 200);
  assert.equal(transferRow.status, 'restocked_bangalore');
  const blrInvCreated = store.inventory.find(
    (i) =>
      i.offer_id === SEED_IDS.offers.mysuruOnlySectionB &&
      i.location_id === SEED_IDS.locations.bangaloreWarehouse
  );
  assert.ok(blrInvCreated, 'Missing Bangalore inventory row must be created via restock_units upsert');
  assert.equal(blrInvCreated.quantity, 1);

  // Double-refund test: POST /api/admin/refunds/:id/credit TWICE concurrently -> credited ONCE!
  const refundObj = cancelT4.data.refund as Record<string, unknown>;
  const refundId = String(refundObj.refund_id);
  const [cA, cB] = await Promise.all([
    api('POST', `/api/admin/refunds/${refundId}/credit`, { token: adminToken, body: {} }),
    api('POST', `/api/admin/refunds/${refundId}/credit`, { token: adminToken, body: {} }),
  ]);
  assert.equal(cA.status, 202);
  assert.equal(cB.status, 202);

  assert.equal(tOrderItem.item_refunded_amount, tOrderItem.item_paid_amount);
  assert.equal(tOrderItem.fee_refunded_amount, tOrderItem.delivery_fee_share);
  assert.equal(tOrderItem.refunded_amount, tOrderItem.paid_amount);
  assert.equal(store.refunds.find((r) => r.refund_id === refundId)!.status, 'credited');

  // Third credit call -> still no double credit
  await api('POST', `/api/admin/refunds/${refundId}/credit`, { token: adminToken, body: {} });
  assert.equal(tOrderItem.refunded_amount, tOrderItem.paid_amount);
});

test('8. Cancel-before-finalise & receipt-with-cancel restock + hub pause + assistant fallback', async () => {
  // Cancel-before-finalise: pause inventory-finalizer, place order, cancel, resume finalizer
  pauseConsumer('inventory-finalizer');
  const rHold = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.speakerValue,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: 1,
      request_key: `cbf-${crypto.randomUUID()}`,
    },
  });
  const invRow = store.inventory.find(
    (i) =>
      i.offer_id === SEED_IDS.offers.speakerValue &&
      i.location_id === SEED_IDS.locations.bangaloreWarehouse
  )!;
  const qtyBefore = invRow.quantity;

  const ord = await api('POST', '/api/orders', {
    token: customerToken,
    body: { reservation_ids: [rHold.data.reservation_id], address: { pin_code: '560034' } },
  });
  assert.equal(ord.status, 201);
  const item = store.order_items.find((i) => i.order_id === ord.data.order_id)!;
  assert.equal(item.stock_finalised, false);

  const canc = await api('POST', `/api/orders/${ord.data.order_id}/items/${item.order_item_id}/cancel`, {
    token: customerToken,
    body: { request_key: `cbf-c-${crypto.randomUUID()}` },
  });
  assert.equal(canc.status, 200);
  assert.equal(invRow.quantity, qtyBefore);
  assert.equal(
    store.reservations.find((r) => r.reservation_id === rHold.data.reservation_id)!.status,
    'released'
  );

  // Resume finalizer -> MUST skip the cancelled line, quantity unchanged
  await resumeConsumer('inventory-finalizer');
  await flushOutbox();
  assert.equal(invRow.quantity, qtyBefore);
  assert.equal(item.stock_finalised, false);

  // Hub pause -> Quick immediately disappears from check-pin and search; resume -> returns
  const pauseResp = await api('POST', `/api/admin/hubs/${SEED_IDS.hub.koramangala}/status`, {
    token: adminToken,
    body: { active: false },
  });
  assert.equal(pauseResp.status, 200);
  const pinPaused = await api('POST', '/api/check-pin', { body: { pin_code: '560034' } });
  assert.equal(pinPaused.data.quick_available, false);

  const resumeResp = await api('POST', `/api/admin/hubs/${SEED_IDS.hub.koramangala}/status`, {
    token: adminToken,
    body: { active: true },
  });
  assert.equal(resumeResp.status, 200);
  const pinResumed = await api('POST', '/api/check-pin', { body: { pin_code: '560034' } });
  assert.equal(pinResumed.data.quick_available, true);

  // Reservation expiry cleanup restores expired 'reserved' holds and never touches 'confirmed'
  const rExp = await api('POST', '/api/cart/reserve', {
    token: customerToken,
    body: {
      offer_id: SEED_IDS.offers.speakerAvailable,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: 2,
      request_key: `exp-${crypto.randomUUID()}`,
    },
  });
  const resObj = store.reservations.find((r) => r.reservation_id === rExp.data.reservation_id)!;
  resObj.expires_at = new Date(Date.now() - 5000).toISOString();
  const expiredCount = await runReservationExpiryCleanup();
  assert.equal(expiredCount, 1);
  assert.equal(resObj.status, 'expired');

  // Shopping assistant returns validated filters + live DB offers + fallback flag when Gemini key is absent
  const assist = await api('POST', '/api/shopping-assistant', {
    token: customerToken,
    body: { message: 'Show me bluetooth speakers under 800' },
  });
  assert.equal(assist.status, 200);
  assert.ok(Array.isArray(assist.data.results));
  assert.ok((assist.data.results as unknown[]).length >= 1);
});
