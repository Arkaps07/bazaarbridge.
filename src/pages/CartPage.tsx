import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bookmark,
  Clock,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { getCategoryImage } from '../assets/media';
import { useApp } from '../context/AppContext';

export interface CartItemRow {
  cart_item_id: string;
  offer_id: string;
  product_id: string;
  product_name: string;
  brand: string;
  category_name: string;
  shop_name: string;
  dealer_city: string;
  quantity: number;
  price_snapshot: number;
  current_price_paise: number;
  price_changed: boolean;
  line_total_paise: number;
  available_units: number;
  default_location_id: string | null;
  default_location_type: string;
  quick_available: boolean;
  saved_for_later: boolean;
  reservation: {
    reservation_id: string;
    status: string;
    expires_at: string;
    price_paise: number;
    location_id: string;
    quantity: number;
  } | null;
}

interface CartResponse {
  cart_id: string;
  items: CartItemRow[];
  saved_items: CartItemRow[];
  subtotal_paise: number;
}

function formatCountdown(expiresAt: string, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const CartPage: React.FC = () => {
  const { token, refreshCartCount, notify, featureFlags } = useApp();
  const navigate = useNavigate();

  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const loadCart = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiRequest<CartResponse>('/api/cart');
      setCart(data);
      await refreshCartCount();
    } catch {
      notify('error', 'Failed to load cart.');
    } finally {
      setLoading(false);
    }
  }, [token, refreshCartCount, notify]);

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  const updateQty = async (item: CartItemRow, nextQty: number) => {
    if (nextQty < 1 || nextQty > 20) return;
    setBusyId(item.cart_item_id);
    try {
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: {
          cart_item_id: item.cart_item_id,
          offer_id: item.offer_id,
          quantity: nextQty,
        },
      });
      await loadCart();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not update quantity.');
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async (cartItemId: string) => {
    setBusyId(cartItemId);
    try {
      await apiRequest(`/api/cart/items/${cartItemId}`, { method: 'DELETE' });
      notify('info', 'Removed item from cart and released any attached stock hold.');
      await loadCart();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not remove item.');
    } finally {
      setBusyId(null);
    }
  };

  const reserveItem = async (item: CartItemRow) => {
    setBusyId(item.cart_item_id);
    try {
      await apiRequest('/api/cart/reserve', {
        method: 'POST',
        body: {
          cart_item_id: item.cart_item_id,
          offer_id: item.offer_id,
          location_id: item.default_location_id ?? undefined,
          quantity: item.quantity,
          request_key: `cart-res-${item.cart_item_id}-${Date.now()}`,
        },
      });
      notify('success', `Reserved ${item.quantity} unit(s) for 10 minutes.`);
      await loadCart();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OUT_OF_STOCK') {
        notify('error', 'Sorry, this offer is out of stock. Choose another dealer from comparison.');
      } else {
        notify('error', err instanceof ApiError ? err.message : 'Reservation failed.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const releaseHold = async (reservationId: string, cartItemId: string) => {
    setBusyId(cartItemId);
    try {
      await apiRequest('/api/cart/release', {
        method: 'POST',
        body: { reservation_id: reservationId },
      });
      notify('info', 'Stock reservation released.');
      await loadCart();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not release hold.');
    } finally {
      setBusyId(null);
    }
  };

  const saveForLater = async (cartItemId: string) => {
    setBusyId(cartItemId);
    try {
      await apiRequest(`/api/cart/items/${cartItemId}/save-for-later`, { method: 'POST' });
      notify('info', 'Moved to Saved for Later (any active hold released).');
      await loadCart();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not save for later.');
    } finally {
      setBusyId(null);
    }
  };

  const restoreSaved = async (cartItemId: string) => {
    setBusyId(cartItemId);
    try {
      const resp = await apiRequest<{ price_changed: boolean; new_price_paise: number }>(
        `/api/cart/items/${cartItemId}/restore`,
        { method: 'POST' }
      );
      notify(
        'success',
        resp.price_changed
          ? `Restored to cart at updated price ${formatPaise(resp.new_price_paise)}.`
          : 'Restored to active cart.'
      );
      await loadCart();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not restore item.');
    } finally {
      setBusyId(null);
    }
  };

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center space-y-4">
        <ShoppingBag className="w-10 h-10 text-[#64748B] mx-auto" />
        <h1 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: 'var(--font-display)' }}>
          Sign in to view your cart
        </h1>
        <p className="text-sm text-[#64748B]">
          Cart items and atomic 10-minute stock reservations are tied to your customer session.
        </p>
        <Link
          to="/login?next=/cart"
          className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-5 py-2.5 text-sm font-semibold text-white"
        >
          <span>Sign In to Demo Store</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="h-64 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      </div>
    );
  }

  const items = cart?.items ?? [];
  const savedItems = cart?.saved_items ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your Shopping Cart
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            Reserve units atomically for 10 minutes or proceed directly to checkout to hold stock and split fulfilment groups.
          </p>
        </div>
        <Link to="/search" className="text-sm font-medium text-[#4F46E5] hover:underline">
          Continue shopping
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center space-y-3">
          <ShoppingBag className="w-9 h-9 text-[#94A3B8] mx-auto" />
          <p className="text-base font-semibold text-[#111827]">Your cart is empty</p>
          <p className="text-sm text-[#64748B]">
            Explore dealer offers across Quick Hub, Standard Warehouse, and Mysuru Transfer stock.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <Link
              to="/search"
              className="rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Browse Products
            </Link>
            <Link
              to="/products/50000000-0000-4000-8000-000000000001/compare"
              className="rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-[#111827]"
            >
              Compare 5-Dealer Speaker
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Cart Items */}
          <div className="lg:col-span-8 space-y-4">
            {items.map((item) => {
              const activeRes =
                item.reservation &&
                item.reservation.status === 'reserved' &&
                new Date(item.reservation.expires_at).getTime() > nowMs
                  ? item.reservation
                  : null;
              const isBusy = busyId === item.cart_item_id;

              return (
                <article
                  key={item.cart_item_id}
                  className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex flex-col sm:flex-row gap-5"
                >
                  <Link
                    to={`/products/${item.product_id}`}
                    className="w-full sm:w-32 aspect-[4/3] rounded-lg overflow-hidden bg-[#F1F5F9] shrink-0"
                  >
                    <img
                      src={getCategoryImage(item.category_name)}
                      alt={item.product_name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </Link>

                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Link
                          to={`/products/${item.product_id}`}
                          className="text-base font-semibold text-[#111827] hover:text-[#4F46E5]"
                        >
                          {item.product_name}
                        </Link>
                        <p className="text-xs text-[#64748B] mt-0.5">
                          Dealer: <span className="font-medium text-[#111827]">{item.shop_name}</span> ({item.dealer_city}) ·{' '}
                          {item.quick_available ? 'Quick eligible' : item.default_location_type === 'holding' ? 'Regional transfer' : 'Standard'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className="text-lg font-semibold text-[#111827] tabular-nums"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          {formatPaise(item.line_total_paise)}
                        </p>
                        <p className="text-xs text-[#64748B] tabular-nums">
                          {formatPaise(item.current_price_paise)} each
                        </p>
                      </div>
                    </div>

                    {item.price_changed && (
                      <p className="text-xs font-medium text-[#D97706] bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                        Dealer updated price from {formatPaise(item.price_snapshot)} to{' '}
                        {formatPaise(item.current_price_paise)}.
                      </p>
                    )}

                    {/* Reservation Status Bar */}
                    {activeRes ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
                        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
                          <Clock className="w-3.5 h-3.5 text-[#16A34A]" />
                          Reserved ({activeRes.quantity}u) — expires in {formatCountdown(activeRes.expires_at, nowMs)}
                        </span>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => releaseHold(activeRes.reservation_id, item.cart_item_id)}
                          className="font-semibold text-emerald-800 hover:underline cursor-pointer"
                        >
                          Release hold
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 text-xs text-[#64748B]">
                        <span className="tabular-nums">
                          Not yet reserved ({item.available_units} sellable units available)
                        </span>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => reserveItem(item)}
                          className="font-semibold text-[#4F46E5] hover:underline cursor-pointer"
                        >
                          Reserve now (10m)
                        </button>
                      </div>
                    )}

                    {/* Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="inline-flex items-center rounded-lg border border-[#E2E8F0]">
                        <button
                          type="button"
                          disabled={isBusy || item.quantity <= 1}
                          onClick={() => updateQty(item, item.quantity - 1)}
                          aria-label="Decrease quantity"
                          className="p-2 text-[#111827] hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-3 text-sm font-medium text-[#111827] tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={isBusy || item.quantity >= 20}
                          onClick={() => updateQty(item, item.quantity + 1)}
                          aria-label="Increase quantity"
                          className="p-2 text-[#111827] hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        {featureFlags.has('FEATURE_SAVE_LATER') && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => saveForLater(item.cart_item_id)}
                            className="inline-flex items-center gap-1 text-[#64748B] hover:text-[#111827] cursor-pointer"
                          >
                            <Bookmark className="w-3.5 h-3.5" />
                            <span>Save for later</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => removeItem(item.cart_item_id)}
                          className="inline-flex items-center gap-1 text-[#DC2626] hover:underline cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Summary Sidebar */}
          <aside className="lg:col-span-4 bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-5 sticky top-24">
            <h2 className="text-lg font-semibold text-[#111827]">Order Summary</h2>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between text-[#64748B]">
                <span>Items ({items.reduce((a, b) => a + b.quantity, 0)})</span>
                <span className="font-medium text-[#111827] tabular-nums">
                  {formatPaise(cart?.subtotal_paise)}
                </span>
              </div>
              <div className="flex justify-between text-[#64748B]">
                <span>Delivery fees (SAMPLE)</span>
                <span className="text-xs text-[#64748B]">Calculated at checkout by PIN &amp; mode</span>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E2E8F0] flex justify-between items-baseline">
              <span className="text-sm font-semibold text-[#111827]">Estimated Subtotal</span>
              <span
                className="text-2xl font-bold text-[#111827] tabular-nums"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {formatPaise(cart?.subtotal_paise)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => navigate('/checkout')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-5 py-3 text-sm font-semibold text-white transition-colors cursor-pointer"
            >
              <span>Proceed to Checkout</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-2 text-xs text-[#64748B]">
              <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
              <span>
                Checkout atomically reserves every line item before confirming payment (SIMULATED sandbox gateway).
              </span>
            </div>
          </aside>
        </div>
      )}

      {/* Saved for Later */}
      {featureFlags.has('FEATURE_SAVE_LATER') && savedItems.length > 0 && (
        <section className="space-y-4 pt-6 border-t border-[#E2E8F0]">
          <h2 className="text-lg font-semibold text-[#111827]">Saved for Later ({savedItems.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {savedItems.map((item) => (
              <div
                key={item.cart_item_id}
                className="bg-white rounded-xl border border-[#E2E8F0] p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm font-semibold text-[#111827]">{item.product_name}</p>
                  <p className="text-xs text-[#64748B]">
                    {item.shop_name} · {formatPaise(item.current_price_paise)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => restoreSaved(item.cart_item_id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] px-3 py-1.5 text-xs font-medium text-[#111827] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Move to Cart</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
