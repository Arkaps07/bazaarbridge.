import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  Clock,
  Package,
  ShoppingCart,
  Star,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { useApp } from '../context/AppContext';

type ComparisonTab = 'budget' | 'fastest' | 'rated' | 'value' | 'available';

interface RankedOffer {
  offer_id: string;
  dealer_id: string;
  shop_name: string;
  dealer_city: string;
  dealer_state: string;
  dealer_rating: number;
  total_reviews: number;
  selling_price: number;
  effective_days: number;
  sellable_free_units: number;
  warranty_months: number;
  quick_available: boolean;
  reason: string;
  value_score?: number;
}

interface ComparisonResponse {
  product_id: string;
  product_name: string;
  category: ComparisonTab;
  winner: RankedOffer | null;
  offers: RankedOffer[];
}

const TABS: Array<{ id: ComparisonTab; label: string; subtitle: string; icon: React.ReactNode }> = [
  { id: 'budget', label: 'Best Budget', subtitle: 'Lowest selling price', icon: <Tag className="w-4 h-4" /> },
  { id: 'fastest', label: 'Fastest Delivery', subtitle: 'Shortest delivery time', icon: <Clock className="w-4 h-4" /> },
  { id: 'rated', label: 'Best Rated Dealer', subtitle: 'Highest rating & reviews', icon: <Star className="w-4 h-4" /> },
  { id: 'value', label: 'Best Value', subtitle: '45/25/20/10 weighted score', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'available', label: 'Most Available', subtitle: 'Highest sellable stock', icon: <Package className="w-4 h-4" /> },
];

export const DealerComparisonPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, refreshCartCount, notify } = useApp();

  const [activeTab, setActiveTab] = useState<ComparisonTab>('budget');
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError(null);
    apiRequest<ComparisonResponse>(`/api/products/${id}/offers?category=${activeTab}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setError('Could not load dealer comparison offers.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, activeTab]);

  const handleAddToCart = async (offer: RankedOffer) => {
    if (!token) {
      notify('info', 'Sign in to add this dealer offer to your cart.');
      navigate(`/login?next=/products/${id}/compare`);
      return;
    }
    setAddingId(offer.offer_id);
    try {
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: { offer_id: offer.offer_id, quantity: 1 },
      });
      await refreshCartCount();
      notify('success', `Added ${offer.shop_name} offer (${formatPaise(offer.selling_price)}) to cart.`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Failed to add offer to cart.');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            to={`/products/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#111827]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to product details</span>
          </Link>
          <h1
            className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {data?.product_name ? `Compare Dealers — ${data.product_name}` : 'Compare Dealer Offers'}
          </h1>
          <p className="text-sm text-[#64748B]">
            Switch across all 5 backend-ranked comparison dimensions. Every ranking reason below is generated directly by the API from live offer data.
          </p>
        </div>
      </div>

      {/* 5 Comparison Category Tabs */}
      <div
        role="tablist"
        aria-label="Dealer comparison categories"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
                selected
                  ? 'border-[#4F46E5] bg-indigo-50/70 text-[#111827] shadow-xs'
                  : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300 hover:text-[#111827]'
              }`}
            >
              <div className={`inline-flex items-center gap-2 text-sm font-semibold ${selected ? 'text-[#4F46E5]' : 'text-[#111827]'}`}>
                {tab.icon}
                <span>{tab.label}</span>
              </div>
              <p className="text-xs text-[#64748B] mt-1">{tab.subtitle}</p>
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="h-44 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
          <div className="h-64 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
        </div>
      ) : !data || data.offers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-[#64748B]">
          No in-stock dealer offers are currently available for this product.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Highlighted Winner Card */}
          {data.winner && (
            <div className="bg-white rounded-2xl border-2 border-[#4F46E5] p-6 sm:p-8 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-2.5">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#4F46E5]">
                    <Award className="w-4 h-4" />
                    <span>#1 Winner — {TABS.find((t) => t.id === activeTab)?.label}</span>
                  </div>
                  <h2
                    className="text-2xl font-bold text-[#111827]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {data.winner.shop_name}{' '}
                    <span className="text-sm font-normal text-[#64748B]">
                      · {data.winner.dealer_city}, {data.winner.dealer_state}
                    </span>
                  </h2>
                  {/* VERBATIM backend reason string */}
                  <p className="text-sm font-medium text-[#111827] bg-indigo-50/70 border border-indigo-100 rounded-lg px-3.5 py-2 inline-block">
                    {data.winner.reason}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B] tabular-nums pt-1">
                    <span>Rating: {data.winner.dealer_rating.toFixed(1)}/5 ({data.winner.total_reviews} reviews)</span>
                    <span aria-hidden="true">·</span>
                    <span>Est. delivery: {data.winner.effective_days} {data.winner.effective_days === 1 ? 'day' : 'days'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Sellable stock: {data.winner.sellable_free_units} units</span>
                    <span aria-hidden="true">·</span>
                    <span>{data.winner.warranty_months}-month warranty</span>
                    {data.winner.quick_available && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#16A34A] font-medium">Quick Delivery Eligible</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between gap-3 shrink-0">
                  <div className="text-left lg:text-right">
                    <p className="text-xs text-[#64748B]">Offer Price</p>
                    <p
                      className="text-3xl font-bold text-[#111827] tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatPaise(data.winner.selling_price)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={addingId === data.winner.offer_id}
                    onClick={() => handleAddToCart(data.winner!)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-5 py-3 text-sm font-semibold text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    <span>{addingId === data.winner.offer_id ? 'Adding...' : 'Add Winning Offer'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Full Ranked Dealer Table */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#111827]">
                All Ranked Dealers ({data.offers.length})
              </h3>
              <span className="text-xs text-[#64748B]">Sorted by {TABS.find((t) => t.id === activeTab)?.label}</span>
            </div>

            <div className="divide-y divide-[#E2E8F0]">
              {data.offers.map((offer, idx) => (
                <div
                  key={offer.offer_id}
                  className="p-5 sm:px-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 text-[#111827] text-xs font-semibold flex items-center justify-center tabular-nums shrink-0 mt-0.5">
                      #{idx + 1}
                    </span>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <p className="text-base font-semibold text-[#111827]">{offer.shop_name}</p>
                        <span className="text-xs text-[#64748B]">
                          · {offer.dealer_city}, {offer.dealer_state}
                        </span>
                        {offer.quick_available && (
                          <span className="text-xs font-medium text-[#16A34A]">· Quick eligible</span>
                        )}
                      </div>
                      {/* Display backend reason verbatim */}
                      <p className="text-sm text-[#111827]">{offer.reason}</p>
                      <p className="text-xs text-[#64748B] tabular-nums">
                        {offer.dealer_rating.toFixed(1)} rating ({offer.total_reviews} reviews) ·{' '}
                        {offer.effective_days} {offer.effective_days === 1 ? 'day' : 'days'} delivery ·{' '}
                        {offer.sellable_free_units} free units · {offer.warranty_months}m warranty
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between lg:justify-end gap-4 pl-11 lg:pl-0 shrink-0">
                    <span
                      className="text-xl font-semibold text-[#111827] tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatPaise(offer.selling_price)}
                    </span>
                    <button
                      type="button"
                      disabled={addingId === offer.offer_id}
                      onClick={() => handleAddToCart(offer)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#4F46E5] text-[#4F46E5] hover:bg-[#4F46E5] hover:text-white disabled:opacity-60 px-4 py-2 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>{addingId === offer.offer_id ? 'Adding...' : 'Add to Cart'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
