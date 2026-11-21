import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  KeyRound,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise, usePolling } from '../kit';
import { useApp } from '../context/AppContext';

interface RefundRow {
  refund_id: string;
  item_amount: number;
  fee_amount: number;
  status: string;
  gateway_ref: string | null;
}

interface OrderItemDetail {
  order_item_id: string;
  group_id: string;
  product_name: string;
  shop_name: string;
  quantity: number;
  unit_price: number;
  paid_amount: number;
  delivery_fee_share: number;
  item_status: string;
  stock_finalised: boolean;
  cancellable: boolean;
  transfer: {
    transfer_id: string;
    status: string;
    cancel_on_receipt: boolean;
    from_location_name: string;
    to_location_name: string;
  } | null;
  refunds: RefundRow[];
}

interface TimelineEntry {
  timeline_id?: string;
  event_id?: string;
  event_type: string;
  note: string | null;
  created_at: string;
}

interface GroupDetail {
  group_id: string;
  location_name: string;
  location_city: string;
  mode: 'quick' | 'standard' | 'transfer';
  status: string;
  fee_total: number;
  eta_window_start: string;
  eta_window_end: string;
  eta_basis: { label?: string };
  cancellable: boolean;
  timeline: TimelineEntry[];
  delivery_otp?: string;
  delivery_otp_label?: string;
}

interface OrderDetailResponse {
  order: {
    order_id: string;
    placed_at: string;
    items_total: number;
    discount_total: number;
    delivery_fee_total: number;
    total_amount: number;
    coupon_code: string | null;
    delivery_address?: { recipient_name?: string; line1?: string; city?: string; pin_code?: string };
  };
  payment: {
    method: string;
    status: string;
    gateway_ref: string;
    simulated_notice: string;
  } | null;
  items: OrderItemDetail[];
  groups: GroupDetail[];
}

const TRANSFER_STEPS = ['requested', 'in_transit', 'received_checked', 'allocated'];

