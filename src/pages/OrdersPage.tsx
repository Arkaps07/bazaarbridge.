import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Package } from 'lucide-react';
import { apiRequest } from '../services/api';
import { formatPaise } from '../kit';
import { useApp } from '../context/AppContext';

interface OrderSummary {
  order_id: string;
  placed_at: string;
  total_amount: number;
  items_total: number;
  delivery_fee_total: number;
  discount_total: number;
  item_count: number;
  group_count: number;
  modes: string[];
  payment_status: string;
  payment_label: string;
}

export const OrdersPage: React.FC = () => {
  const { token } = useApp();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiRequest<{ orders: OrderSummary[] }>('/api/orders')
      .then((res) => setOrders(res.orders || []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [token]);

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <Package className="w-10 h-10 text-[#64748B] mx-auto" />
        <h1 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: 'var(--font-display)' }}>
          Sign in to track your orders
        </h1>
        <p className="text-sm text-[#64748B]">
          View split fulfilment timelines, transfer milestones, and delivery OTP codes.
        </p>
        <Link
          to="/login?next=/orders"
          className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white"
        >
          <span>Sign In</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your Orders
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            Click any order to monitor live fulfilment groups, transfer checkpoints, and delivery OTPs.
          </p>
        </div>
        <Link to="/search" className="text-sm font-medium text-[#4F46E5] hover:underline">
          Shop more deals
        </Link>
      </div>

      {loading ? (
        <div className="h-48 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center space-y-3">
          <p className="text-base font-semibold text-[#111827]">No orders placed yet</p>
          <p className="text-sm text-[#64748B]">
            Add a Quick Hub item and a Standard Warehouse item to see automatic fulfilment group splitting in action.
          </p>
          <Link
            to="/search"
            className="inline-block mt-2 rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Explore Catalog
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <Link
              key={order.order_id}
              to={`/orders/${order.order_id}`}
              className="block bg-white rounded-xl border border-[#E2E8F0] hover:border-[#4F46E5] p-5 transition-all"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#111827] font-mono">
                    Order #{order.order_id.slice(0, 8).toUpperCase()}
                  </p>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    Placed {new Date(order.placed_at).toLocaleString()} · {order.item_count}{' '}
                    {order.item_count === 1 ? 'item' : 'items'} · {order.group_count}{' '}
                    {order.group_count === 1 ? 'fulfilment group' : 'fulfilment groups'} ({order.modes.join(', ')})
                  </p>
                  <p className="text-[11px] text-[#D97706] font-medium">{order.payment_label}</p>
                </div>

                <div className="flex items-center gap-4">
                  <span
                    className="text-lg font-bold text-[#111827] tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {formatPaise(order.total_amount)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#4F46E5]">
                    Track <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
