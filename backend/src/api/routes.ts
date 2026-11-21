import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { envConfig, getFeatureFlags, isFeatureEnabled } from '../config/env';
import { DomainError, store } from '../db/store';
import { flushOutbox, runReservationExpiryCleanup } from '../events/pipeline';
import {
  assistantRateLimiter,
  clearSessionCookie,
  loginRateLimiter,
  optionalAuth,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  signAuthToken,
} from '../middleware/auth';
import { getIndexedOfferDoc, localSearchIndex, searchOffers } from '../search/opensearch';
import {
  computeEffectiveDays,
  rankOffersByCategory,
  type ComparisonCategory,
  type OfferForComparison,
} from '../utils/comparison';
import { computeGroupOtpHash, deriveOtp, hashOtpSubmission } from '../utils/otp';
import {
  isGroupCancellable,
  SIMULATOR_FULFILMENT_EVENTS,
  SIMULATOR_TRANSFER_EVENTS,
} from '../utils/stateMachines';
import { computeEtaWindow, isWithinHubHours } from './eta';
import {
  allocateProportional,
  computeGroupFee,
  FEE_QUICK_PAISE,
  FEE_STANDARD_PAISE,
  FEE_TRANSFER_PAISE,
  FREE_STANDARD_THRESHOLD_PAISE,
  type FulfilmentMode,
} from './fees';
import { extractShoppingFilters } from './assistantService';

export const apiRouter = Router();

function sendError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details ?? {}),
    });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
    });
    return;
  }
  console.error('[API Error]', err instanceof Error ? err.message : 'Unknown error');
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' });
}

function getOrCreateCart(userId: string) {
  let cart = store.carts.find((c) => c.user_id === userId);
  if (!cart) {
    cart = { cart_id: crypto.randomUUID(), user_id: userId };
    store.carts.push(cart);
  }
  return cart;
}

function computeOfferQuickEligibility(offerId: string, pinCode?: string) {
  const offer = store.dealer_offers.find((o) => o.offer_id === offerId);
  if (!offer || !offer.eligible_modes.includes('quick')) {
    return { quick_available: false, hub_id: null as string | null, hub_location_id: null as string | null };
  }

  let hubs = store.fulfilment_hubs.filter((h) => h.active && isWithinHubHours(h.hours));
  if (pinCode) {
    const area = store.hub_service_areas.find((a) => a.pin_code === pinCode.trim());
    if (!area) {
      return { quick_available: false, hub_id: null, hub_location_id: null };
    }
    hubs = hubs.filter((h) => h.hub_id === area.hub_id);
  }

  for (const hub of hubs) {
    const used = store.getQuickGroupsCountToday(hub.location_id);
    if (used >= hub.order_capacity) continue;
    const inv = store.inventory.find(
      (i) => i.offer_id === offerId && i.location_id === hub.location_id
    );
    if (inv && inv.quantity - inv.reserved_quantity > 0) {
      return { quick_available: true, hub_id: hub.hub_id, hub_location_id: hub.location_id };
    }
  }
  return { quick_available: false, hub_id: null, hub_location_id: null };
}

function buildProductSummary(productId: string, pinCode?: string) {
  const product = store.products.find((p) => p.product_id === productId);
  if (!product) return null;
  const category = store.categories.find((c) => c.category_id === product.category_id);
  const offers = store.dealer_offers
    .filter((o) => o.product_id === productId && o.status === 'active')
    .map((o) => store.buildOfferForComparison(o.offer_id))
    .filter((o): o is OfferForComparison => o !== null && o.sellable_free_units > 0);

  if (offers.length === 0) {
    return {
      product_id: product.product_id,
      name: product.name,
      brand: product.brand,
      description: product.description,
      category_id: product.category_id,
      category_name: category?.category_name ?? 'General',
      specs: product.specs,
      dealer_count: 0,
      min_price_paise: null,
      max_price_paise: null,
      best_rating: 0,
      total_free_units: 0,
      quick_available: false,
      default_offer_id: null,
      cities: [] as string[],
      has_transfer_only: false,
    };
  }

  const budgetRanked = rankOffersByCategory(offers, 'budget');
  const minPrice = Math.min(...offers.map((o) => o.selling_price));
  const maxPrice = Math.max(...offers.map((o) => o.selling_price));
  const bestRating = Math.max(...offers.map((o) => o.dealer_rating));
  const totalFree = offers.reduce((acc, o) => acc + o.sellable_free_units, 0);
  const quickAvailable = offers.some((o) => computeOfferQuickEligibility(o.offer_id, pinCode).quick_available);
  const cities = Array.from(new Set(offers.map((o) => o.dealer_city)));
  const hasTransferOnly = offers.every((o) => o.home_free_units === 0 && o.hub_free_units === 0);

  return {
    product_id: product.product_id,
    name: product.name,
    brand: product.brand,
    description: product.description,
    category_id: product.category_id,
    category_name: category?.category_name ?? 'General',
    specs: product.specs,
    dealer_count: offers.length,
    min_price_paise: minPrice,
    max_price_paise: maxPrice,
    best_rating: bestRating,
    total_free_units: totalFree,
    quick_available: quickAvailable,
    default_offer_id: budgetRanked[0]?.offer_id ?? null,
    default_location_id: budgetRanked[0]?.default_location_id ?? null,
    default_shop_name: budgetRanked[0]?.shop_name ?? null,
    cities,
    has_transfer_only: hasTransferOnly,
  };
}

// ============================================================
// HEALTH & SYSTEM CAPABILITIES
// ============================================================

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'bazaarbridge-api',
    version: '7.2.0',
    infrastructure: {
      postgresql: envConfig.isPgConfigured ? 'aiven_configured' : 'local_sandbox_preview',
      kafka: envConfig.isKafkaConfigured ? 'aiven_configured' : 'local_sandbox_preview',
      opensearch: envConfig.isOpenSearchConfigured ? 'aiven_configured' : 'local_sandbox_preview',
      gemini: envConfig.isGeminiConfigured ? 'configured' : 'rule_based_fallback',
    },
    feature_flags: Array.from(getFeatureFlags()),
    sample_fees_paise: {
      quick: FEE_QUICK_PAISE,
      standard: FEE_STANDARD_PAISE,
      transfer: FEE_TRANSFER_PAISE,
      free_standard_threshold: FREE_STANDARD_THRESHOLD_PAISE,
    },
  });
});

// ============================================================
// AUTHENTICATION
// ============================================================

const loginSchema = z.object({
  email: z.string().email(),
  ['password']: z.string().min(1),
});

apiRouter.post('/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = store.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      return;
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      return;
    }
    const token = signAuthToken({
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
    setSessionCookie(res, token);
    res.json({
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/auth/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ logged_out: true });
});

apiRouter.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

apiRouter.get('/auth/session', optionalAuth, (req: Request, res: Response) => {
  res.json({ authenticated: Boolean(req.user), user: req.user ?? null });
});

// ============================================================
// PRODUCTS, SEARCH & DEALER COMPARISON
// ============================================================

apiRouter.get('/search/filters', (_req: Request, res: Response) => {
  // PG only: categories, and cities of dealers that have active offers
  const activeDealerIds = new Set(
    store.dealer_offers.filter((o) => o.status === 'active').map((o) => o.dealer_id)
  );
  const cities = Array.from(
    new Set(
      store.dealers
        .filter((d) => activeDealerIds.has(d.dealer_id))
        .map((d) => d.city)
    )
  ).sort();

  res.json({
    categories: store.categories.map((c) => ({
      category_id: c.category_id,
      category_name: c.category_name,
    })),
    cities,
  });
});