export const OrderTrackingPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { token, notify } = useApp();

  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    if (!id || !token) return;
    try {
      const resp = await apiRequest<OrderDetailResponse>(`/api/orders/${id}`);
      setData(resp);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load order details.');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Poll every 5s so Admin Simulator transitions show up live on customer screen
  usePolling(loadOrder, 5000, Boolean(token && id));

  const handleCancelItem = async (item: OrderItemDetail) => {
    if (!id) return;
    setCancellingId(item.order_item_id);
    setCancelNotice(null);
    try {
      await apiRequest(`/api/orders/${id}/items/${item.order_item_id}/cancel`, {
        method: 'POST',
        body: {
          request_key: `cancel-${item.order_item_id}`,
          reason_code: 'customer_requested',
        },
      });
      notify('success', `Cancelled ${item.product_name}. Refund requested.`);
      await loadOrder();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_CANCELLED_OR_TOO_LATE') {
        setCancelNotice('Already dispatched or cancelled — this item can no longer be cancelled.');
      } else {
        notify('error', err instanceof ApiError ? err.message : 'Cancellation failed.');
      }
      await loadOrder();
    } finally {
      setCancellingId(null);
    }
  };

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-base font-semibold text-[#111827]">Sign in to view this order</p>
        <Link to={`/login?next=/orders/${id}`} className="inline-block rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="h-72 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-3">
        <p className="text-base font-semibold text-[#DC2626]">{error || 'Order not found'}</p>
        <Link to="/orders" className="text-sm font-medium text-[#4F46E5] hover:underline">
          Back to Orders
        </Link>
      </div>
    );
  }

  const { order, payment, items, groups } = data;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/orders" className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#111827]">
            <ArrowLeft className="w-4 h-4" />
            <span>All Orders</span>
          </Link>
          <h1
            className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight mt-1 font-mono"
          >
            Order #{order.order_id.slice(0, 8).toUpperCase()}
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            Placed {new Date(order.placed_at).toLocaleString()} · Delivering to{' '}
            {order.delivery_address?.line1 || 'Bengaluru'}
            {order.delivery_address?.pin_code ? ` (${order.delivery_address.pin_code})` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={loadOrder}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:border-[#4F46E5] px-3.5 py-2 text-xs font-medium text-[#111827] cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh status</span>
        </button>
      </div>

      {cancelNotice && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          {cancelNotice}
        </div>
      )}

      {/* Payment & Totals Banner */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-[#64748B]">Items Total</p>
          <p className="text-base font-semibold text-[#111827] tabular-nums mt-0.5">{formatPaise(order.items_total)}</p>
        </div>
        <div>
          <p className="text-xs text-[#64748B]">Delivery Fees (SAMPLE)</p>
          <p className="text-base font-semibold text-[#111827] tabular-nums mt-0.5">
            {formatPaise(order.delivery_fee_total)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#64748B]">Grand Total</p>
          <p className="text-lg font-bold text-[#111827] tabular-nums mt-0.5" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatPaise(order.total_amount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#64748B]">Payment Status</p>
          <p className="text-xs font-semibold text-[#16A34A] mt-1">{payment?.status?.toUpperCase() || 'SUCCESSFUL'}</p>
          <p className="text-[11px] text-[#D97706] mt-0.5">{payment?.simulated_notice || 'SIMULATED sandbox payment'}</p>
        </div>
      </div>

      {/* Independent Fulfilment Groups */}
      <div className="space-y-6">
        {groups.map((group, idx) => {
          const groupItems = items.filter((i) => i.group_id === group.group_id);

          return (
            <section
              key={group.group_id}
              className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-[#4F46E5]" />
                    <h2 className="text-base font-semibold text-[#111827]">
                      Shipment Group {idx + 1} · {group.mode.toUpperCase()} ({group.location_name})
                    </h2>
                  </div>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    Status: <span className="font-semibold text-[#111827]">{group.status.replace(/_/g, ' ')}</span> ·{' '}
                    Fee: {formatPaise(group.fee_total)} · ETA: {group.eta_basis?.label || 'Scheduled'} (
                    {new Date(group.eta_window_start).toLocaleDateString()} –{' '}
                    {new Date(group.eta_window_end).toLocaleDateString()})
                  </p>
                </div>

                {/* Owning Customer Delivery OTP Card */}
                {group.delivery_otp && (
                  <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-2.5 text-right">
                    <p className="text-[11px] font-semibold text-[#4F46E5] inline-flex items-center gap-1">
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>SAMPLE DEMO OTP</span>
                    </p>
                    <p
                      className="text-xl font-bold tracking-widest text-[#111827] tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {group.delivery_otp}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-6 space-y-6">
                {/* Items in this Group */}
                <div className="divide-y divide-[#E2E8F0]">
                  {groupItems.map((item) => (
                    <div key={item.order_item_id} className="py-3.5 first:pt-0 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-[#111827]">
                            {item.product_name} × {item.quantity}
                          </p>
                          <p className="text-xs text-[#64748B]">
                            Dealer: {item.shop_name} · Item Status:{' '}
                            <span className="font-medium text-[#111827]">{item.item_status}</span> · Paid:{' '}
                            <span className="tabular-nums">{formatPaise(item.paid_amount)}</span>
                          </p>
                        </div>

                        {item.cancellable && (
                          <button
                            type="button"
                            disabled={cancellingId === item.order_item_id}
                            onClick={() => handleCancelItem(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 text-[#DC2626] hover:bg-red-50 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{cancellingId === item.order_item_id ? 'Cancelling...' : 'Cancel Item'}</span>
                          </button>
                        )}
                      </div>

                      {/* 3-Step Transfer Progress */}
                      {item.transfer && (
                        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-4 space-y-2.5">
                          <p className="text-xs font-semibold text-[#111827]">
                            Inter-City Stock Transfer: {item.transfer.from_location_name} → {item.transfer.to_location_name}
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            {TRANSFER_STEPS.map((step) => {
                              const currentIdx = TRANSFER_STEPS.indexOf(item.transfer!.status);
                              const stepIdx = TRANSFER_STEPS.indexOf(step);
                              const reached = currentIdx >= stepIdx && currentIdx !== -1;
                              return (
                                <div
                                  key={step}
                                  className={`rounded-lg px-2.5 py-1.5 border ${
                                    reached
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 font-medium'
                                      : 'border-[#E2E8F0] bg-white text-[#64748B]'
                                  }`}
                                >
                                  {step.replace(/_/g, ' ')}
                                </div>
                              );
                            })}
                          </div>
                          {item.transfer.cancel_on_receipt && (
                            <p className="text-xs text-[#D97706] font-medium">
                              Cancel-on-receipt active: stock will be restocked into Bengaluru warehouse upon arrival.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Refund Ledger */}
                      {item.refunds.length > 0 && (
                        <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3.5 text-xs space-y-1">
                          {item.refunds.map((ref) => (
                            <div key={ref.refund_id} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-amber-950">
                                Refund ({ref.status === 'credited' ? 'CREDITED — SIMULATED' : ref.status.toUpperCase()})
                              </span>
                              <span className="font-mono text-[#111827] tabular-nums">
                                {formatPaise(ref.item_amount + ref.fee_amount)}{' '}
                                {ref.gateway_ref ? `· ${ref.gateway_ref}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Shipment Timeline */}
                <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Shipment Timeline
                  </h3>
                  {group.timeline.length === 0 ? (
                    <p className="text-xs text-[#64748B]">Awaiting initial fulfilment milestone...</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {group.timeline.map((ev, tIdx) => (
                        <li key={ev.timeline_id || ev.event_id || `${ev.event_type}-${tIdx}`} className="flex items-start gap-3 text-xs">
                          {ev.event_type === 'delivered' ? (
                            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                          ) : (
                            <Clock className="w-4 h-4 text-[#4F46E5] shrink-0 mt-0.5" />
                          )}
                          <div>
                            <p className="font-medium text-[#111827]">
                              {ev.event_type.replace(/_/g, ' ')}
                              {ev.note ? ` — ${ev.note}` : ''}
                            </p>
                            <p className="text-[#64748B] tabular-nums">
                              {new Date(ev.created_at).toLocaleString()}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
