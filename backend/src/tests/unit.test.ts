import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateProportional,
  computeGroupFee,
  FEE_QUICK_PAISE,
  FEE_STANDARD_PAISE,
  FEE_TRANSFER_PAISE,
  FREE_STANDARD_THRESHOLD_PAISE,
} from '../api/fees';
import { computeEtaWindow, isWithinHubHours } from '../api/eta';
import { rankOffersByCategory } from '../utils/comparison';
import {
  computeGroupOtpHash,
  computeWrongOtp,
  deriveOtp,
  hashOtpSubmission,
  verifyOtpProofConstantTime,
} from '../utils/otp';
import { isGroupCancellable, partitionForKey, resolveGroupTransition } from '../utils/stateMachines';
import { ruleBasedExtractFilters, validateAssistantFilters } from '../utils/assistantValidation';
import { store, SEED_IDS } from '../db/store';

test('fees: computes exact locked SAMPLE group fees and free standard threshold', () => {
  assert.equal(computeGroupFee('quick', 500000), FEE_QUICK_PAISE);
  assert.equal(computeGroupFee('standard', 99899), FEE_STANDARD_PAISE);
  assert.equal(computeGroupFee('standard', FREE_STANDARD_THRESHOLD_PAISE), 0);
  assert.equal(computeGroupFee('transfer', 500000), FEE_TRANSFER_PAISE);
});

test('fees: allocateProportional distributes integer paise with zero remainder drift', () => {
  const shares = allocateProportional(100, [
    { id: 'item-b', weightPaise: 1000 },
    { id: 'item-a', weightPaise: 1000 },
    { id: 'item-c', weightPaise: 1000 },
  ]);
  // Sorted by id: item-a gets 34, item-b gets 33, item-c gets 33 -> sum = 100
  assert.equal(shares.get('item-a'), 34);
  assert.equal(shares.get('item-b'), 33);
  assert.equal(shares.get('item-c'), 33);
  const sum = Array.from(shares.values()).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('eta: computes range for quick, standard, and transfer modes', () => {
  const fixedNow = new Date('2026-11-21T10:00:00.000Z');
  const quick = computeEtaWindow({ mode: 'quick', pickingQueue: 3, now: fixedNow });
  // center = 5 + 12 + 5 + 5 + 20 = 47m -> range 32-62m
  assert.equal(quick.eta_basis.estimated_minutes_center, 47);
  assert.equal(quick.eta_basis.label, '32–62 mins');

  const standard = computeEtaWindow({ mode: 'standard', now: fixedNow });
  assert.equal(standard.eta_basis.label, '2–3 days');

  const transfer = computeEtaWindow({ mode: 'transfer', transferDaysMax: 3, now: fixedNow });
  assert.equal(transfer.eta_basis.label, '5–6 days (incl. ~3d transfer)');

  assert.equal(isWithinHubHours({ open: '00:00', close: '23:59', always_open: true }, fixedNow), true);
});

test('comparison: five tabs pick FIVE DIFFERENT offers on seed Bluetooth speaker and ignore quarantine stock', () => {
  store.seed();
  const speakerOffers = store.dealer_offers
    .filter((o) => o.product_id === SEED_IDS.products.fiveDealerSpeaker)
    .map((o) => store.buildOfferForComparison(o.offer_id)!)
    .filter(Boolean);

  assert.equal(speakerOffers.length, 5);

  const budget = rankOffersByCategory(speakerOffers, 'budget')[0];
  const fastest = rankOffersByCategory(speakerOffers, 'fastest')[0];
  const rated = rankOffersByCategory(speakerOffers, 'rated')[0];
  const value = rankOffersByCategory(speakerOffers, 'value')[0];
  const available = rankOffersByCategory(speakerOffers, 'available')[0];

  assert.equal(budget.selling_price, 69900);
  assert.equal(fastest.selling_price, 77900);
  assert.equal(rated.selling_price, 74900);
  assert.equal(value.selling_price, 72500);
  assert.equal(available.selling_price, 76900);

  // Confirm 5 distinct offer IDs and quarantine 50 units on Rs.699 offer did NOT count in sellable_free_units
  const uniqueIds = new Set([
    budget.offer_id,
    fastest.offer_id,
    rated.offer_id,
    value.offer_id,
    available.offer_id,
  ]);
  assert.equal(uniqueIds.size, 5);
  assert.equal(budget.sellable_free_units, 12);
  assert.equal(available.sellable_free_units, 40);
  assert.ok(budget.reason.includes('Rs.699'));
});

test('otp: deterministic derivation, HMAC proof verification, and wrong code rejection', () => {
  const groupId = '11111111-1111-4111-8111-111111111111';
  const code1 = deriveOtp(groupId, 'test-secret');
  const code2 = deriveOtp(groupId, 'test-secret');
  assert.equal(code1, code2);
  assert.match(code1, /^\d{6}$/);

  const storedHash = computeGroupOtpHash(groupId, 'test-secret');
  const validProof = hashOtpSubmission(code1, 'test-secret');
  const wrongProof = hashOtpSubmission(computeWrongOtp(code1), 'test-secret');

  assert.equal(verifyOtpProofConstantTime(storedHash, validProof), true);
  assert.equal(verifyOtpProofConstantTime(storedHash, wrongProof), false);
  assert.notEqual(validProof, code1);
});

test('stateMachines: one-way group transitions, transfer cancellability, and deterministic partitioning', () => {
  assert.equal(resolveGroupTransition('quick', 'order_accepted', 'picked'), 'picked');
  assert.equal(resolveGroupTransition('quick', 'order_accepted', 'delivered'), null);
  assert.equal(resolveGroupTransition('transfer', 'in_transit_to_bangalore', 'received_checked'), 'received_checked');
  assert.equal(resolveGroupTransition('transfer', 'received_checked', 'allocated'), 'allocated');

  // Transfer in_transit_to_bangalore IS cancellable; picked_up / out_for_delivery / delivered are NOT
  assert.equal(isGroupCancellable('in_transit_to_bangalore'), true);
  assert.equal(isGroupCancellable('picked_up'), false);
  assert.equal(isGroupCancellable('out_for_delivery'), false);
  assert.equal(isGroupCancellable('delivered'), false);

  // Same key always maps to the same partition (0 or 1)
  const p1 = partitionForKey('offer-abc-123');
  const p2 = partitionForKey('offer-abc-123');
  assert.equal(p1, p2);
  assert.ok(p1 === 0 || p1 === 1);
});

test('assistantValidation: strips unknown fields, enforces bounds, and runs deterministic fallback', () => {
  const cats = ['Audio & Speakers', 'Computing & Peripherals'];
  const cities = ['Bengaluru', 'Mysuru'];
  const validated = validateAssistantFilters(
    {
      q: 'bluetooth speaker',
      category: 'audio & speakers',
      max_price: 80000,
      city: 'mysuru',
      delivery_mode: 'quick',
      sql: 'DROP TABLE users;',
    },
    cats,
    cities
  );
  assert.equal(validated.category, 'Audio & Speakers');
  assert.equal(validated.city, 'Mysuru');
  assert.equal(validated.max_price, 80000);
  assert.equal((validated as Record<string, unknown>).sql, undefined);

  const fallback = ruleBasedExtractFilters('Find bluetooth speaker under 800 in Mysuru', cats, cities);
  assert.equal(fallback.max_price, 80000);
  assert.equal(fallback.city, 'Mysuru');
  assert.equal(fallback.category, 'Audio & Speakers');
});
