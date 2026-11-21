import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, ShoppingCart, Truck, Warehouse } from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { getCategoryImage } from '../assets/media';
import { useApp } from '../context/AppContext';

interface RegionalOffer {
  offer_id: string;
  product_id: string;
  product_name: string;
  brand: string;
  category_name: string;
  shop_name: string;
  dealer_city: string;
  dealer_state: string;
  dealer_rating: number;
  total_reviews: number;
  selling_price: number;
  available_units: number;
  fulfilment_note: string;
  holding_city?: string;
  holding_location_name?: string;
  transfer_days_min?: number;
  transfer_days_max?: number;
}

interface OutsideBangaloreResponse {
  section_a_title: string;
  section_b_title: string;
  section_a: RegionalOffer[];
  section_b: RegionalOffer[];
}

export const OutsideBangalorePage: React.FC = () => {
  const navigate = useNavigate();
  const { token, refreshCartCount, notify } = useApp();
  const [data, setData] = useState<OutsideBangaloreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<OutsideBangaloreResponse>('/api/outside-bangalore')
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setError('Could not load Outside Bangalore catalog.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleAdd = async (offer: RegionalOffer) => {
    if (!token) {
      notify('info', 'Sign in to add regional offers to your cart.');
      navigate('/login?next=/outside-bangalore');
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
      notify('error', err instanceof ApiError ? err.message : 'Failed to add item.');
    } finally {
      setAddingId(null);
    }
  };

  const renderGrid = (offers: RegionalOffer[], emptyTitle: string, emptyBody: string) => {
    if (offers.length === 0) {
      return (
        <div className="bg-white rounded-xl border border-dashed border-[#CBD5E1] p-8 text-center space-y-1.5">
          <p className="text-sm font-semibold text-[#111827]">{emptyTitle}</p>
          <p className="text-xs text-[#64748B] max-w-md mx-auto">{emptyBody}</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {offers.map((offer) => (
          <article
            key={offer.offer_id}
            className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden flex flex-col justify-between"
          >
            <div>
              <Link to={`/products/${offer.product_id}`} className="block aspect-[4/3] bg-[#F1F5F9]">
                <img
                  src={getCategoryImage(offer.category_name)}
                  alt={offer.product_name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </Link>
              <div className="p-5 space-y-2">
                <p className="text-xs text-[#64748B]">
                  {offer.brand} · {offer.category_name}
                </p>
                <Link
                  to={`/products/${offer.product_id}`}
                  className="block text-base font-semibold text-[#111827] hover:text-[#4F46E5]"
                >
                  {offer.product_name}
                </Link>
                <p className="text-xs font-medium text-[#111827]">
                  {offer.shop_name} · {offer.dealer_city}, {offer.dealer_state}
                </p>
                <p className="text-xs text-[#64748B] tabular-nums">
                  {offer.dealer_rating.toFixed(1)} rating ({offer.total_reviews}) · {offer.available_units} units available
                </p>
                <p className="text-xs font-medium text-[#4F46E5] pt-1">
                  {offer.fulfilment_note}
                </p>
                {offer.holding_city && (
                  <p className="text-xs text-[#64748B] inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Holding stock: {offer.holding_location_name} ({offer.holding_city})</span>
                  </p>
                )}
              </div>
            </div>

            <div className="px-5 pb-5 pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-3">
              <span
                className="text-lg font-semibold text-[#111827] tabular-nums"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {formatPaise(offer.selling_price)}
              </span>
              <button
                type="button"
                disabled={addingId === offer.offer_id}
                onClick={() => handleAdd(offer)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>{addingId === offer.offer_id ? 'Adding...' : 'Add to Cart'}</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      <div className="max-w-3xl space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#4F46E5]">
          Regional Dealer Network
        </p>
        <h1
          className="text-3xl font-bold text-[#111827] tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Outside Bangalore Offers &amp; Stock Transfers
        </h1>
        <p className="text-sm text-[#64748B] leading-relaxed">
          We separate regional dealer offers into two transparent groups: items already prepositioned in our Bengaluru warehouse for faster dispatch, and offers stocked in another city&rsquo;s holding location that move through our 3-step transfer pipeline (~2–3 days).
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-64 bg-white rounded-2xl border border-[#E2E8F0] animate-pulse" />
      ) : (
        <>
          {/* Section A: In Bangalore stock (faster) */}
          <section className="space-y-4">
            <div className="flex items-center gap-2.5">
              <Warehouse className="w-5 h-5 text-[#16A34A]" />
              <div>
                <h2
                  className="text-xl font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {data?.section_a_title || 'In Bangalore stock (faster)'}
                </h2>
                <p className="text-xs text-[#64748B]">
                  Outside-Bangalore dealers whose inventory is already positioned in Bengaluru for Standard local delivery.
                </p>
              </div>
            </div>
            {renderGrid(
              data?.section_a ?? [],
              'No regional dealer items currently stocked in Bengaluru',
              'Offers from outside-Bangalore dealers with pre-positioned Bengaluru inventory will appear here automatically.'
            )}
          </section>

          {/* Section B: Moved from another stock location (~2-3 days) */}
          <section className="space-y-4">
            <div className="flex items-center gap-2.5">
              <Truck className="w-5 h-5 text-[#D97706]" />
              <div>
                <h2
                  className="text-xl font-semibold text-[#111827]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {data?.section_b_title || 'Moved from another stock location (~2-3 days)'}
                </h2>
                <p className="text-xs text-[#64748B]">
                  Stocked exclusively at a regional holding depot (e.g., Mysuru) — moves through In Transit, Received &amp; QC&rsquo;d, and Allocated steps before final Bengaluru dispatch.
                </p>
              </div>
            </div>
            {renderGrid(
              data?.section_b ?? [],
              'No transfer-only offers available right now',
              'When offers are stocked exclusively in a regional holding depot outside Bengaluru, they are listed here with transfer estimates.'
            )}
          </section>
        </>
      )}
    </div>
  );
};