apiRouter.get('/search', optionalAuth, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const maxPriceRaw = typeof req.query.max_price === 'string' ? req.query.max_price.trim() : '';
    const maxPricePaise = maxPriceRaw ? Number(maxPriceRaw) : undefined;
    const quickOnly = req.query.quick === 'true' || req.query.quick === '1';
    const pinCode = typeof req.query.pin_code === 'string' ? req.query.pin_code.trim() : undefined;

    // 1. OpenSearch returns candidate offer_ids ONLY (never authoritative price/stock/quick)
    const osResult = await searchOffers({
      q: q || undefined,
      category: category || undefined,
      maxPricePaise: Number.isFinite(maxPricePaise) ? maxPricePaise : undefined,
      city: city || undefined,
      limit: 150,
    });

    // 2. PostgreSQL authoritative recheck + re-apply category, max_price, city, AND live quick filter!
    const results: Array<Record<string, unknown>> = [];
    const seenOffers = new Set<string>();

    for (const hit of osResult.hits) {
      if (seenOffers.has(hit.offer_id)) continue;
      seenOffers.add(hit.offer_id);

      const comp = store.buildOfferForComparison(hit.offer_id);
      if (!comp || comp.status !== 'active' || comp.sellable_free_units <= 0) continue;

      const product = store.products.find((p) => p.product_id === comp.product_id);
      const cat = product ? store.categories.find((c) => c.category_id === product.category_id) : null;
      if (!product || !cat) continue;

      // Re-apply filters against live PostgreSQL truth (stale index can never leak outside filter)
      if (category && cat.category_name.toLowerCase() !== category.toLowerCase()) continue;
      if (city && comp.dealer_city.toLowerCase() !== city.toLowerCase()) continue;
      if (
        typeof maxPricePaise === 'number' &&
        Number.isFinite(maxPricePaise) &&
        comp.selling_price > maxPricePaise
      ) {
        continue;
      }

      // Compute Quick eligibility strictly from live PostgreSQL truth (NEVER indexed in OpenSearch)
      const quickInfo = computeOfferQuickEligibility(comp.offer_id, pinCode);
      if (quickOnly && !quickInfo.quick_available) continue;

      const productOffersCount = store.dealer_offers.filter(
        (o) => o.product_id === product.product_id && o.status === 'active'
      ).length;

      results.push({
        offer_id: comp.offer_id,
        product_id: product.product_id,
        product_name: product.name,
        brand: product.brand,
        category_name: cat.category_name,
        dealer_id: comp.dealer_id,
        shop_name: comp.shop_name,
        dealer_city: comp.dealer_city,
        dealer_state: comp.dealer_state,
        dealer_rating: comp.dealer_rating,
        total_reviews: comp.total_reviews,
        selling_price: comp.selling_price,
        available_units: comp.sellable_free_units,
        home_units: comp.home_free_units,
        hub_units: comp.hub_free_units,
        quick_available: quickInfo.quick_available,
        default_location_id: comp.default_location_id,
        default_location_name: comp.default_location_name,
        default_location_type: comp.default_location_type,
        dealer_count: productOffersCount,
        eligible_modes: comp.eligible_modes,
        bangalore_delivery_days: comp.bangalore_delivery_days,
        transfer_days_max: comp.transfer_days_max,
        warranty_months: comp.warranty_months,
        specs: product.specs,
        score: hit.score,
      });
    }

    res.json({
      query: { q, category, max_price: maxPricePaise ?? null, city, quick: quickOnly },
      total: results.length,
      results,
      source: envConfig.isOpenSearchConfigured
        ? 'opensearch_candidates_pg_rechecked'
        : 'local_fuzzy_index_pg_rechecked',
    });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.get('/products', optionalAuth, (req: Request, res: Response) => {
  const categoryParam = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const pinCode = typeof req.query.pin_code === 'string' ? req.query.pin_code.trim() : undefined;

  let filtered = store.products;
  if (categoryParam) {
    const matchedCat = store.categories.find(
      (c) =>
        c.category_id === categoryParam ||
        c.category_name.toLowerCase() === categoryParam.toLowerCase()
    );
    if (matchedCat) {
      filtered = filtered.filter((p) => p.category_id === matchedCat.category_id);
    } else {
      filtered = [];
    }
  }

  const items = filtered
    .map((p) => buildProductSummary(p.product_id, pinCode))
    .filter((p) => p !== null);

  res.json({
    categories: store.categories,
    dealers: store.dealers.map((d) => ({
      dealer_id: d.dealer_id,
      shop_name: d.shop_name,
      city: d.city,
      state: d.state,
      dealer_rating: d.dealer_rating,
      total_reviews: d.total_reviews,
    })),
    products: items,
  });
});

apiRouter.get('/products/compare', optionalAuth, (req: Request, res: Response) => {
  if (!isFeatureEnabled('FEATURE_COMPARE')) {
    res.status(404).json({ error: 'FEATURE_DISABLED', message: 'Side-by-side comparison is disabled.' });
    return;
  }
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const products = ids
    .map((id) => buildProductSummary(id))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const specKeys = Array.from(
    new Set(products.flatMap((p) => Object.keys(p.specs || {})))
  ).sort();

  res.json({ products, spec_keys: specKeys });
});

apiRouter.get('/products/:id', optionalAuth, (req: Request, res: Response) => {
  const summary = buildProductSummary(req.params.id);
  if (!summary) {
    res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found.' });
    return;
  }

  // Record recently viewed (capped at 8 per customer)
  if (req.user) {
    const now = new Date().toISOString();
    const existing = store.recently_viewed.find(
      (r) => r.user_id === req.user!.user_id && r.product_id === summary.product_id
    );
    if (existing) {
      existing.viewed_at = now;
    } else {
      store.recently_viewed.unshift({
        id: crypto.randomUUID(),
        user_id: req.user.user_id,
        product_id: summary.product_id,
        viewed_at: now,
      });
      const userEntries = store.recently_viewed
        .filter((r) => r.user_id === req.user!.user_id)
        .sort((a, b) => b.viewed_at.localeCompare(a.viewed_at));
      if (userEntries.length > 8) {
        const dropIds = new Set(userEntries.slice(8).map((e) => e.id));
        store.recently_viewed = store.recently_viewed.filter((r) => !dropIds.has(r.id));
      }
    }
  }

  const offers = store.dealer_offers
    .filter((o) => o.product_id === summary.product_id && o.status === 'active')
    .map((o) => {
      const comp = store.buildOfferForComparison(o.offer_id);
      if (!comp) return null;
      const quick = computeOfferQuickEligibility(o.offer_id);
      return {
        ...comp,
        effective_days: computeEffectiveDays(comp),
        quick_available: quick.quick_available,
        hub_id: quick.hub_id,
      };
    })
    .filter((o) => o !== null);

  res.json({ product: summary, offers });
});

apiRouter.get('/products/:id/offers', optionalAuth, (req: Request, res: Response) => {
  const product = store.products.find((p) => p.product_id === req.params.id);
  if (!product) {
    res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found.' });
    return;
  }
  const catParam = String(req.query.category || 'budget').toLowerCase();
  const validCategories: ComparisonCategory[] = ['budget', 'fastest', 'rated', 'value', 'available'];
  if (!validCategories.includes(catParam as ComparisonCategory)) {
    res.status(400).json({
      error: 'INVALID_COMPARISON_CATEGORY',
      message: 'Category must be one of: budget, fastest, rated, value, available.',
    });
    return;
  }

  const rawOffers = store.dealer_offers
    .filter((o) => o.product_id === product.product_id)
    .map((o) => store.buildOfferForComparison(o.offer_id))
    .filter((o): o is OfferForComparison => o !== null);

  const ranked = rankOffersByCategory(rawOffers, catParam as ComparisonCategory).map((o) => ({
    ...o,
    quick_available: computeOfferQuickEligibility(o.offer_id).quick_available,
  }));

  res.json({
    product_id: product.product_id,
    product_name: product.name,
    category: catParam,
    winner: ranked[0] ?? null,
    offers: ranked,
  });
});

apiRouter.get('/products/:id/price-history', optionalAuth, (req: Request, res: Response) => {
  const product = store.products.find((p) => p.product_id === req.params.id);
  if (!product) {
    res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found.' });
    return;
  }

  const offers = store.dealer_offers.filter((o) => o.product_id === product.product_id && o.status === 'active');
  const offerIds = new Set(offers.map((o) => o.offer_id));
  const currentLowest = offers.length > 0 ? Math.min(...offers.map((o) => o.selling_price)) : null;

  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // v7.2: 30-day reference price = lowest selling_price in the 30 days BEFORE the current period (excluding open valid_to IS NULL rows)
  const closedRows = store.offer_price_history.filter(
    (h) =>
      offerIds.has(h.offer_id) &&
      h.valid_to !== null &&
      new Date(h.valid_to).getTime() >= cutoff30d
  );

  const referencePricePaise =
    closedRows.length > 0 ? Math.min(...closedRows.map((r) => r.selling_price)) : null;

  const showWasPrice =
    referencePricePaise !== null && currentLowest !== null && referencePricePaise > currentLowest;

  res.json({
    product_id: product.product_id,
    sample_label: 'SAMPLE PRICE HISTORY (seeded demo reference, not live market data)',
    current_lowest_paise: currentLowest,
    reference_30d_paise: referencePricePaise,
    show_was_price: showWasPrice,
    history: store.offer_price_history
      .filter((h) => offerIds.has(h.offer_id))
      .sort((a, b) => a.valid_from.localeCompare(b.valid_from)),
  });
});

apiRouter.get('/products/:id/related', optionalAuth, (req: Request, res: Response) => {
  const product = store.products.find((p) => p.product_id === req.params.id);
  if (!product) {
    res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found.' });
    return;
  }
  const related = store.products
    .filter((p) => p.category_id === product.category_id && p.product_id !== product.product_id)
    .slice(0, 4)
    .map((p) => buildProductSummary(p.product_id))
    .filter(Boolean);

  res.json({ products: related });
});

apiRouter.get('/outside-bangalore', optionalAuth, (_req: Request, res: Response) => {
  // Section A: Outside-Bangalore dealers whose offers have free stock IN Bangalore (faster)
  // Section B: Offers stocked ONLY outside Bangalore (holding location, ~2-3 days transfer)
  const sectionA: Array<Record<string, unknown>> = [];
  const sectionB: Array<Record<string, unknown>> = [];

  for (const offer of store.dealer_offers) {
    if (offer.status !== 'active') continue;
    const dealer = store.dealers.find((d) => d.dealer_id === offer.dealer_id);
    const product = store.products.find((p) => p.product_id === offer.product_id);
    const category = product ? store.categories.find((c) => c.category_id === product.category_id) : null;
    const truth = store.getOfferTruth(offer.offer_id);
    if (!dealer || !product || !category || !truth || truth.free_units <= 0) continue;

    const isOutsideDealer = dealer.city.toLowerCase() !== 'bengaluru';
    const hasBangaloreStock = truth.home_units > 0 || truth.hub_units > 0;
    const hasHoldingStock = truth.holding_units > 0;

    if (isOutsideDealer && hasBangaloreStock) {
      sectionA.push({
        offer_id: offer.offer_id,
        product_id: product.product_id,
        product_name: product.name,
        brand: product.brand,
        category_name: category.category_name,
        dealer_id: dealer.dealer_id,
        shop_name: dealer.shop_name,
        dealer_city: dealer.city,
        dealer_state: dealer.state,
        dealer_rating: dealer.dealer_rating,
        total_reviews: dealer.total_reviews,
        selling_price: offer.selling_price,
        available_units: truth.home_units + truth.hub_units,
        location_id: store.getHomeWarehouse().location_id,
        fulfilment_note: 'In Bangalore stock (faster delivery, 1–2 days)',
        bangalore_delivery_days: offer.bangalore_delivery_days ?? 2,
      });
    } else if (!hasBangaloreStock && hasHoldingStock) {
      const holdingInv = store.inventory.find((i) => {
        if (i.offer_id !== offer.offer_id) return false;
        const loc = store.stock_locations.find((l) => l.location_id === i.location_id);
        return loc?.location_type === 'holding' && i.quantity - i.reserved_quantity > 0;
      });
      const holdingLoc = holdingInv
        ? store.stock_locations.find((l) => l.location_id === holdingInv.location_id)
        : null;

      sectionB.push({
        offer_id: offer.offer_id,
        product_id: product.product_id,
        product_name: product.name,
        brand: product.brand,
        category_name: category.category_name,
        dealer_id: dealer.dealer_id,
        shop_name: dealer.shop_name,
        dealer_city: dealer.city,
        dealer_state: dealer.state,
        dealer_rating: dealer.dealer_rating,
        total_reviews: dealer.total_reviews,
        selling_price: offer.selling_price,
        available_units: truth.holding_units,
        location_id: holdingLoc?.location_id ?? truth.default_location.location_id,
        holding_city: holdingLoc?.city ?? dealer.city,
        holding_location_name: holdingLoc?.name ?? 'Regional Holding Depot',
        transfer_days_min: offer.transfer_days_min ?? 2,
        transfer_days_max: offer.transfer_days_max ?? 3,
        fulfilment_note: `Moved from ${holdingLoc?.city ?? dealer.city} stock location (~${offer.transfer_days_min ?? 2}–${offer.transfer_days_max ?? 3} days transfer)`,
      });
    }
  }

  res.json({
    section_a_title: 'In Bangalore stock (faster)',
    section_b_title: 'Moved from another stock location (~2-3 days)',
    section_a: sectionA,
    section_b: sectionB,
  });
});

// ============================================================
// CART & ATOMIC RESERVATIONS
// ============================================================

const addCartItemSchema = z.object({
  cart_item_id: z.string().uuid().optional(),
  offer_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

apiRouter.post('/cart/items', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = addCartItemSchema.parse(req.body);
    const offer = store.dealer_offers.find((o) => o.offer_id === body.offer_id && o.status === 'active');
    if (!offer) {
      throw new DomainError(404, 'OFFER_NOT_FOUND', 'Selected dealer offer is no longer active.');
    }

    const cart = getOrCreateCart(req.user!.user_id);

    const item = store.runAtomic(() => {
      if (body.cart_item_id) {
        const existing = store.cart_items.find(
          (ci) => ci.cart_item_id === body.cart_item_id && ci.cart_id === cart.cart_id
        );
        if (!existing) throw new DomainError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found.');
        // If quantity changed and an active reservation was attached, release old hold first
        if (existing.reservation_id && existing.quantity !== body.quantity) {
          const prevRes = store.reservations.find(
            (r) => r.reservation_id === existing.reservation_id && r.status === 'reserved'
          );
          if (prevRes) {
            prevRes.status = 'released';
            store.releaseHold(prevRes.offer_id, prevRes.location_id, prevRes.quantity);
            store.enqueueOutbox('inventory-updated', prevRes.offer_id, {
              offer_id: prevRes.offer_id,
              reason: 'cart_qty_updated',
            });
          }
          existing.reservation_id = null;
        }
        existing.quantity = body.quantity;
        existing.price_snapshot = offer.selling_price;
        return existing;
      }

      const existingSame = store.cart_items.find(
        (ci) => ci.cart_id === cart.cart_id && ci.offer_id === body.offer_id && !ci.saved_for_later
      );
      if (existingSame) {
        if (existingSame.reservation_id) {
          const prevRes = store.reservations.find(
            (r) => r.reservation_id === existingSame.reservation_id && r.status === 'reserved'
          );
          if (prevRes) {
            prevRes.status = 'released';
            store.releaseHold(prevRes.offer_id, prevRes.location_id, prevRes.quantity);
            store.enqueueOutbox('inventory-updated', prevRes.offer_id, {
              offer_id: prevRes.offer_id,
              reason: 'cart_qty_merged',
            });
          }
          existingSame.reservation_id = null;
        }
        existingSame.quantity += body.quantity;
        existingSame.price_snapshot = offer.selling_price;
        return existingSame;
      }

      const created = {
        cart_item_id: crypto.randomUUID(),
        cart_id: cart.cart_id,
        offer_id: offer.offer_id,
        quantity: body.quantity,
        price_snapshot: offer.selling_price,
        reservation_id: null,
        saved_for_later: false,
      };
      store.cart_items.push(created);
      return created;
    });

    await flushOutbox();
    res.status(201).json({ cart_item: item });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.get('/cart', requireAuth, async (req: Request, res: Response) => {
  await runReservationExpiryCleanup();
  const cart = getOrCreateCart(req.user!.user_id);

  const enrich = (ci: (typeof store.cart_items)[number]) => {
    const offer = store.dealer_offers.find((o) => o.offer_id === ci.offer_id);
    const product = offer ? store.products.find((p) => p.product_id === offer.product_id) : null;
    const category = product ? store.categories.find((c) => c.category_id === product.category_id) : null;
    const dealer = offer ? store.dealers.find((d) => d.dealer_id === offer.dealer_id) : null;
    const truth = offer ? store.getOfferTruth(offer.offer_id) : null;
    const reservation = ci.reservation_id
      ? store.reservations.find((r) => r.reservation_id === ci.reservation_id)
      : null;

    const currentPrice = offer?.selling_price ?? ci.price_snapshot;
    const priceChanged = currentPrice !== ci.price_snapshot;
    const quick = offer ? computeOfferQuickEligibility(offer.offer_id) : { quick_available: false, hub_location_id: null };

    // Determine available stock locations for this offer
    const locations = store.inventory
      .filter((i) => i.offer_id === ci.offer_id)
      .map((i) => {
        const loc = store.stock_locations.find((l) => l.location_id === i.location_id);
        const hub = store.fulfilment_hubs.find((h) => h.location_id === i.location_id);
        return {
          location_id: i.location_id,
          name: loc?.name ?? 'Unknown',
          city: loc?.city ?? '',
          location_type: loc?.location_type ?? 'warehouse',
          is_home: loc?.is_home ?? false,
          is_sellable: loc?.is_sellable ?? false,
          hub_active: hub ? hub.active : true,
          free_units: Math.max(0, i.quantity - i.reserved_quantity),
        };
      })
      .filter((l) => l.is_sellable && l.hub_active);

    return {
      cart_item_id: ci.cart_item_id,
      offer_id: ci.offer_id,
      product_id: product?.product_id ?? '',
      product_name: product?.name ?? 'Unknown Product',
      brand: product?.brand ?? '',
      category_name: category?.category_name ?? 'Audio & Speakers',
      dealer_id: dealer?.dealer_id ?? '',
      shop_name: dealer?.shop_name ?? 'Unknown Dealer',
      dealer_city: dealer?.city ?? '',
      quantity: ci.quantity,
      price_snapshot: ci.price_snapshot,
      current_price_paise: currentPrice,
      price_changed: priceChanged,
      line_total_paise: currentPrice * ci.quantity,
      available_units: truth?.free_units ?? 0,
      default_location_id: truth?.default_location.location_id ?? null,
      default_location_type: truth?.default_location.location_type ?? 'warehouse',
      eligible_modes: offer?.eligible_modes ?? ['standard'],
      quick_available: quick.quick_available,
      locations,
      saved_for_later: ci.saved_for_later,
      reservation: reservation
        ? {
            reservation_id: reservation.reservation_id,
            status: reservation.status,
            expires_at: reservation.expires_at,
            price_paise: reservation.price_paise,
            location_id: reservation.location_id,
            quantity: reservation.quantity,
          }
        : null,
    };
  };

  const allItems = store.cart_items.filter((ci) => ci.cart_id === cart.cart_id).map(enrich);
  const items = allItems.filter((i) => !i.saved_for_later);
  const saved_items = allItems.filter((i) => i.saved_for_later);
  const subtotal_paise = items.reduce((acc, i) => acc + i.line_total_paise, 0);

  res.json({
    cart_id: cart.cart_id,
    items,
    saved_items,
    subtotal_paise,
  });
});

apiRouter.delete('/cart/items/:cartItemId', requireAuth, async (req: Request, res: Response) => {
  try {
    const cart = getOrCreateCart(req.user!.user_id);
    const result = store.runAtomic(() => {
      const idx = store.cart_items.findIndex(
        (ci) => ci.cart_item_id === req.params.cartItemId && ci.cart_id === cart.cart_id
      );
      if (idx === -1) {
        throw new DomainError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found.');
      }
      const item = store.cart_items[idx];
      let releasedReservationId: string | null = null;

      if (item.reservation_id) {
        const resRow = store.reservations.find(
          (r) => r.reservation_id === item.reservation_id && r.user_id === req.user!.user_id
        );
        if (resRow && resRow.status === 'reserved') {
          resRow.status = 'released';
          store.releaseHold(resRow.offer_id, resRow.location_id, resRow.quantity);
          store.enqueueOutbox('inventory-updated', resRow.offer_id, {
            offer_id: resRow.offer_id,
            reason: 'cart_item_deleted',
          });
          releasedReservationId = resRow.reservation_id;
        }
      }
      store.cart_items.splice(idx, 1);
      return { deleted: true, released_reservation_id: releasedReservationId };
    });

    await flushOutbox();
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/cart/items/:id/save-for-later', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isFeatureEnabled('FEATURE_SAVE_LATER')) {
      throw new DomainError(404, 'FEATURE_DISABLED', 'Save for later is disabled.');
    }
    const cart = getOrCreateCart(req.user!.user_id);
    store.runAtomic(() => {
      const ci = store.cart_items.find(
        (x) => x.cart_item_id === req.params.id && x.cart_id === cart.cart_id
      );
      if (!ci) throw new DomainError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found.');
      if (ci.reservation_id) {
        const resRow = store.reservations.find(
          (r) => r.reservation_id === ci.reservation_id && r.status === 'reserved'
        );
        if (resRow) {
          resRow.status = 'released';
          store.releaseHold(resRow.offer_id, resRow.location_id, resRow.quantity);
          store.enqueueOutbox('inventory-updated', resRow.offer_id, {
            offer_id: resRow.offer_id,
            reason: 'saved_for_later',
          });
        }
        ci.reservation_id = null;
      }
      ci.saved_for_later = true;
    });
    await flushOutbox();
    res.json({ saved: true });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/cart/items/:id/restore', requireAuth, (req: Request, res: Response) => {
  try {
    if (!isFeatureEnabled('FEATURE_SAVE_LATER')) {
      throw new DomainError(404, 'FEATURE_DISABLED', 'Save for later is disabled.');
    }
    const cart = getOrCreateCart(req.user!.user_id);
    const ci = store.cart_items.find(
      (x) => x.cart_item_id === req.params.id && x.cart_id === cart.cart_id
    );
    if (!ci) throw new DomainError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found.');
    const offer = store.dealer_offers.find((o) => o.offer_id === ci.offer_id);
    const truth = offer ? store.getOfferTruth(offer.offer_id) : null;
    const oldPrice = ci.price_snapshot;
    const newPrice = offer?.selling_price ?? oldPrice;
    ci.saved_for_later = false;
    ci.price_snapshot = newPrice;

    res.json({
      restored: true,
      price_changed: oldPrice !== newPrice,
      old_price_paise: oldPrice,
      new_price_paise: newPrice,
      available_units: truth?.free_units ?? 0,
    });
  } catch (err) {
    sendError(res, err);
  }
});

const reserveSchema = z.object({
  cart_item_id: z.string().uuid().optional(),
  offer_id: z.string().uuid(),
  location_id: z.string().uuid().optional(),
  quantity: z.number().int().min(1),
  request_key: z.string().min(1),
});

apiRouter.post('/cart/reserve', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = reserveSchema.parse(req.body);
    const userId = req.user!.user_id;

    const reservation = store.runAtomic(() => {
      // Idempotent retry on (user_id, request_key)
      const existing = store.reservations.find(
        (r) => r.user_id === userId && r.request_key === body.request_key
      );
      if (existing) {
        return existing;
      }

      const offer = store.dealer_offers.find((o) => o.offer_id === body.offer_id && o.status === 'active');
      if (!offer) {
        throw new DomainError(404, 'OFFER_NOT_FOUND', 'Dealer offer not found or inactive.');
      }

      const truth = store.getOfferTruth(offer.offer_id);
      let targetLocId = body.location_id || truth?.default_location.location_id;

      // Bangalore-first fallback (v7.2): if requested location has no free units but is_home does, reserve at is_home
      if (targetLocId) {
        const reqLoc = store.stock_locations.find((l) => l.location_id === targetLocId);
        const reqInv = store.inventory.find(
          (i) => i.offer_id === offer.offer_id && i.location_id === targetLocId
        );
        const reqFree = reqLoc?.is_sellable && reqInv ? reqInv.quantity - reqInv.reserved_quantity : 0;
        if (reqFree < body.quantity) {
          const home = store.getHomeWarehouse();
          const homeInv = store.inventory.find(
            (i) => i.offer_id === offer.offer_id && i.location_id === home.location_id
          );
          if (homeInv && homeInv.quantity - homeInv.reserved_quantity >= body.quantity) {
            targetLocId = home.location_id;
          }
        }
      }

      if (!targetLocId) {
        throw new DomainError(409, 'OUT_OF_STOCK', 'Sorry, this offer is no longer available.');
      }

      // Guarded atomic holdUnits
      store.holdUnits(offer.offer_id, targetLocId, body.quantity);

      const created = {
        reservation_id: crypto.randomUUID(),
        offer_id: offer.offer_id,
        location_id: targetLocId,
        user_id: userId,
        quantity: body.quantity,
        price_paise: offer.selling_price, // authoritative price
        status: 'reserved' as const,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        request_key: body.request_key,
      };
      store.reservations.push(created);

      if (body.cart_item_id) {
        const cart = getOrCreateCart(userId);
        const ci = store.cart_items.find(
          (c) => c.cart_item_id === body.cart_item_id && c.cart_id === cart.cart_id
        );
        if (ci) {
          ci.reservation_id = created.reservation_id;
          ci.price_snapshot = offer.selling_price;
        }
      }

      store.enqueueOutbox('inventory-updated', offer.offer_id, {
        offer_id: offer.offer_id,
        location_id: targetLocId,
        reason: 'reserved',
      });

      return created;
    });

    await flushOutbox();

    res.status(201).json({
      reservation_id: reservation.reservation_id,
      status: reservation.status,
      expires_at: reservation.expires_at,
      price_paise: reservation.price_paise,
      location_id: reservation.location_id,
    });
  } catch (err) {
    sendError(res, err);
  }
});

const releaseSchema = z.object({
  reservation_id: z.string().uuid(),
});

apiRouter.post('/cart/release', requireAuth, async (req: Request, res: Response) => {
  try {
    const { reservation_id } = releaseSchema.parse(req.body);
    const userId = req.user!.user_id;

    const result = store.runAtomic(() => {
      const resRow = store.reservations.find(
        (r) => r.reservation_id === reservation_id && r.user_id === userId
      );
      if (!resRow) {
        throw new DomainError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found.');
      }

      if (resRow.status === 'reserved') {
        resRow.status = 'released';
        store.releaseHold(resRow.offer_id, resRow.location_id, resRow.quantity);
        store.enqueueOutbox('inventory-updated', resRow.offer_id, {
          offer_id: resRow.offer_id,
          location_id: resRow.location_id,
          reason: 'released',
        });
        for (const ci of store.cart_items) {
          if (ci.reservation_id === resRow.reservation_id) {
            ci.reservation_id = null;
          }
        }
        return { reservation_id: resRow.reservation_id, status: 'released' };
      }

      if (resRow.status === 'released' || resRow.status === 'expired') {
        // Idempotent 200, NO movement
        return { reservation_id: resRow.reservation_id, status: resRow.status };
      }

      // confirmed -> 409 CANNOT_RELEASE_CONFIRMED
      throw new DomainError(
        409,
        'CANNOT_RELEASE_CONFIRMED',
        'Confirmed reservations cannot be released from cart; use order cancellation instead.'
      );
    });

    await flushOutbox();
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// ============================================================
// PIN CHECK & HYBRID FULFILMENT ORDER PLACEMENT
// ============================================================

const checkPinSchema = z.object({
  pin_code: z.string().regex(/^\d{6}$/, 'PIN code must be a 6-digit Indian postal code'),
});

apiRouter.post('/check-pin', optionalAuth, (req: Request, res: Response) => {
  try {
    const { pin_code } = checkPinSchema.parse(req.body);
    const area = store.hub_service_areas.find((a) => a.pin_code === pin_code);
    const hub = area ? store.fulfilment_hubs.find((h) => h.hub_id === area.hub_id) : null;

    if (!hub) {
      res.json({
        pin_code,
        quick_available: false,
        standard_available: true,
        hub_id: null,
        hub_location_id: null,
        hub_name: null,
        reason: 'Quick delivery is currently unavailable for this PIN code. Standard and Transfer delivery are available.',
        sample_fees: {
          quick_paise: FEE_QUICK_PAISE,
          standard_paise: FEE_STANDARD_PAISE,
          transfer_paise: FEE_TRANSFER_PAISE,
          free_standard_threshold_paise: FREE_STANDARD_THRESHOLD_PAISE,
        },
      });
      return;
    }

    const hoursOk = isWithinHubHours(hub.hours);
    const usedToday = store.getQuickGroupsCountToday(hub.location_id);
    const capacityOk = usedToday < hub.order_capacity;
    const quickAvailable = hub.active && hoursOk && capacityOk;
    const hubLoc = store.stock_locations.find((l) => l.location_id === hub.location_id);
    const pickingQueue = store.getPickingQueueCount(hub.location_id);
    const quickEta = quickAvailable
      ? computeEtaWindow({ mode: 'quick', pickingQueue })
      : null;

    res.json({
      pin_code,
      quick_available: quickAvailable,
      standard_available: true,
      hub_id: hub.hub_id,
      hub_location_id: hub.location_id,
      hub_name: hubLoc?.name ?? 'Bengaluru Quick Hub',
      hub_active: hub.active,
      remaining_capacity: Math.max(0, hub.order_capacity - usedToday),
      quick_eta: quickEta,
      standard_eta: computeEtaWindow({ mode: 'standard' }),
      transfer_eta: computeEtaWindow({ mode: 'transfer', transferDaysMax: 3 }),
      reason: quickAvailable
        ? `Quick delivery available from ${hubLoc?.name ?? 'local hub'} (${quickEta?.eta_basis.label}).`
        : !hub.active
          ? 'Quick hub is currently paused; Standard delivery remains available.'
          : 'Quick hub is outside operating hours or at daily capacity; Standard delivery remains available.',
      sample_fees: {
        quick_paise: FEE_QUICK_PAISE,
        standard_paise: FEE_STANDARD_PAISE,
        transfer_paise: FEE_TRANSFER_PAISE,
        free_standard_threshold_paise: FREE_STANDARD_THRESHOLD_PAISE,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

const placeOrderSchema = z.object({
  reservation_ids: z.array(z.string().uuid()).min(1),
  address: z.object({
    pin_code: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
    recipient_name: z.string().optional(),
    line1: z.string().optional(),
    city: z.string().optional(),
  }),
  mode_preferences: z.record(z.string(), z.enum(['quick', 'standard'])).optional(),
  coupon_code: z.string().optional(),
});

apiRouter.post('/orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = placeOrderSchema.parse(req.body);
    const userId = req.user!.user_id;
    const now = new Date();
    const nowMs = now.getTime();

    const orderResult = store.runAtomic(() => {
      // STEP a: confirm ALL requested reservations belonging to $jwt where status='reserved' and expires_at > now()
      const uniqueIds = Array.from(new Set(body.reservation_ids));
      const matched = uniqueIds
        .map((rid) =>
          store.reservations.find(
            (r) =>
              r.reservation_id === rid &&
              r.user_id === userId &&
              r.status === 'reserved' &&
              new Date(r.expires_at).getTime() > nowMs
          )
        )
        .filter((r): r is NonNullable<typeof r> => Boolean(r));

      if (matched.length !== uniqueIds.length) {
        throw new DomainError(
          409,
          'RESERVATION_EXPIRED',
          'Your reservation has expired or is no longer active. Please reserve the item again.'
        );
      }

      // STEP b: PRICE CHECK against reservations.price_paise (NEVER cart_items.price_snapshot)
      const priceMismatches: Array<{
        reservation_id: string;
        offer_id: string;
        reserved_price_paise: number;
        current_price_paise: number;
      }> = [];

      for (const r of matched) {
        const offer = store.dealer_offers.find((o) => o.offer_id === r.offer_id);
        if (!offer || offer.status !== 'active') {
          throw new DomainError(409, 'OFFER_UNAVAILABLE', 'One of the reserved offers is no longer active.');
        }
        if (offer.selling_price !== r.price_paise) {
          priceMismatches.push({
            reservation_id: r.reservation_id,
            offer_id: r.offer_id,
            reserved_price_paise: r.price_paise,
            current_price_paise: offer.selling_price,
          });
        }
      }

      if (priceMismatches.length > 0) {
        // Rollback leaves reservations 'reserved' so client can release -> re-reserve -> retry!
        throw new DomainError(
          409,
          'PRICE_CHANGED',
          'The price has changed. Please review the updated amount and retry.',
          { reservations: priceMismatches }
        );
      }

      // Mark reservations confirmed
      for (const r of matched) {
        r.status = 'confirmed';
      }

      // STEP 1-4: Locked delivery mode derivation
      const area = store.hub_service_areas.find((a) => a.pin_code === body.address.pin_code);
      const hub = area
        ? store.fulfilment_hubs.find((h) => h.hub_id === area.hub_id && h.active)
        : null;

      interface PreparedLine {
        order_item_id: string;
        reservation: (typeof matched)[number];
        offer: (typeof store.dealer_offers)[number];
        location: (typeof store.stock_locations)[number];
        mode: FulfilmentMode;
        line_price: number;
      }

      const prepared: PreparedLine[] = [];

      for (const r of matched) {
        const offer = store.dealer_offers.find((o) => o.offer_id === r.offer_id)!;
        const loc = store.stock_locations.find((l) => l.location_id === r.location_id);
        if (!loc || loc.location_type === 'quarantine' || !loc.is_sellable) {
          throw new DomainError(409, 'LOCATION_NOT_SELLABLE', 'Selected stock location is not sellable.');
        }

        const pref = body.mode_preferences?.[r.reservation_id];
        let derivedMode: FulfilmentMode;

        if (loc.location_type === 'hub') {
          const canQuick =
            Boolean(hub) &&
            hub!.location_id === r.location_id &&
            isWithinHubHours(hub!.hours, now) &&
            store.getQuickGroupsCountToday(hub!.location_id) < hub!.order_capacity &&
            offer.eligible_modes.includes('quick');

          if (pref === 'standard') {
            // Customer downgrade from quick -> standard is ALLOWED
            derivedMode = 'standard';
          } else if (pref === 'quick') {
            if (!canQuick) {
              throw new DomainError(
                409,
                'QUICK_NOT_AVAILABLE',
                'Quick delivery is currently unavailable for this PIN code or hub.'
              );
            }
            derivedMode = 'quick';
          } else {
            derivedMode = canQuick ? 'quick' : 'standard';
          }
        } else if (loc.is_home) {
          if (pref === 'quick') {
            throw new DomainError(
              409,
              'QUICK_NOT_AVAILABLE',
              'Quick delivery cannot be requested for warehouse-stocked items.'
            );
          }
          derivedMode = 'standard';
        } else if (loc.location_type === 'holding') {
          if (pref === 'quick') {
            throw new DomainError(
              409,
              'QUICK_NOT_AVAILABLE',
              'Quick delivery cannot be requested for regional transfer items.'
            );
          }
          derivedMode = 'transfer';
        } else {
          throw new DomainError(409, 'LOCATION_NOT_SELLABLE', 'Location is not sellable.');
        }

        prepared.push({
          order_item_id: crypto.randomUUID(),
          reservation: r,
          offer,
          location: loc,
          mode: derivedMode,
          line_price: r.price_paise * r.quantity,
        });
      }

      const itemsTotal = prepared.reduce((acc, l) => acc + l.line_price, 0);

      // Optional atomic coupon redemption (FEATURE_COUPONS)
      let discountTotal = 0;
      let appliedCouponCode: string | null = null;
      const orderId = crypto.randomUUID();

      if (body.coupon_code && body.coupon_code.trim()) {
        if (!isFeatureEnabled('FEATURE_COUPONS')) {
          throw new DomainError(400, 'FEATURE_DISABLED', 'Coupons feature is currently disabled.');
        }
        const codeUpper = body.coupon_code.trim().toUpperCase();
        const coupon = store.coupons.find((c) => c.code.toUpperCase() === codeUpper && c.active);
        if (!coupon) {
          throw new DomainError(400, 'INVALID_COUPON', 'Coupon code is invalid or inactive.');
        }
        if (nowMs < new Date(coupon.valid_from).getTime() || nowMs > new Date(coupon.valid_to).getTime()) {
          throw new DomainError(400, 'COUPON_EXPIRED', 'Coupon is outside its validity window.');
        }
        if (itemsTotal < coupon.min_basket_paise) {
          throw new DomainError(
            400,
            'MIN_BASKET_NOT_MET',
            `Minimum basket of Rs.${(coupon.min_basket_paise / 100).toFixed(0)} required for ${coupon.code}.`
          );
        }

        // Per-customer conditional UPSERT check
        const usageKey = `${coupon.coupon_id}:${userId}`;
        const usedByCustomer = store.coupon_customer_usage.get(usageKey) ?? 0;
        if (usedByCustomer >= coupon.per_customer_limit) {
          throw new DomainError(
            409,
            'PER_CUSTOMER_LIMIT_REACHED',
            `You have already reached the per-customer usage limit for ${coupon.code}.`
          );
        }

        // Global conditional UPDATE check
        if (coupon.max_redemptions !== null && coupon.redeemed_count >= coupon.max_redemptions) {
          throw new DomainError(
            409,
            'COUPON_LIMIT_REACHED',
            `Coupon ${coupon.code} has reached its maximum global redemption limit.`
          );
        }

        store.coupon_customer_usage.set(usageKey, usedByCustomer + 1);
        coupon.redeemed_count += 1;
        store.coupon_redemptions.push({
          redemption_id: crypto.randomUUID(),
          coupon_id: coupon.coupon_id,
          user_id: userId,
          order_id: orderId,
          redeemed_at: now.toISOString(),
        });

        discountTotal =
          coupon.kind === 'fixed_paise'
            ? Math.min(coupon.value, itemsTotal)
            : Math.min(Math.floor((itemsTotal * coupon.value) / 100), itemsTotal);
        appliedCouponCode = coupon.code;
      }

      // STEP 5: Group by (location_id, mode)
      const groupsMap = new Map<string, PreparedLine[]>();
      for (const line of prepared) {
        const key = `${line.location.location_id}::${line.mode}`;
        const arr = groupsMap.get(key) ?? [];
        arr.push(line);
        groupsMap.set(key, arr);
      }

      // Global discount allocation across ALL order lines
      const discountShares = allocateProportional(
        discountTotal,
        prepared.map((l) => ({ id: l.order_item_id, weightPaise: l.line_price }))
      );

      let deliveryFeeTotal = 0;
      const createdGroups: Array<{
        group_id: string;
        mode: FulfilmentMode;
        location_id: string;
        location_name: string;
        status: string;
        fee_total: number;
        eta_window_start: string;
        eta_window_end: string;
        eta_basis: Record<string, unknown>;
      }> = [];

      const createdOrderItems: typeof store.order_items = [];

      for (const [, lines] of groupsMap.entries()) {
        const first = lines[0];
        const groupId = crypto.randomUUID();
        const groupItemsTotal = lines.reduce((acc, l) => acc + l.line_price, 0);
        const groupFee = computeGroupFee(first.mode, groupItemsTotal);
        deliveryFeeTotal += groupFee;

        const maxTransferDays = Math.max(
          ...lines.map((l) => l.offer.transfer_days_max ?? 3)
        );
        const pickingQueue =
          first.mode === 'quick' ? store.getPickingQueueCount(first.location.location_id) : 0;
        const eta = computeEtaWindow({
          mode: first.mode,
          pickingQueue,
          transferDaysMax: maxTransferDays,
          now,
        });

        // EVERY group gets an otp_hash (quick, standard, AND transfer)
        const otpHash = computeGroupOtpHash(groupId);
        const initialStatus = first.mode === 'transfer' ? 'reserved_at_origin' : 'order_accepted';

        const groupRow = {
          group_id: groupId,
          order_id: orderId,
          location_id: first.location.location_id,
          mode: first.mode,
          status: initialStatus,
          fee_total: groupFee,
          eta_window_start: eta.eta_window_start,
          eta_window_end: eta.eta_window_end,
          eta_basis: eta.eta_basis,
          otp_hash: otpHash,
          created_at: now.toISOString(),
        };
        store.fulfilment_groups.push(groupRow);

        // Allocate group_fee strictly WITHIN THAT GROUP
        const feeShares = allocateProportional(
          groupFee,
          lines.map((l) => ({ id: l.order_item_id, weightPaise: l.line_price }))
        );

        for (const l of lines) {
          const dShare = discountShares.get(l.order_item_id) ?? 0;
          const fShare = feeShares.get(l.order_item_id) ?? 0;
          const itemPaid = l.line_price - dShare;
          const paid = itemPaid + fShare;

          createdOrderItems.push({
            order_item_id: l.order_item_id,
            order_id: orderId,
            group_id: groupId,
            reservation_id: l.reservation.reservation_id,
            offer_id: l.offer.offer_id,
            dealer_id: l.offer.dealer_id,
            quantity: l.reservation.quantity,
            line_price: l.line_price,
            discount_share: dShare,
            delivery_fee_share: fShare,
            item_paid_amount: itemPaid,
            paid_amount: paid,
            item_refunded_amount: 0,
            fee_refunded_amount: 0,
            refunded_amount: 0,
            stock_location_id: l.location.location_id,
            fulfilment_route: l.mode,
            stock_finalised: false,
            promised_delivery_start: eta.eta_window_start,
            promised_delivery_end: eta.eta_window_end,
            delivered_at: null,
            item_status: 'placed',
            cancelled_at: null,
          });
        }

        store.shipment_timeline.push({
          timeline_id: crypto.randomUUID(),
          group_id: groupId,
          status: initialStatus,
          event_type: 'group_created',
          actor: 'checkout',
          note:
            first.mode === 'transfer'
              ? `Reserved at ${first.location.city} origin depot; transfer queued.`
              : `Order accepted for ${first.mode} delivery from ${first.location.name}.`,
          created_at: now.toISOString(),
        });

        createdGroups.push({
          group_id: groupId,
          mode: first.mode,
          location_id: first.location.location_id,
          location_name: first.location.name,
          status: initialStatus,
          fee_total: groupFee,
          eta_window_start: eta.eta_window_start,
          eta_window_end: eta.eta_window_end,
          eta_basis: eta.eta_basis,
        });
      }

      const totalAmount = itemsTotal - discountTotal + deliveryFeeTotal;

      store.orders.push({
        order_id: orderId,
        user_id: userId,
        items_total: itemsTotal,
        discount_total: discountTotal,
        delivery_fee_total: deliveryFeeTotal,
        total_amount: totalAmount,
        coupon_code: appliedCouponCode,
        delivery_pin_code: body.address.pin_code,
        status: 'placed',
        placed_at: now.toISOString(),
      });

      for (const oi of createdOrderItems) {
        store.order_items.push(oi);
      }

      // SIMULATED sandbox payment row (created -> successful)
      store.payments.push({
        payment_id: crypto.randomUUID(),
        order_id: orderId,
        amount: totalAmount,
        method: 'sandbox_upi (SIMULATED)',
        status: 'successful',
        gateway_ref: `SIM-PAY-${orderId.slice(0, 8).toUpperCase()}`,
        idempotency_key: `pay:${orderId}`,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });

      // Clear purchased cart items belonging to these reservations
      const resIdSet = new Set(uniqueIds);
      const cart = store.carts.find((c) => c.user_id === userId);
      if (cart) {
        store.cart_items = store.cart_items.filter(
          (ci) => !(ci.cart_id === cart.cart_id && ci.reservation_id && resIdSet.has(ci.reservation_id))
        );
      }

      // Enqueue transactional outbox event 'order-placed' (key = order_id)
      store.enqueueOutbox('order-placed', orderId, {
        order_id: orderId,
        user_id: userId,
        total_amount: totalAmount,
      });

      return {
        order_id: orderId,
        items_total: itemsTotal,
        discount_total: discountTotal,
        delivery_fee_total: deliveryFeeTotal,
        total_amount: totalAmount,
        coupon_code: appliedCouponCode,
        groups: createdGroups,
      };
    });

    await flushOutbox();

    res.status(201).json(orderResult);
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.get('/orders', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.user_id;
  const userOrders = store.orders
    .filter((o) => req.user!.role === 'admin' || o.user_id === userId)
    .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
    .map((o) => {
      const items = store.order_items.filter((i) => i.order_id === o.order_id);
      const groups = store.fulfilment_groups.filter((g) => g.order_id === o.order_id);
      const payment = store.payments.find((p) => p.order_id === o.order_id);
      return {
        ...o,
        item_count: items.length,
        group_count: groups.length,
        modes: Array.from(new Set(groups.map((g) => g.mode))),
        payment_status: payment?.status ?? 'successful',
        payment_label: 'SIMULATED SANDBOX PAYMENT',
      };
    });

  res.json({ orders: userOrders });
});

apiRouter.get('/orders/:id', requireAuth, (req: Request, res: Response) => {
  const order = store.orders.find((o) => o.order_id === req.params.id);
  if (!order) {
    res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Order not found.' });
    return;
  }
  const isOwner = order.user_id === req.user!.user_id;
  const isAdmin = req.user!.role === 'admin';
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'You cannot access another customer order.' });
    return;
  }

  const payment = store.payments.find((p) => p.order_id === order.order_id);
  const items = store.order_items
    .filter((i) => i.order_id === order.order_id)
    .map((i) => {
      const offer = store.dealer_offers.find((o) => o.offer_id === i.offer_id);
      const product = offer ? store.products.find((p) => p.product_id === offer.product_id) : null;
      const dealer = store.dealers.find((d) => d.dealer_id === i.dealer_id);
      const group = store.fulfilment_groups.find((g) => g.group_id === i.group_id);
      const transfer = store.stock_transfers.find((t) => t.order_item_id === i.order_item_id);
      const refunds = store.refunds.filter((r) => r.order_item_id === i.order_item_id);
      const loc = store.stock_locations.find((l) => l.location_id === i.stock_location_id);

      const cancellable =
        (i.item_status === 'placed' || i.item_status === 'confirmed') &&
        isGroupCancellable(group?.status);

      return {
        ...i,
        product_id: product?.product_id ?? '',
        product_name: product?.name ?? 'Product',
        brand: product?.brand ?? '',
        shop_name: dealer?.shop_name ?? 'Dealer',
        stock_location_name: loc?.name ?? '',
        cancellable,
        transfer: transfer
          ? {
              transfer_id: transfer.transfer_id,
              status: transfer.status,
              cancel_on_receipt: transfer.cancel_on_receipt,
              from_location_name:
                store.stock_locations.find((l) => l.location_id === transfer.from_location_id)?.name ?? '',
              to_location_name:
                store.stock_locations.find((l) => l.location_id === transfer.to_location_id)?.name ?? '',
              requested_at: transfer.requested_at,
              in_transit_at: transfer.in_transit_at,
              received_at: transfer.received_at,
              allocated_at: transfer.allocated_at,
              settled_at: transfer.settled_at,
            }
          : null,
        refunds,
      };
    });

  const groups = store.fulfilment_groups
    .filter((g) => g.order_id === order.order_id)
    .map((g) => {
      const loc = store.stock_locations.find((l) => l.location_id === g.location_id);
      const timeline = store.shipment_timeline
        .filter((t) => t.group_id === g.group_id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const undelivered = g.status !== 'delivered' && g.status !== 'cancelled';

      // v7.1/v7.2: delivery_otp appears ONLY for the OWNING customer while undelivered, labelled SAMPLE DEMO OTP
      return {
        group_id: g.group_id,
        order_id: g.order_id,
        location_id: g.location_id,
        location_name: loc?.name ?? 'Fulfilment Facility',
        location_city: loc?.city ?? 'Bengaluru',
        mode: g.mode,
        status: g.status,
        fee_total: g.fee_total,
        eta_window_start: g.eta_window_start,
        eta_window_end: g.eta_window_end,
        eta_basis: g.eta_basis,
        created_at: g.created_at,
        cancellable: isGroupCancellable(g.status),
        timeline,
        ...(isOwner && undelivered
          ? {
              delivery_otp: deriveOtp(g.group_id),
              delivery_otp_label: 'SAMPLE DEMO OTP (in production sent via SMS with TTL)',
            }
          : {}),
      };
    });

  res.json({
    order,
    payment: payment
      ? {
          ...payment,
          simulated_notice: 'SIMULATED sandbox payment — no real money movement',
        }
      : null,
    items,
    groups,
  });
});

// ============================================================
// CANCELLATION (REAL atomic state transitions + T1-T4 transfer fall-through + upsert restock)
// ============================================================

const cancelSchema = z.object({
  request_key: z.string().min(1),
  reason_code: z.string().optional(),
});

apiRouter.post('/orders/:id/items/:orderItemId/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = cancelSchema.parse(req.body);
    const userId = req.user!.user_id;
    const orderId = req.params.id;
    const orderItemId = req.params.orderItemId;

    const result = store.runAtomic(() => {
      const order = store.orders.find((o) => o.order_id === orderId);
      if (!order || (order.user_id !== userId && req.user!.role !== 'admin')) {
        throw new DomainError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }

      // STEP a: Replay check on (order_item_id, request_key)
      const existingCase = store.after_sales_cases.find(
        (c) => c.order_item_id === orderItemId && c.request_key === body.request_key
      );
      if (existingCase) {
        const existingRefund = store.refunds.find((r) => r.order_item_id === orderItemId && r.kind === 'path_a');
        return {
          case_id: existingCase.case_id,
          replay: true,
          refund: existingRefund ?? null,
        };
      }

      // STEP b: GATE - atomic conditional transition on order_items
      const item = store.order_items.find(
        (i) => i.order_item_id === orderItemId && i.order_id === orderId
      );
      if (!item) {
        throw new DomainError(404, 'ORDER_ITEM_NOT_FOUND', 'Order item not found.');
      }
      const group = item.group_id
        ? store.fulfilment_groups.find((g) => g.group_id === item.group_id)
        : null;

      if (
        !(item.item_status === 'placed' || item.item_status === 'confirmed') ||
        (group && !isGroupCancellable(group.status))
      ) {
        throw new DomainError(
          409,
          'ALREADY_CANCELLED_OR_TOO_LATE',
          'This item has already been cancelled or dispatched and can no longer be cancelled.'
        );
      }

      const nowIso = new Date().toISOString();
      item.item_status = 'cancelled';
      item.cancelled_at = nowIso;

      // STEP c: IF stock_finalised = FALSE (inventory-finalizer has not run yet)
      if (!item.stock_finalised) {
        const resRow = store.reservations.find(
          (r) => r.reservation_id === item.reservation_id && r.status === 'confirmed'
        );
        if (!resRow) {
          throw new DomainError(409, 'RESERVATION_STATE_CONFLICT', 'Confirmed reservation not found for release.');
        }
        resRow.status = 'released';
        store.releaseHold(item.offer_id, item.stock_location_id, item.quantity);
      } else {
        // STEP d: IF stock_finalised = TRUE -> ORDERED FALL-THROUGH (T1 -> T2 -> T3 -> T4 -> FALL-THROUGH)
        let settled = false;
        const transfer = store.stock_transfers.find((t) => t.order_item_id === item.order_item_id);

        if (transfer) {
          // T1: requested -> cancelled_at_origin (restock at ORIGIN)
          if (!settled && transfer.status === 'requested') {
            transfer.status = 'cancelled_at_origin';
            transfer.settled_at = nowIso;
            store.restockUnits(item.offer_id, transfer.from_location_id, transfer.quantity);
            settled = true;
          }
          // T2: in_transit -> set cancel_on_receipt = true (NO stock movement now)
          if (!settled && transfer.status === 'in_transit') {
            transfer.cancel_on_receipt = true;
            settled = true;
          }
          // T3: received_checked -> restocked_bangalore (UPSERT at BANGALORE)
          if (!settled && transfer.status === 'received_checked') {
            transfer.status = 'restocked_bangalore';
            transfer.cancel_on_receipt = true;
            transfer.settled_at = nowIso;
            store.restockUnits(item.offer_id, transfer.to_location_id, transfer.quantity);
            settled = true;
          }
          // T4: allocated -> restocked_bangalore (UPSERT at BANGALORE)
          if (!settled && transfer.status === 'allocated') {
            transfer.status = 'restocked_bangalore';
            transfer.settled_at = nowIso;
            store.restockUnits(item.offer_id, transfer.to_location_id, transfer.quantity);
            settled = true;
          }
          // FALL-THROUGH: already terminal -> NO movement
          if (!settled) {
            if (
              transfer.status !== 'cancelled_at_origin' &&
              transfer.status !== 'restocked_bangalore'
            ) {
              throw new DomainError(409, 'TRANSFER_STATE_CONFLICT', 'Unexpected transfer status.');
            }
          }
        } else {
          // Plain non-transfer restock via UPSERT
          store.restockUnits(item.offer_id, item.stock_location_id, item.quantity);
        }
      }

      // STEP e: Insert after_sales_cases + refunds ('requested') + ONE outbox 'order-item-cancelled'
      const caseId = crypto.randomUUID();
      store.after_sales_cases.push({
        case_id: caseId,
        order_item_id: item.order_item_id,
        user_id: order.user_id,
        type: 'cancellation',
        reason_code: body.reason_code ?? 'customer_requested',
        status: 'requested',
        request_key: body.request_key,
        requested_at: nowIso,
        closed_at: null,
      });

      const refundRow = {
        refund_id: crypto.randomUUID(),
        order_item_id: item.order_item_id,
        case_id: caseId,
        item_amount: item.item_paid_amount,
        fee_amount: item.delivery_fee_share,
        kind: 'path_a' as const,
        method: 'original',
        status: 'requested' as const,
        gateway_ref: null,
        idempotency_key: `refund:${item.order_item_id}:path_a`,
        initiated_at: null,
        credited_at: null,
      };
      store.refunds.push(refundRow);

      // If every item in the group is now cancelled, mark group cancelled
      if (group) {
        const groupItems = store.order_items.filter((oi) => oi.group_id === group.group_id);
        if (groupItems.every((oi) => oi.item_status === 'cancelled')) {
          group.status = 'cancelled';
        }
      }

      // DO NOT emit notification-created or inventory-updated here; cancellation-handler owns both!
      store.enqueueOutbox('order-item-cancelled', item.offer_id, {
        order_id: order.order_id,
        order_item_id: item.order_item_id,
        offer_id: item.offer_id,
        group_id: item.group_id,
        user_id: order.user_id,
        refund_id: refundRow.refund_id,
      });

      return {
        case_id: caseId,
        replay: false,
        refund: refundRow,
      };
    });

    await flushOutbox();
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// ============================================================
// NOTIFICATIONS
// ============================================================

apiRouter.get('/notifications', requireAuth, (req: Request, res: Response) => {
  const unreadOnly = req.query.unread === 'true';
  const items = store.notifications
    .filter((n) => n.user_id === req.user!.user_id && (!unreadOnly || n.read_at === null))
    .slice(0, 50);
  const unreadCount = store.notifications.filter(
    (n) => n.user_id === req.user!.user_id && n.read_at === null
  ).length;

  res.json({ notifications: items, unread_count: unreadCount });
});

apiRouter.post('/notifications/mark-read', requireAuth, (req: Request, res: Response) => {
  const now = new Date().toISOString();
  for (const n of store.notifications) {
    if (n.user_id === req.user!.user_id && n.read_at === null) {
      n.read_at = now;
    }
  }
  res.json({ marked_read: true });
});

// ============================================================
// ADMIN DASHBOARD, SIMULATOR, OTP PROOF & LIVE-PROOF PANEL
// ============================================================

apiRouter.get('/admin/overview', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const activeGroups = store.fulfilment_groups.filter(
    (g) => g.status !== 'delivered' && g.status !== 'cancelled'
  );
  const pendingTransfers = store.stock_transfers.filter(
    (t) => t.status !== 'allocated' && t.status !== 'cancelled_at_origin' && t.status !== 'restocked_bangalore'
  );
  const totalSellableFreeUnits = store.inventory.reduce((acc, inv) => {
    const loc = store.stock_locations.find((l) => l.location_id === inv.location_id);
    if (!loc?.is_sellable) return acc;
    return acc + Math.max(0, inv.quantity - inv.reserved_quantity);
  }, 0);

  res.json({
    metrics: {
      total_products: store.products.length,
      total_dealers: store.dealers.length,
      total_offers: store.dealer_offers.length,
      total_orders: store.orders.length,
      active_fulfilment_groups: activeGroups.length,
      pending_transfers: pendingTransfers.length,
      refund_cases: store.refunds.length,
      total_sellable_free_units: totalSellableFreeUnits,
      reconciliation_discrepancies: store.runReconciliationCheck().length,
    },
    hubs: store.fulfilment_hubs.map((h) => {
      const loc = store.stock_locations.find((l) => l.location_id === h.location_id);
      const pins = store.hub_service_areas
        .filter((a) => a.hub_id === h.hub_id)
        .map((a) => a.pin_code);
      return {
        ...h,
        location_name: loc?.name ?? 'Hub',
        pin_codes: pins,
        used_capacity_today: store.getQuickGroupsCountToday(h.location_id),
        picking_queue: store.getPickingQueueCount(h.location_id),
      };
    }),
    infrastructure: {
      postgresql: envConfig.isPgConfigured ? 'Aiven PostgreSQL (Connected)' : 'Local Sandbox Preview (Set PG_URI for Aiven)',
      kafka: envConfig.isKafkaConfigured ? 'Aiven Kafka (Connected)' : 'Local Keyed 2-Partition Bus (Set KAFKA_BROKERS for Aiven)',
      opensearch: envConfig.isOpenSearchConfigured ? 'Aiven OpenSearch (Connected)' : 'Local Revision-Guarded Fuzzy Index (Set OPENSEARCH_URL for Aiven)',
    },
  });
});

apiRouter.get('/admin/groups', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const groups = [...store.fulfilment_groups]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((g) => {
      const order = store.orders.find((o) => o.order_id === g.order_id);
      const customer = order ? store.users.find((u) => u.user_id === order.user_id) : null;
      const loc = store.stock_locations.find((l) => l.location_id === g.location_id);
      const items = store.order_items.filter((i) => i.group_id === g.group_id);
      const transfers = store.stock_transfers.filter((t) => t.group_id === g.group_id);
      const refunds = store.refunds.filter((r) =>
        items.some((i) => i.order_item_id === r.order_item_id)
      );
      const timeline = store.shipment_timeline
        .filter((t) => t.group_id === g.group_id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      return {
        group_id: g.group_id,
        order_id: g.order_id,
        customer_name: customer?.name ?? 'Customer',
        mode: g.mode,
        status: g.status,
        location_name: loc?.name ?? '',
        fee_total: g.fee_total,
        eta_window_start: g.eta_window_start,
        eta_window_end: g.eta_window_end,
        eta_basis: g.eta_basis,
        otp_hash_preview: `${g.otp_hash.slice(0, 12)}...`,
        created_at: g.created_at,
        items: items.map((i) => ({
          order_item_id: i.order_item_id,
          offer_id: i.offer_id,
          product_name:
            store.products.find(
              (p) => p.product_id === store.dealer_offers.find((o) => o.offer_id === i.offer_id)?.product_id
            )?.name ?? 'Product',
          quantity: i.quantity,
          item_status: i.item_status,
          paid_amount: i.paid_amount,
          refunded_amount: i.refunded_amount,
          stock_finalised: i.stock_finalised,
        })),
        transfers,
        refunds,
        timeline,
      };
    });

  res.json({ groups, all_refunds: store.refunds });
});

apiRouter.get('/admin/groups/:id/demo-otp', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const group = store.fulfilment_groups.find((g) => g.group_id === req.params.id);
  if (!group) {
    res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'Fulfilment group not found.' });
    return;
  }
  // Raw code appears ONLY here (admin) and GET /api/orders/:id (owning customer). Never logged or published.
  res.json({
    group_id: group.group_id,
    demo_otp: deriveOtp(group.group_id),
    label: 'SAMPLE DEMO OTP (autofill only — hashed into otp_proof before leaving API route)',
  });
});

const fireEventSchema = z.object({
  group_id: z.string().uuid(),
  event_type: z.string().min(1),
  otp: z.string().optional(),
  note: z.string().max(240).optional(),
});

apiRouter.post('/simulator/fire-event', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = fireEventSchema.parse(req.body);
    const group = store.fulfilment_groups.find((g) => g.group_id === body.group_id);
    if (!group) {
      throw new DomainError(404, 'GROUP_NOT_FOUND', 'Fulfilment group not found.');
    }

    const isFulfilment = SIMULATOR_FULFILMENT_EVENTS.has(body.event_type);
    const isTransfer = SIMULATOR_TRANSFER_EVENTS.has(body.event_type);
    if (!isFulfilment && !isTransfer) {
      throw new DomainError(
        400,
        'INVALID_EVENT_TYPE',
        `Unsupported simulator event_type: ${body.event_type}`
      );
    }

    let outboxRecord: ReturnType<typeof store.enqueueOutbox>;

    if (isFulfilment) {
      const payload: Record<string, unknown> = {
        group_id: group.group_id,
        event_type: body.event_type,
      };
      if (body.note) payload.note = body.note;

      // v7.1 OTP PROOF RULE: raw otp NEVER enters outbox payload, Kafka, logs, or live-proof!
      if (body.event_type === 'otp_verified') {
        if (!body.otp || body.otp.trim().length === 0) {
          throw new DomainError(400, 'OTP_REQUIRED', 'Delivery OTP is required for otp_verified.');
        }
        payload.otp_proof = hashOtpSubmission(body.otp);
      }

      outboxRecord = store.enqueueOutbox('fulfilment-status-updated', group.group_id, payload);
    } else {
      outboxRecord = store.enqueueOutbox('stock-transfer-status-updated', group.group_id, {
        group_id: group.group_id,
        event_type: body.event_type,
      });
    }

    await flushOutbox();

    res.status(202).json({
      event_id: outboxRecord.event_id,
      event_type: outboxRecord.event_type,
      topic: outboxRecord.topic,
      partition: outboxRecord.partition,
    });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/admin/refunds/:id/credit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const refund = store.refunds.find((r) => r.refund_id === req.params.id);
    if (!refund) {
      throw new DomainError(404, 'REFUND_NOT_FOUND', 'Refund record not found.');
    }

    // Route NEVER touches money or emits notifications; it ONLY enqueues refund-credit-requested
    const ev = store.enqueueOutbox('refund-credit-requested', refund.order_item_id, {
      refund_id: refund.refund_id,
      order_item_id: refund.order_item_id,
      gateway_ref: typeof req.body?.gateway_ref === 'string' ? req.body.gateway_ref : undefined,
      source: 'admin_simulator_credit (SIMULATED)',
    });

    await flushOutbox();

    res.status(202).json({
      event_id: ev.event_id,
      refund_id: refund.refund_id,
      message: 'Refund credit event enqueued (SIMULATED gateway; processed idempotently by refund-credit consumer).',
    });
  } catch (err) {
    sendError(res, err);
  }
});

const hubStatusSchema = z.object({
  active: z.boolean(),
});

apiRouter.post('/admin/hubs/:id/status', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { active } = hubStatusSchema.parse(req.body);
    const hub = store.fulfilment_hubs.find((h) => h.hub_id === req.params.id);
    if (!hub) {
      throw new DomainError(404, 'HUB_NOT_FOUND', 'Fulfilment hub not found.');
    }

    const updated = store.runAtomic(() => {
      const changed = hub.active !== active;
      hub.active = active;
      let affectedOffers: string[] = [];
      let affectedGroups: string[] = [];

      if (changed) {
        // Trigger emulation: bump revisions in offer_id lock order
        affectedOffers = store.bumpRevisionForHubLocation(hub.location_id);
        for (const offerId of affectedOffers) {
          store.enqueueOutbox('inventory-updated', offerId, {
            offer_id: offerId,
            location_id: hub.location_id,
            reason: active ? 'hub_resumed' : 'hub_paused',
          });
        }

        // Emit eta-updated for every active group at this hub
        const activeHubGroups = store.fulfilment_groups.filter(
          (g) =>
            g.location_id === hub.location_id &&
            g.status !== 'delivered' &&
            g.status !== 'cancelled'
        );
        affectedGroups = activeHubGroups.map((g) => g.group_id);
        for (const g of activeHubGroups) {
          const revisedEta = computeEtaWindow({
            mode: active ? g.mode : 'standard',
            pickingQueue: store.getPickingQueueCount(hub.location_id),
          });
          store.enqueueOutbox('eta-updated', g.group_id, {
            group_id: g.group_id,
            eta_window_start: revisedEta.eta_window_start,
            eta_window_end: revisedEta.eta_window_end,
            eta_basis: revisedEta.eta_basis,
            note: active
              ? 'Local hub resumed operations — ETA range updated.'
              : 'Local hub paused — ETA revised to standard fulfilment window.',
          });
        }
      }

      return {
        hub_id: hub.hub_id,
        active: hub.active,
        affected_offers: affectedOffers.length,
        affected_groups: affectedGroups.length,
      };
    });

    await flushOutbox();
    res.json(updated);
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.get('/admin/live-proof', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const offerIdParam = typeof req.query.offer_id === 'string' ? req.query.offer_id : undefined;
    const recentOutbox = [...store.outbox_events].slice(-30).reverse();
    const recentProcessed = [...store.processed_events].slice(-40).reverse();

    const sampleOfferId = offerIdParam || store.dealer_offers[0]?.offer_id;
    const indexedDoc = sampleOfferId ? await getIndexedOfferDoc(sampleOfferId) : null;
    const pgVersion = sampleOfferId ? store.offer_state_versions.get(sampleOfferId) ?? null : null;

    const topIndexed = localSearchIndex
      .getAllDocs()
      .slice(0, 12)
      .map((d) => ({
        offer_id: d.offer_id,
        product_name: d.product_name,
        shop_name: d.shop_name,
        selling_price: d.selling_price,
        available_units: d.available_units,
        revision: d.revision,
        pg_revision: store.offer_state_versions.get(d.offer_id)?.revision ?? d.revision,
      }));

    res.json({
      outbox_events: recentOutbox,
      processed_events: recentProcessed,
      inspected_offer: {
        offer_id: sampleOfferId,
        pg_revision: pgVersion?.revision ?? null,
        indexed_doc: indexedDoc,
      },
      indexed_summary: topIndexed,
      reconciliation_discrepancies: store.runReconciliationCheck(),
      note: 'All OTP delivery events carry HMAC otp_proof hashes only; raw OTP codes are never stored or displayed here.',
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ============================================================
// OPTIONAL FLAGGED ENDPOINTS
// ============================================================

apiRouter.get('/addresses', requireAuth, (req: Request, res: Response) => {
  if (!isFeatureEnabled('FEATURE_ADDRESSES')) {
    res.status(404).json({ error: 'FEATURE_DISABLED', message: 'Address book is disabled.' });
    return;
  }
  const addresses = store.customer_addresses.filter((a) => a.user_id === req.user!.user_id);
  res.json({ addresses });
});

const addressSchema = z.object({
  label: z.string().min(1).max(30).default('Home'),
  recipient_name: z.string().min(1).max(100),
  phone: z.string().min(7).max(25),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  landmark: z.string().max(120).optional(),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  pin_code: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  instructions: z.string().max(200).optional(),
  is_default: z.boolean().optional(),
});

apiRouter.post('/addresses', requireAuth, (req: Request, res: Response) => {
  try {
    if (!isFeatureEnabled('FEATURE_ADDRESSES')) {
      throw new DomainError(404, 'FEATURE_DISABLED', 'Address book is disabled.');
    }
    const body = addressSchema.parse(req.body);
    if (body.is_default) {
      for (const a of store.customer_addresses) {
        if (a.user_id === req.user!.user_id) a.is_default = false;
      }
    }
    const created = {
      address_id: crypto.randomUUID(),
      user_id: req.user!.user_id,
      label: body.label,
      recipient_name: body.recipient_name,
      phone: body.phone,
      line1: body.line1,
      line2: body.line2 ?? null,
      landmark: body.landmark ?? null,
      city: body.city,
      state: body.state,
      pin_code: body.pin_code,
      instructions: body.instructions ?? null,
      is_default: Boolean(body.is_default),
      created_at: new Date().toISOString(),
    };
    store.customer_addresses.push(created);
    res.status(201).json({ address: created });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.delete('/addresses/:id', requireAuth, (req: Request, res: Response) => {
  if (!isFeatureEnabled('FEATURE_ADDRESSES')) {
    res.status(404).json({ error: 'FEATURE_DISABLED', message: 'Address book is disabled.' });
    return;
  }
  const idx = store.customer_addresses.findIndex(
    (a) => a.address_id === req.params.id && a.user_id === req.user!.user_id
  );
  if (idx === -1) {
    res.status(404).json({ error: 'ADDRESS_NOT_FOUND', message: 'Address not found.' });
    return;
  }
  store.customer_addresses.splice(idx, 1);
  res.json({ deleted: true });
});

apiRouter.get('/wishlist', requireAuth, (req: Request, res: Response) => {
  if (!isFeatureEnabled('FEATURE_WISHLIST')) {
    res.status(404).json({ error: 'FEATURE_DISABLED', message: 'Wishlist is disabled.' });
    return;
  }
  const items = store.user_wishlist
    .filter((w) => w.user_id === req.user!.user_id)
    .map((w) => ({
      ...w,
      product: buildProductSummary(w.product_id),
    }))
    .filter((w) => w.product !== null);
  res.json({ items });
});

apiRouter.post('/wishlist/toggle', requireAuth, (req: Request, res: Response) => {
  if (!isFeatureEnabled('FEATURE_WISHLIST')) {
    res.status(404).json({ error: 'FEATURE_DISABLED', message: 'Wishlist is disabled.' });
    return;
  }
  const productId = String(req.body?.product_id || '');
  if (!store.products.some((p) => p.product_id === productId)) {
    res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found.' });
    return;
  }
  const idx = store.user_wishlist.findIndex(
    (w) => w.user_id === req.user!.user_id && w.product_id === productId
  );
  if (idx >= 0) {
    store.user_wishlist.splice(idx, 1);
    res.json({ wishlisted: false, product_id: productId });
  } else {
    store.user_wishlist.push({
      wishlist_id: crypto.randomUUID(),
      user_id: req.user!.user_id,
      product_id: productId,
      added_at: new Date().toISOString(),
    });
    res.json({ wishlisted: true, product_id: productId });
  }
});

apiRouter.get('/recently-viewed', requireAuth, (req: Request, res: Response) => {
  const items = store.recently_viewed
    .filter((r) => r.user_id === req.user!.user_id)
    .sort((a, b) => b.viewed_at.localeCompare(a.viewed_at))
    .slice(0, 8)
    .map((r) => buildProductSummary(r.product_id))
    .filter(Boolean);
  res.json({ products: items });
});

const validateCouponSchema = z.object({
  code: z.string().min(1),
  basket_total_paise: z.number().int().min(0),
});

apiRouter.post('/coupons/validate', requireAuth, (req: Request, res: Response) => {
  try {
    if (!isFeatureEnabled('FEATURE_COUPONS')) {
      throw new DomainError(404, 'FEATURE_DISABLED', 'Coupons are disabled.');
    }
    const { code, basket_total_paise } = validateCouponSchema.parse(req.body);
    const coupon = store.coupons.find((c) => c.code.toUpperCase() === code.trim().toUpperCase() && c.active);
    if (!coupon) {
      throw new DomainError(404, 'INVALID_COUPON', 'Coupon code not found or inactive.');
    }
    const nowMs = Date.now();
    if (nowMs < new Date(coupon.valid_from).getTime() || nowMs > new Date(coupon.valid_to).getTime()) {
      throw new DomainError(400, 'COUPON_EXPIRED', 'This coupon has expired.');
    }
    if (basket_total_paise < coupon.min_basket_paise) {
      throw new DomainError(
        400,
        'MIN_BASKET_NOT_MET',
        `Minimum basket total of Rs.${(coupon.min_basket_paise / 100).toFixed(0)} required.`
      );
    }
    const usedByUser = store.coupon_customer_usage.get(`${coupon.coupon_id}:${req.user!.user_id}`) ?? 0;
    if (usedByUser >= coupon.per_customer_limit) {
      throw new DomainError(409, 'PER_CUSTOMER_LIMIT_REACHED', 'Per-customer limit reached for this coupon.');
    }
    if (coupon.max_redemptions !== null && coupon.redeemed_count >= coupon.max_redemptions) {
      throw new DomainError(409, 'COUPON_LIMIT_REACHED', 'Global redemption limit reached for this coupon.');
    }

    const discountPaise =
      coupon.kind === 'fixed_paise'
        ? Math.min(coupon.value, basket_total_paise)
        : Math.min(Math.floor((basket_total_paise * coupon.value) / 100), basket_total_paise);

    res.json({
      valid: true,
      code: coupon.code,
      kind: coupon.kind,
      discount_paise: discountPaise,
      min_basket_paise: coupon.min_basket_paise,
    });
  } catch (err) {
    sendError(res, err);
  }
});

const alertSchema = z.object({
  offer_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  type: z.enum(['back_in_stock', 'price_drop']),
  price_threshold_paise: z.number().int().positive().optional(),
});

apiRouter.post('/alerts/subscribe', requireAuth, (req: Request, res: Response) => {
  try {
    if (!isFeatureEnabled('FEATURE_ALERTS')) {
      throw new DomainError(404, 'FEATURE_DISABLED', 'Alerts are disabled.');
    }
    const body = alertSchema.parse(req.body);
    if (!body.offer_id && !body.product_id) {
      throw new DomainError(400, 'MISSING_TARGET', 'Specify either offer_id or product_id.');
    }
    const created = {
      subscription_id: crypto.randomUUID(),
      user_id: req.user!.user_id,
      offer_id: body.offer_id ?? null,
      product_id: body.product_id ?? null,
      type: body.type,
      price_threshold_paise: body.price_threshold_paise ?? null,
      active: true,
      created_at: new Date().toISOString(),
    };
    store.alert_subscriptions.push(created);
    res.status(201).json({ subscription: created });
  } catch (err) {
    sendError(res, err);
  }
});

const assistantSchema = z.object({
  message: z.string().min(2).max(500),
});

apiRouter.post('/shopping-assistant', requireAuth, assistantRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!isFeatureEnabled('FEATURE_ASSISTANT')) {
      throw new DomainError(404, 'FEATURE_DISABLED', 'Shopping assistant is disabled.');
    }
    const { message } = assistantSchema.parse(req.body);
    const knownCategories = store.categories.map((c) => c.category_name);
    const knownCities = Array.from(new Set(store.dealers.map((d) => d.city)));

    const extraction = await extractShoppingFilters(message, knownCategories, knownCities);
    const { filters, fallback, explanation } = extraction;

    // Call searchOffers with validated filters ONLY, then re-read PostgreSQL truth!
    const osResult = await searchOffers({
      q: filters.q || filters.product_type || undefined,
      category: filters.category,
      maxPricePaise: filters.max_price,
      city: filters.city,
      limit: 50,
    });

    const candidateOffers: OfferForComparison[] = [];
    for (const hit of osResult.hits) {
      const comp = store.buildOfferForComparison(hit.offer_id);
      if (!comp || comp.status !== 'active' || comp.sellable_free_units <= 0) continue;
      if (filters.max_price && comp.selling_price > filters.max_price) continue;
      if (filters.city && comp.dealer_city.toLowerCase() !== filters.city.toLowerCase()) continue;
      if (filters.delivery_mode === 'quick' && !computeOfferQuickEligibility(comp.offer_id).quick_available) {
        continue;
      }
      candidateOffers.push(comp);
    }

    const ranked = rankOffersByCategory(candidateOffers, filters.sort_preference || 'value').slice(0, 8);

    const responseMessage =
      ranked.length > 0
        ? `${explanation} Found ${ranked.length} verified in-stock offers matching your filters.`
        : 'No live offers matched all extracted filters. Try relaxing your maximum price or city filter.';

    res.json({
      filters,
      results: ranked.map((r) => ({
        ...r,
        quick_available: computeOfferQuickEligibility(r.offer_id).quick_available,
      })),
      message: responseMessage,
      fallback,
    });
  } catch (err) {
    sendError(res, err);
  }
});
