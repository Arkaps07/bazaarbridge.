import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  SlidersHorizontal,
  X,
  ShoppingCart,
  ArrowUpRight,
  Check,
  Scale,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { getCategoryImage } from '../assets/media';
import { useApp } from '../context/AppContext';

interface SearchResultOffer {
  offer_id: string;
  product_id: string;
  product_name: string;
  brand: string;
  category_name: string;
  dealer_id: string;
  shop_name: string;
  dealer_city: string;
  dealer_state: string;
  dealer_rating: number;
  total_reviews: number;
  selling_price: number;
  available_units: number;
  home_units: number;
  hub_units: number;
  quick_available: boolean;
  default_location_type: string;
  dealer_count: number;
  bangalore_delivery_days: number | null;
  transfer_days_max: number | null;
}

interface FilterOptions {
  categories: Array<{ category_id: string; category_name: string }>;
  cities: string[];
}

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token, refreshCartCount, notify, compareIds, toggleCompareId, featureFlags } = useApp();

  const [queryInput, setQueryInput] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [city, setCity] = useState(searchParams.get('city') || '');
  const [maxPriceRupees, setMaxPriceRupees] = useState(searchParams.get('max_price_inr') || '');
  const [quickOnly, setQuickOnly] = useState(searchParams.get('quick') === 'true');
  const [sortBy, setSortBy] = useState<'relevance' | 'price_asc' | 'price_desc' | 'rating_desc'>('relevance');

  const [filtersMeta, setFiltersMeta] = useState<FilterOptions>({ categories: [], cities: [] });
  const [results, setResults] = useState<SearchResultOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<FilterOptions>('/api/search/filters')
      .then((res) => setFiltersMeta(res))
      .catch(() => {});
  }, []);

  // Sync URL params into state if user clicked a link
  useEffect(() => {
    setQueryInput(searchParams.get('q') || '');
    setCategory(searchParams.get('category') || '');
    setCity(searchParams.get('city') || '');
    setMaxPriceRupees(searchParams.get('max_price_inr') || '');
    setQuickOnly(searchParams.get('quick') === 'true');
  }, [searchParams]);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (queryInput.trim()) params.set('q', queryInput.trim());
      if (category) params.set('category', category);
      if (city) params.set('city', city);
      if (maxPriceRupees && Number(maxPriceRupees) > 0) {
        params.set('max_price', String(Math.round(Number(maxPriceRupees) * 100)));
      }
      if (quickOnly) params.set('quick', 'true');

      const data = await apiRequest<{ results: SearchResultOffer[] }>(`/api/search?${params.toString()}`);
      setResults(data.results || []);
    } catch {
      setError('Search service temporarily unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [queryInput, category, city, maxPriceRupees, quickOnly]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchResults();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [fetchResults]);

  const syncParams = (overrides: Record<string, string | boolean>) => {
    const next = new URLSearchParams();
    const qVal = overrides.q !== undefined ? String(overrides.q) : queryInput;
    const catVal = overrides.category !== undefined ? String(overrides.category) : category;
    const cityVal = overrides.city !== undefined ? String(overrides.city) : city;
    const priceVal = overrides.max_price_inr !== undefined ? String(overrides.max_price_inr) : maxPriceRupees;
    const quickVal = overrides.quick !== undefined ? Boolean(overrides.quick) : quickOnly;

    if (qVal.trim()) next.set('q', qVal.trim());
    if (catVal) next.set('category', catVal);
    if (cityVal) next.set('city', cityVal);
    if (priceVal) next.set('max_price_inr', priceVal);
    if (quickVal) next.set('quick', 'true');
    setSearchParams(next, { replace: true });
  };

  const clearAllFilters = () => {
    setQueryInput('');
    setCategory('');
    setCity('');
    setMaxPriceRupees('');
    setQuickOnly(false);
    setSearchParams({}, { replace: true });
  };

  const handleAddToCart = async (offer: SearchResultOffer) => {
    if (!token) {
      notify('info', 'Please sign in to add items to your cart.');
      navigate('/login?next=/search');
      return;
    }
    setAddingId(offer.offer_id);
    try {
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: { offer_id: offer.offer_id, quantity: 1 },
      });
      await refreshCartCount();
      notify('success', `Added ${offer.product_name} (${offer.shop_name}) to cart.`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Failed to add to cart.');
    } finally {
      setAddingId(null);
    }
  };

  const sortedResults = useMemo(() => {
    const copy = [...results];
    if (sortBy === 'price_asc') copy.sort((a, b) => a.selling_price - b.selling_price);
    else if (sortBy === 'price_desc') copy.sort((a, b) => b.selling_price - a.selling_price);
    else if (sortBy === 'rating_desc') copy.sort((a, b) => b.dealer_rating - a.dealer_rating);
    return copy;
  }, [results, sortBy]);

  const hasActiveFilters = Boolean(queryInput || category || city || maxPriceRupees || quickOnly);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header & Search Input */}
      <div className="space-y-4">
        <div>
          <h1
            className="text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Browse &amp; Search Offers
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            Typo-tolerant search (try <span className="font-mono text-[#111827]">bluetoth</span>) backed by live PostgreSQL price, stock, and Quick-hub verification.
          </p>
        </div>

        {/* Clean Single-Row Filter & Search Controls */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-4 relative">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="catalog-search" className="sr-only">Search catalog</label>
              <input
                id="catalog-search"
                type="text"
                value={queryInput}
                onChange={(e) => {
                  setQueryInput(e.target.value);
                  syncParams({ q: e.target.value });
                }}
                placeholder='Search product, brand, or "bluetoth"...'
                className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3 py-2.5 text-sm text-[#111827] focus:bg-white focus:border-[#4F46E5] focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="filter-category" className="sr-only">Category</label>
              <select
                id="filter-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  syncParams({ category: e.target.value });
                }}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none"
              >
                <option value="">All Categories</option>
                {filtersMeta.categories.map((c) => (
                  <option key={c.category_id} value={c.category_name}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="filter-city" className="sr-only">Dealer City</label>
              <select
                id="filter-city"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  syncParams({ city: e.target.value });
                }}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none"
              >
                <option value="">All Cities</option>
                {filtersMeta.cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="filter-max-price" className="sr-only">Max price in INR</label>
              <input
                id="filter-max-price"
                type="number"
                min={0}
                step={100}
                value={maxPriceRupees}
                onChange={(e) => {
                  setMaxPriceRupees(e.target.value);
                  syncParams({ max_price_inr: e.target.value });
                }}
                placeholder="Max price (₹)"
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#111827] tabular-nums focus:border-[#4F46E5] focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="filter-sort" className="sr-only">Sort offers</label>
              <select
                id="filter-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#111827] focus:border-[#4F46E5] focus:outline-none"
              >
                <option value="relevance">Sort: Relevance</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="rating_desc">Dealer Rating</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E2E8F0]">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-[#111827] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={quickOnly}
                  onChange={(e) => {
                    setQuickOnly(e.target.checked);
                    syncParams({ quick: e.target.checked });
                  }}
                  className="rounded border-[#CBD5E1] text-[#4F46E5] focus:ring-[#4F46E5]"
                />
                <span>Quick Delivery Eligible Only (live hub stock)</span>
              </label>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#4F46E5] hover:underline cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear all filters</span>
                </button>
              )}
            </div>

            <div className="inline-flex items-center gap-1.5 text-xs text-[#64748B] tabular-nums">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{loading ? 'Checking live stock...' : `${sortedResults.length} verified offers`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Results Grid */}
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-[#E2E8F0] h-80 animate-pulse" />
          ))}
        </div>
      ) : sortedResults.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center space-y-3">
          <p className="text-base font-semibold text-[#111827]">No matching live offers found</p>
          <p className="text-sm text-[#64748B] max-w-md mx-auto">
            Try clearing your maximum price, switching cities, or searching for &ldquo;bluetooth&rdquo;, &ldquo;keyboard&rdquo;, or &ldquo;smartwatch&rdquo;.
          </p>
          <button
            type="button"
            onClick={clearAllFilters}
            className="mt-2 inline-flex items-center rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-medium text-white hover:bg-[#4338CA] cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedResults.map((offer) => {
            const isCompared = compareIds.includes(offer.product_id);
            const fulfilmentText = offer.quick_available
              ? 'Quick & Standard'
              : offer.home_units === 0 && offer.hub_units === 0
                ? `Transfer (~${offer.transfer_days_max ?? 3}d)`
                : `Standard (${offer.bangalore_delivery_days ?? 2}d)`;

            return (
              <article
                key={offer.offer_id}
                className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden flex flex-col justify-between transition-all hover:shadow-md"
              >
                <div>
                  <Link
                    to={`/products/${offer.product_id}`}
                    className="block aspect-[4/3] bg-[#F1F5F9] overflow-hidden"
                  >
                    <img
                      src={getCategoryImage(offer.category_name)}
                      alt={offer.product_name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </Link>
                  <div className="p-5 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
                      <span>{offer.brand}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{offer.category_name}</span>
                    </div>
                    <Link
                      to={`/products/${offer.product_id}`}
                      className="block text-base font-semibold text-[#111827] hover:text-[#4F46E5] line-clamp-2"
                    >
                      {offer.product_name}
                    </Link>
                    <div className="text-xs text-[#64748B] space-y-1 pt-1">
                      <p className="text-[#111827] font-medium">
                        {offer.shop_name} · {offer.dealer_city}
                      </p>
                      <p className="tabular-nums">
                        {offer.dealer_rating.toFixed(1)} rating ({offer.total_reviews}) ·{' '}
                        <span className={offer.quick_available ? 'text-[#16A34A] font-medium' : ''}>
                          {fulfilmentText}
                        </span>{' '}
                        · {offer.available_units} in stock
                      </p>
                    </div>
                  </div>
                </div>

                <div className="px-5 pb-5 pt-3 border-t border-[#E2E8F0] space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span
                      className="text-xl font-semibold text-[#111827] tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatPaise(offer.selling_price)}
                    </span>
                    <Link
                      to={`/products/${offer.product_id}/compare`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#4F46E5] hover:underline"
                    >
                      <span>Compare {offer.dealer_count} {offer.dealer_count === 1 ? 'dealer' : 'dealers'}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={addingId === offer.offer_id}
                      onClick={() => handleAddToCart(offer)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-3 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>{addingId === offer.offer_id ? 'Adding...' : 'Add to Cart'}</span>
                    </button>

                    {featureFlags.has('FEATURE_COMPARE') && (
                      <button
                        type="button"
                        onClick={() => toggleCompareId(offer.product_id)}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                          isCompared
                            ? 'border-[#4F46E5] bg-indigo-50 text-[#4F46E5]'
                            : 'border-[#E2E8F0] text-[#64748B] hover:text-[#111827]'
                        }`}
                      >
                        {isCompared ? <Check className="w-3.5 h-3.5" /> : 'Specs'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Floating Side-by-Side Specs Bar */}
      {featureFlags.has('FEATURE_COMPARE') && compareIds.length >= 2 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-[#111827] text-white rounded-xl px-5 py-3 shadow-lg flex items-center gap-4">
          <Scale className="w-4 h-4 text-indigo-300" />
          <span className="text-sm font-medium tabular-nums">
            {compareIds.length} products selected for spec comparison
          </span>
          <Link
            to={`/compare?ids=${compareIds.join(',')}`}
            className="rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            Compare Specs
          </Link>
        </div>
      )}
    </div>
  );
};
