import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Heart,
  Layers,
  ShoppingCart,
  TrendingDown,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { getCategoryImage } from '../assets/media';
import { useApp } from '../context/AppContext';
import { ProductCard, type ProductSummaryCardData } from '../components/ProductCard';

interface OfferItem {
  offer_id: string;
  dealer_id: string;
  shop_name: string;
  dealer_city: string;
  dealer_rating: number;
  total_reviews: number;
  selling_price: number;
  sellable_free_units: number;
  effective_days: number;
  warranty_months: number;
  quick_available: boolean;
}

interface ProductDetailResponse {
  product: ProductSummaryCardData & {
    description: string;
    specs: Record<string, string>;
  };
  offers: OfferItem[];
}

interface PriceHistoryResponse {
  sample_label: string;
  current_lowest_paise: number | null;
  reference_30d_paise: number | null;
  show_was_price: boolean;
  history: Array<{
    history_id: string;
    selling_price: number;
    valid_from: string;
    valid_to: string | null;
  }>;
}

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, refreshCartCount, notify, wishlistIds, toggleWishlist, featureFlags } = useApp();

  const [detail, setDetail] = useState<ProductDetailResponse | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryResponse | null>(null);
  const [related, setRelated] = useState<ProductSummaryCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingOfferId, setAddingOfferId] = useState<string | null>(null);
  const [alertTargetRupees, setAlertTargetRupees] = useState('');
  const [alertSaved, setAlertSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      apiRequest<ProductDetailResponse>(`/api/products/${id}`),
      apiRequest<PriceHistoryResponse>(`/api/products/${id}/price-history`),
      apiRequest<{ products: ProductSummaryCardData[] }>(`/api/products/${id}/related`),
    ])
      .then(([det, hist, rel]) => {
        if (!active) return;
        setDetail(det);
        setPriceHistory(hist);
        setRelated(rel.products || []);
      })
      .catch(() => {
        if (active) setError('Product not found or currently unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  const handleAddToCart = async (offer: OfferItem) => {
    if (!token) {
      notify('info', 'Sign in to add dealer offers to your cart.');
      navigate(`/login?next=/products/${id}`);
      return;
    }
    setAddingOfferId(offer.offer_id);
    try {
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: { offer_id: offer.offer_id, quantity: 1 },
      });
      await refreshCartCount();
      notify('success', `Added from ${offer.shop_name} to your cart.`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not add item to cart.');
    } finally {
      setAddingOfferId(null);
    }
  };

  const handleSubscribeAlert = async (type: 'back_in_stock' | 'price_drop') => {
    if (!token) {
      notify('info', 'Sign in to subscribe to product alerts.');
      navigate(`/login?next=/products/${id}`);
      return;
    }
    try {
      await apiRequest('/api/alerts/subscribe', {
        method: 'POST',
        body: {
          product_id: id,
          type,
          ...(type === 'price_drop' && Number(alertTargetRupees) > 0
            ? { price_threshold_paise: Math.round(Number(alertTargetRupees) * 100) }
            : {}),
        },
      });
      setAlertSaved(true);
      notify('success', `Subscribed to ${type === 'price_drop' ? 'price drop' : 'back-in-stock'} alerts.`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not subscribe.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="h-96 bg-white rounded-2xl border border-[#E2E8F0] animate-pulse" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-4">
        <p className="text-base font-semibold text-[#111827]">{error || 'Product not found'}</p>
        <Link to="/search" className="text-sm font-medium text-[#4F46E5] hover:underline">
          Back to Browse &amp; Search
        </Link>
      </div>
    );
  }

  const { product, offers } = detail;
  const isWishlisted = wishlistIds.has(product.product_id);
  const specEntries = Object.entries(product.specs || {});

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-14">
      <div>
        <Link
          to="/search"
          className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#111827]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to catalog</span>
        </Link>
      </div>

      {/* Contiguous Purchase Module */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-6 space-y-4">
          <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-white border border-[#E2E8F0]">
            <img
              src={getCategoryImage(product.category_name)}
              alt={`${product.brand} ${product.name}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>

          {/* 30-Day SAMPLE Price History */}
          {priceHistory && (
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#111827]">
                  <TrendingDown className="w-4 h-4 text-[#4F46E5]" />
                  <span>30-Day Price History</span>
                </div>
                <span className="text-[11px] font-medium text-[#D97706]">SAMPLE DATA</span>
              </div>
              <p className="text-xs text-[#64748B]">{priceHistory.sample_label}</p>
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="rounded-lg bg-[#F8FAFC] p-3">
                  <p className="text-xs text-[#64748B]">Current Best Offer</p>
                  <p className="text-lg font-semibold text-[#111827] tabular-nums mt-0.5">
                    {formatPaise(priceHistory.current_lowest_paise)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#F8FAFC] p-3">
                  <p className="text-xs text-[#64748B]">30-Day Prior Low</p>
                  <p className="text-lg font-semibold text-[#111827] tabular-nums mt-0.5">
                    {formatPaise(priceHistory.reference_30d_paise)}
                  </p>
                </div>
              </div>
              {priceHistory.show_was_price && priceHistory.reference_30d_paise && (
                <p className="text-xs font-medium text-[#16A34A]">
                  Price dropped below prior 30-day reference ({formatPaise(priceHistory.reference_30d_paise)}).
                </p>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 sm:p-8 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[#64748B]">
                  {product.brand} · {product.category_name}
                </p>
                {featureFlags.has('FEATURE_WISHLIST') && (
                  <button
                    type="button"
                    onClick={() => toggleWishlist(product.product_id)}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
                      isWishlisted ? 'text-[#DC2626]' : 'text-[#64748B] hover:text-[#111827]'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isWishlisted ? 'fill-current' : ''}`} />
                    <span>{isWishlisted ? 'Saved' : 'Save'}</span>
                  </button>
                )}
              </div>

              <h1
                className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {product.name}
              </h1>

              <p className="text-sm text-[#64748B] leading-relaxed">{product.description}</p>
            </div>

            <div className="flex flex-wrap items-baseline gap-3 pt-2 border-t border-[#E2E8F0]">
              <span
                className="text-3xl font-bold text-[#111827] tabular-nums"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {formatPaise(product.min_price_paise)}
              </span>
              {priceHistory?.show_was_price && priceHistory.reference_30d_paise && (
                <span className="text-base text-[#64748B] line-through tabular-nums">
                  {formatPaise(priceHistory.reference_30d_paise)}
                </span>
              )}
              <span className="text-xs text-[#64748B] tabular-nums">
                across {product.dealer_count} {product.dealer_count === 1 ? 'dealer' : 'dealers'} ·{' '}
                {product.total_free_units} sellable units
              </span>
            </div>

            {/* Primary CTA: 5-Category Dealer Comparison */}
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <Link
                to={`/products/${product.product_id}/compare`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-5 py-3 text-sm font-semibold text-white transition-colors"
              >
                <Layers className="w-4 h-4" />
                <span>Compare Dealer Offers ({offers.length})</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              {offers[0] && (
                <button
                  type="button"
                  disabled={addingOfferId === offers[0].offer_id}
                  onClick={() => handleAddToCart(offers[0])}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] hover:text-[#4F46E5] px-5 py-3 text-sm font-semibold text-[#111827] transition-colors cursor-pointer"
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span>Quick Add Best Offer</span>
                </button>
              )}
            </div>

            {/* Technical Specifications */}
            {specEntries.length > 0 && (
              <div className="pt-4 border-t border-[#E2E8F0] space-y-2.5">
                <h2 className="text-sm font-semibold text-[#111827]">Key Specifications</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  {specEntries.map(([key, val]) => (
                    <div key={key} className="flex justify-between gap-2 py-1 border-b border-slate-100">
                      <dt className="text-[#64748B] capitalize">{key.replace(/_/g, ' ')}</dt>
                      <dd className="font-medium text-[#111827] text-right">{String(val)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Optional Price Drop / Back in Stock Alert */}
            {featureFlags.has('FEATURE_ALERTS') && (
              <div className="pt-4 border-t border-[#E2E8F0] space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111827]">
                  <Bell className="w-3.5 h-3.5 text-[#4F46E5]" />
                  <span>Price Drop &amp; Restock Alerts</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="Target price (₹)"
                    value={alertTargetRupees}
                    onChange={(e) => setAlertTargetRupees(e.target.value)}
                    className="w-36 rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs text-[#111827] tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => handleSubscribeAlert('price_drop')}
                    className="rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] px-3 py-1.5 text-xs font-medium text-[#111827] cursor-pointer"
                  >
                    Notify Price Drop
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubscribeAlert('back_in_stock')}
                    className="rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] px-3 py-1.5 text-xs font-medium text-[#111827] cursor-pointer"
                  >
                    Back-in-Stock Alert
                  </button>
                  {alertSaved && <span className="text-xs text-[#16A34A] font-medium">Subscribed</span>}
                </div>
              </div>
            )}
          </div>

          {/* Live Dealer Offers Table */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#111827]">Available Dealer Offers</h2>
              <Link
                to={`/products/${product.product_id}/compare`}
                className="text-xs font-medium text-[#4F46E5] hover:underline"
              >
                Open 5-Category Ranking
              </Link>
            </div>

            {offers.length === 0 ? (
              <p className="text-sm text-[#64748B]">Currently out of stock across all dealers.</p>
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {offers.map((offer) => (
                  <div
                    key={offer.offer_id}
                    className="py-3.5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-[#111827]">
                        {offer.shop_name} <span className="text-xs font-normal text-[#64748B]">· {offer.dealer_city}</span>
                      </p>
                      <p className="text-xs text-[#64748B] tabular-nums">
                        {offer.dealer_rating.toFixed(1)} rating ({offer.total_reviews}) ·{' '}
                        {offer.effective_days}d est. · {offer.sellable_free_units} units ·{' '}
                        {offer.warranty_months}m warranty
                        {offer.quick_available && (
                          <span className="text-[#16A34A] font-medium"> · Quick eligible</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-base font-semibold text-[#111827] tabular-nums"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {formatPaise(offer.selling_price)}
                      </span>
                      <button
                        type="button"
                        disabled={addingOfferId === offer.offer_id}
                        onClick={() => handleAddToCart(offer)}
                        className="rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
                      >
                        {addingOfferId === offer.offer_id ? 'Adding...' : 'Add to Cart'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Related Products */}
      {related.length > 0 && (
        <section className="space-y-5">
          <h2
            className="text-xl font-semibold text-[#111827]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Related in {product.category_name}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {related.map((p) => (
              <ProductCard key={p.product_id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
