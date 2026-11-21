import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
  Tag,
  Truck,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { useApp } from '../context/AppContext';
import type { CartItemRow } from './CartPage';

interface PinCheckResponse {
  pin_code: string;
  quick_available: boolean;
  standard_available: boolean;
  hub_id: string | null;
  hub_location_id: string | null;
  hub_name: string | null;
  reason: string;
  quick_eta?: { eta_basis: { label: string } } | null;
  standard_eta?: { eta_basis: { label: string } };
  transfer_eta?: { eta_basis: { label: string } };
  sample_fees: {
    quick_paise: number;
    standard_paise: number;
    transfer_paise: number;
    free_standard_threshold_paise: number;
  };
}

interface AddressRow {
  address_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  pin_code: string;
  is_default: boolean;
}

interface ReservedEntry {
  cart_item_id: string;
  offer_id: string;
  quantity: number;
  reservation_id: string;
  price_paise: number;
  location_id: string;
  expires_at: string;
}

export const CheckoutPage: React.FC = () => {
  const { token, refreshCartCount, notify, featureFlags } = useApp();
  const navigate = useNavigate();

  const [cartItems, setCartItems] = useState<CartItemRow[]>([]);
  const [reservations, setReservations] = useState<Record<string, ReservedEntry>>({});
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState(false);

  // Delivery address & PIN state
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [recipientName, setRecipientName] = useState('Aarav Mehta');
  const [line1, setLine1] = useState('42, 4th Block Koramangala');
  const [city, setCity] = useState('Bengaluru');
  const [pinCode, setPinCode] = useState('560034');
  const [pinCheck, setPinCheck] = useState<PinCheckResponse | null>(null);
  const [pinChecking, setPinChecking] = useState(false);

  // Per-reservation mode preference (allows Quick -> Standard customer downgrade)
  const [modePrefs, setModePrefs] = useState<Record<string, 'quick' | 'standard'>>({});

  // Coupons (FEATURE_COUPONS)
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount_paise: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Placement & PRICE_CHANGED recovery
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [priceChangedPayload, setPriceChangedPayload] = useState<{
    message: string;
    old_price?: number;
    new_price?: number;
  } | null>(null);

  const checkPin = useCallback(async (pin: string) => {
    if (!/^\d{6}$/.test(pin)) return;
    setPinChecking(true);
    try {
      const resp = await apiRequest<PinCheckResponse>('/api/check-pin', {
        method: 'POST',
        body: { pin_code: pin },
      });
      setPinCheck(resp);
    } catch {
      setPinCheck(null);
    } finally {
      setPinChecking(false);
    }
  }, []);

  const ensureReservationsForCart = useCallback(
    async (items: CartItemRow[]) => {
      setReserving(true);
      const nextMap: Record<string, ReservedEntry> = {};
      const nextPrefs: Record<string, 'quick' | 'standard'> = {};

      try {
        for (const item of items) {
          const validExisting =
            item.reservation &&
            item.reservation.status === 'reserved' &&
            new Date(item.reservation.expires_at).getTime() > Date.now() + 15_000;

          if (validExisting && item.reservation) {
            nextMap[item.cart_item_id] = {
              cart_item_id: item.cart_item_id,
              offer_id: item.offer_id,
              quantity: item.quantity,
              reservation_id: item.reservation.reservation_id,
              price_paise: item.reservation.price_paise,
              location_id: item.reservation.location_id,
              expires_at: item.reservation.expires_at,
            };
            nextPrefs[item.reservation.reservation_id] = item.quick_available ? 'quick' : 'standard';
          } else {
            const resp = await apiRequest<{
              reservation_id: string;
              expires_at: string;
              price_paise: number;
              location_id: string;
            }>('/api/cart/reserve', {
              method: 'POST',
              body: {
                cart_item_id: item.cart_item_id,
                offer_id: item.offer_id,
                location_id: item.default_location_id ?? undefined,
                quantity: item.quantity,
                request_key: `chk-${item.cart_item_id}-${Date.now()}`,
              },
            });
            nextMap[item.cart_item_id] = {
              cart_item_id: item.cart_item_id,
              offer_id: item.offer_id,
              quantity: item.quantity,
              reservation_id: resp.reservation_id,
              price_paise: resp.price_paise,
              location_id: resp.location_id,
              expires_at: resp.expires_at,
            };
            nextPrefs[resp.reservation_id] = item.quick_available ? 'quick' : 'standard';
          }
        }
        setReservations(nextMap);
        setModePrefs((prev) => ({ ...nextPrefs, ...prev }));
      } catch (err) {
        if (err instanceof ApiError && err.code === 'OUT_OF_STOCK') {
          setCheckoutError(
            'One of your cart items just went out of stock. Return to cart or choose another dealer from comparison.'
          );
        } else {
          setCheckoutError(err instanceof ApiError ? err.message : 'Could not reserve cart stock.');
        }
      } finally {
        setReserving(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const cartData = await apiRequest<{ items: CartItemRow[] }>('/api/cart');
        if (!active) return;
        setCartItems(cartData.items || []);
        if (cartData.items.length > 0) {
          await ensureReservationsForCart(cartData.items);
        }
        if (featureFlags.has('FEATURE_ADDRESSES')) {
          const addrRes = await apiRequest<{ addresses: AddressRow[] }>('/api/addresses');
          if (active && addrRes.addresses.length > 0) {
            setAddresses(addrRes.addresses);
            const def = addrRes.addresses.find((a) => a.is_default) || addrRes.addresses[0];
            setRecipientName(def.recipient_name);
            setLine1(def.line1);
            setCity(def.city);
            setPinCode(def.pin_code);
            await checkPin(def.pin_code);
          } else {
            await checkPin('560034');
          }
        } else {
          await checkPin('560034');
        }
      } catch {
        if (active) setCheckoutError('Unable to initialize checkout.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, featureFlags, ensureReservationsForCart, checkPin]);

  const itemsTotalPaise = cartItems.reduce((acc, item) => {
    const res = reservations[item.cart_item_id];
    const unitPrice = res ? res.price_paise : item.current_price_paise;
    return acc + unitPrice * item.quantity;
  }, 0);

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError(null);
    if (!couponInput.trim()) return;
    try {
      const resp = await apiRequest<{ valid: boolean; code: string; discount_paise: number }>(
        '/api/coupons/validate',
        {
          method: 'POST',
          body: { code: couponInput.trim(), basket_total_paise: itemsTotalPaise },
        }
      );
      setAppliedCoupon({ code: resp.code, discount_paise: resp.discount_paise });
      notify('success', `Coupon ${resp.code} applied (-${formatPaise(resp.discount_paise)}).`);
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(err instanceof ApiError ? err.message : 'Invalid coupon code.');
    }
  };

  const submitOrder = async (overrideReservationIds?: string[]) => {
    setCheckoutError(null);
    setPriceChangedPayload(null);
    const resIds =
      overrideReservationIds ??
      cartItems.map((i) => reservations[i.cart_item_id]?.reservation_id).filter(Boolean);

    if (resIds.length === 0) {
      setCheckoutError('No active reservations to place order.');
      return;
    }

    setPlacing(true);
    try {
      const orderResp = await apiRequest<{ order_id: string }>('/api/orders', {
        method: 'POST',
        body: {
          reservation_ids: resIds,
          address: {
            pin_code: pinCode.trim(),
            recipient_name: recipientName.trim(),
            line1: line1.trim(),
            city: city.trim(),
          },
          mode_preferences: modePrefs,
          ...(appliedCoupon ? { coupon_code: appliedCoupon.code } : {}),
        },
      });
      await refreshCartCount();
      notify('success', 'Order placed successfully! Tracking live fulfilment groups.');
      navigate(`/orders/${orderResp.order_id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PRICE_CHANGED') {
        setPriceChangedPayload({
          message: err.message,
          old_price: Number(err.payload.old_price || 0) || undefined,
          new_price: Number(err.payload.new_price || 0) || undefined,
        });
      } else if (err instanceof ApiError && err.code === 'RESERVATION_EXPIRED') {
        setCheckoutError('One of your 10-minute stock holds expired. Refreshing holds now...');
        const refreshed = await apiRequest<{ items: CartItemRow[] }>('/api/cart');
        setCartItems(refreshed.items || []);
        await ensureReservationsForCart(refreshed.items || []);
      } else {
        setCheckoutError(err instanceof ApiError ? err.message : 'Order placement failed.');
      }
    } finally {
      setPlacing(false);
    }
  };

  // v7.2 PRICE_CHANGED recovery: Release old hold FIRST, then re-reserve, then retry order!
  const handlePriceChangedRecovery = async () => {
    setPlacing(true);
    setCheckoutError(null);
    try {
      const existingEntries = Object.values(reservations);
      for (const entry of existingEntries) {
        await apiRequest('/api/cart/release', {
          method: 'POST',
          body: { reservation_id: entry.reservation_id },
        });
      }
      const freshCart = await apiRequest<{ items: CartItemRow[] }>('/api/cart');
      setCartItems(freshCart.items);
      const newIds: string[] = [];
      const newMap: Record<string, ReservedEntry> = {};

      for (const item of freshCart.items) {
        const r = await apiRequest<{
          reservation_id: string;
          expires_at: string;
          price_paise: number;
          location_id: string;
        }>('/api/cart/reserve', {
          method: 'POST',
          body: {
            cart_item_id: item.cart_item_id,
            offer_id: item.offer_id,
            location_id: item.default_location_id ?? undefined,
            quantity: item.quantity,
            request_key: `re-res-${item.cart_item_id}-${Date.now()}`,
          },
        });
        newIds.push(r.reservation_id);
        newMap[item.cart_item_id] = {
          cart_item_id: item.cart_item_id,
          offer_id: item.offer_id,
          quantity: item.quantity,
          reservation_id: r.reservation_id,
          price_paise: r.price_paise,
          location_id: r.location_id,
          expires_at: r.expires_at,
        };
      }
      setReservations(newMap);
      setPriceChangedPayload(null);
      await submitOrder(newIds);
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? err.message : 'Could not re-reserve at updated price.');
      setPlacing(false);
    }
  };

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-lg font-semibold text-[#111827]">Sign in to continue checkout</p>
        <Link to="/login?next=/checkout" className="inline-block rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="h-80 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-lg font-semibold text-[#111827]">No items in cart for checkout</p>
        <Link to="/search" className="inline-block rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white">
          Browse Catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div>
        <Link to="/cart" className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#111827]">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Cart</span>
        </Link>
        <h1
          className="text-3xl font-bold text-[#111827] tracking-tight mt-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Checkout &amp; Hybrid Fulfilment
        </h1>
      </div>

      {checkoutError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">
          {checkoutError}
        </div>
      )}

      {priceChangedPayload && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5 space-y-3">
          <div className="flex items-start gap-2.5 text-amber-950">
            <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">Offer Price Updated Since Hold</p>
              <p className="text-xs text-amber-900">
                {priceChangedPayload.message}{' '}
                {priceChangedPayload.old_price && priceChangedPayload.new_price && (
                  <span>
                    ({formatPaise(priceChangedPayload.old_price)} → {formatPaise(priceChangedPayload.new_price)})
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={placing}
            onClick={handlePriceChangedRecovery}
            className="rounded-lg bg-[#D97706] hover:bg-amber-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Release Old Hold, Re-Reserve &amp; Place Order at Updated Price
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-6">
          {/* Step 1: Delivery Address & PIN Check */}
          <section className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-5">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-[#4F46E5]" />
              <h2 className="text-lg font-semibold text-[#111827]">1. Delivery Address &amp; PIN Serviceability</h2>
            </div>

            {addresses.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {addresses.map((addr) => {
                  const selected = pinCode === addr.pin_code && line1 === addr.line1;
                  return (
                    <button
                      key={addr.address_id}
                      type="button"
                      onClick={() => {
                        setRecipientName(addr.recipient_name);
                        setLine1(addr.line1);
                        setCity(addr.city);
                        setPinCode(addr.pin_code);
                        checkPin(addr.pin_code);
                      }}
                      className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#4F46E5] bg-indigo-50/50'
                          : 'border-[#E2E8F0] hover:border-slate-300'
                      }`}
                    >
                      <p className="text-xs font-semibold text-[#111827]">
                        {addr.label} · {addr.pin_code}
                      </p>
                      <p className="text-xs text-[#64748B] mt-0.5 truncate">{addr.line1}, {addr.city}</p>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="chk-recipient" className="block text-xs font-medium text-[#111827] mb-1">
                  Recipient name
                </label>
                <input
                  id="chk-recipient"
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#111827]"
                />
              </div>
              <div>
                <label htmlFor="chk-pin" className="block text-xs font-medium text-[#111827] mb-1">
                  Delivery PIN code (Try 560034 for Quick Hub, or 560001 for Standard)
                </label>
                <div className="flex gap-2">
                  <input
                    id="chk-pin"
                    type="text"
                    maxLength={6}
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-mono text-[#111827]"
                  />
                  <button
                    type="button"
                    disabled={pinChecking || pinCode.length !== 6}
                    onClick={() => checkPin(pinCode)}
                    className="rounded-lg border border-[#4F46E5] text-[#4F46E5] hover:bg-indigo-50 px-3.5 py-2 text-xs font-semibold cursor-pointer"
                  >
                    {pinChecking ? 'Checking...' : 'Check PIN'}
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="chk-line1" className="block text-xs font-medium text-[#111827] mb-1">
                  Street address
                </label>
                <input
                  id="chk-line1"
                  type="text"
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#111827]"
                />
              </div>
            </div>

            {pinCheck && (
              <div
                className={`rounded-xl border p-4 text-xs space-y-1 ${
                  pinCheck.quick_available
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    : 'border-slate-200 bg-[#F8FAFC] text-[#111827]'
                }`}
              >
                <p className="font-semibold inline-flex items-center gap-1.5">
                  <CheckCircle2 className={`w-4 h-4 ${pinCheck.quick_available ? 'text-[#16A34A]' : 'text-[#64748B]'}`} />
                  <span>{pinCheck.reason}</span>
                </p>
                <p className="text-[#64748B]">
                  SAMPLE Delivery Fees: Quick {formatPaise(pinCheck.sample_fees.quick_paise)} · Standard{' '}
                  {formatPaise(pinCheck.sample_fees.standard_paise)} (Free at{' '}
                  {formatPaise(pinCheck.sample_fees.free_standard_threshold_paise)}+) · Transfer{' '}
                  {formatPaise(pinCheck.sample_fees.transfer_paise)}
                </p>
              </div>
            )}
          </section>

          {/* Step 2: Reserved Items & Fulfilment Mode Preferences */}
          <section className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-[#4F46E5]" />
                <h2 className="text-lg font-semibold text-[#111827]">2. Fulfilment Mode &amp; Atomic Holds</h2>
              </div>
              {reserving && <span className="text-xs text-[#4F46E5]">Locking stock...</span>}
            </div>

            <div className="divide-y divide-[#E2E8F0]">
              {cartItems.map((item) => {
                const res = reservations[item.cart_item_id];
                const isTransfer = item.default_location_type === 'holding';
                const canQuick = Boolean(pinCheck?.quick_available && item.quick_available && !isTransfer);
                const selectedMode = res ? modePrefs[res.reservation_id] || (canQuick ? 'quick' : 'standard') : 'standard';

                return (
                  <div key={item.cart_item_id} className="py-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#111827]">
                          {item.product_name} × {item.quantity}
                        </p>
                        <p className="text-xs text-[#64748B]">
                          {item.shop_name} ({item.dealer_city})
                          {res && (
                            <span className="text-[#16A34A] font-medium">
                              {' '}
                              · Held atomically until {new Date(res.expires_at).toLocaleTimeString()}
                            </span>
                          )}
                        </p>
                      </div>
                      <span
                        className="text-sm font-semibold text-[#111827] tabular-nums"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {formatPaise((res?.price_paise ?? item.current_price_paise) * item.quantity)}
                      </span>
                    </div>

                    {isTransfer ? (
                      <p className="text-xs text-[#D97706] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Inter-City Transfer Group: Stock moves from regional depot to Bengaluru before dispatch (~2–3 days, SAMPLE fee {formatPaise(pinCheck?.sample_fees.transfer_paise ?? 6900)}).
                      </p>
                    ) : canQuick && res ? (
                      <div className="flex flex-wrap gap-3">
                        <label
                          className={`flex-1 min-w-[200px] rounded-lg border p-3 text-xs cursor-pointer ${
                            selectedMode === 'quick'
                              ? 'border-[#4F46E5] bg-indigo-50/60'
                              : 'border-[#E2E8F0]'
                          }`}
                        >
                          <div className="flex items-center gap-2 font-semibold text-[#111827]">
                            <input
                              type="radio"
                              name={`mode-${res.reservation_id}`}
                              checked={selectedMode === 'quick'}
                              onChange={() =>
                                setModePrefs((p) => ({ ...p, [res.reservation_id]: 'quick' }))
                              }
                            />
                            <span>Quick Local Hub ({formatPaise(pinCheck?.sample_fees.quick_paise ?? 4900)})</span>
                          </div>
                          <p className="text-[#64748B] mt-1 pl-5">
                            {pinCheck?.quick_eta?.eta_basis.label || 'Same-day local hub window'}
                          </p>
                        </label>

                        <label
                          className={`flex-1 min-w-[200px] rounded-lg border p-3 text-xs cursor-pointer ${
                            selectedMode === 'standard'
                              ? 'border-[#4F46E5] bg-indigo-50/60'
                              : 'border-[#E2E8F0]'
                          }`}
                        >
                          <div className="flex items-center gap-2 font-semibold text-[#111827]">
                            <input
                              type="radio"
                              name={`mode-${res.reservation_id}`}
                              checked={selectedMode === 'standard'}
                              onChange={() =>
                                setModePrefs((p) => ({ ...p, [res.reservation_id]: 'standard' }))
                              }
                            />
                            <span>Downgrade to Standard ({formatPaise(pinCheck?.sample_fees.standard_paise ?? 2900)} / Free ≥₹999)</span>
                          </div>
                          <p className="text-[#64748B] mt-1 pl-5">
                            {pinCheck?.standard_eta?.eta_basis.label || 'Standard Bengaluru warehouse (1–2 days)'}
                          </p>
                        </label>
                      </div>
                    ) : (
                      <p className="text-xs text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
                        Standard Fulfilment ({pinCheck?.standard_eta?.eta_basis.label || '1–2 days'}) — Quick hub unavailable for this item or PIN code.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Summary & Sandbox Payment */}
        <aside className="lg:col-span-4 bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-5 sticky top-24">
          <h2 className="text-lg font-semibold text-[#111827]">3. Review &amp; Confirm</h2>

          {featureFlags.has('FEATURE_COUPONS') && (
            <form onSubmit={handleApplyCoupon} className="space-y-2">
              <label htmlFor="coupon-code" className="block text-xs font-medium text-[#111827]">
                Promo Coupon (Try <span className="font-mono">WELCOME100</span> or <span className="font-mono">SAVE10</span>)
              </label>
              <div className="flex gap-2">
                <input
                  id="coupon-code"
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Enter code"
                  className="flex-1 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-mono text-[#111827]"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] px-3 py-2 text-xs font-semibold text-[#111827] cursor-pointer"
                >
                  Apply
                </button>
              </div>
              {appliedCoupon && (
                <p className="text-xs text-[#16A34A] inline-flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5" />
                  <span>
                    {appliedCoupon.code} applied (-{formatPaise(appliedCoupon.discount_paise)})
                  </span>
                </p>
              )}
              {couponError && <p className="text-xs text-[#DC2626]">{couponError}</p>}
            </form>
          )}

          <div className="space-y-2 text-sm border-t border-[#E2E8F0] pt-4">
            <div className="flex justify-between text-[#64748B]">
              <span>Reserved Items Subtotal</span>
              <span className="font-medium text-[#111827] tabular-nums">{formatPaise(itemsTotalPaise)}</span>
            </div>
            {appliedCoupon && (
              <div className="flex justify-between text-[#16A34A]">
                <span>Coupon ({appliedCoupon.code})</span>
                <span className="font-medium tabular-nums">-{formatPaise(appliedCoupon.discount_paise)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#64748B]">
              <span>Fulfilment Fees (SAMPLE)</span>
              <span className="text-xs">Authoritative backend split</span>
            </div>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-950 space-y-1">
            <p className="font-semibold">SIMULATED Sandbox Payment</p>
            <p>
              Confirming places a real PostgreSQL order, splits fulfilment groups, and publishes transactional outbox events with a simulated sandbox UPI record (no real charge).
            </p>
          </div>

          <button
            type="button"
            disabled={placing || reserving || Object.keys(reservations).length === 0}
            onClick={() => submitOrder()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-5 py-3 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{placing ? 'Placing Order...' : 'Place Order (Simulated Payment)'}</span>
          </button>

          <p className="text-[11px] text-[#64748B] flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Final totals, ETA ranges, and OTP hashes are computed atomically on the server.</span>
          </p>
        </aside>
      </div>
    </div>
  );
};
