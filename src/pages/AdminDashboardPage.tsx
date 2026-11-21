import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  Database,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Truck,
} from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise, usePolling } from '../kit';
import { useApp } from '../context/AppContext';

interface OverviewResponse {
  metrics: {
    total_products: number;
    total_dealers: number;
    total_offers: number;
    total_orders: number;
    active_fulfilment_groups: number;
    pending_transfers: number;
    refund_cases: number;
    total_sellable_free_units: number;
    reconciliation_discrepancies: number;
  };
  hubs: Array<{
    hub_id: string;
    location_name: string;
    active: boolean;
    order_capacity: number;
    used_capacity_today: number;
    pin_codes: string[];
  }>;
  infrastructure: {
    postgresql: string;
    kafka: string;
    opensearch: string;
  };
}

interface AdminGroup {
  group_id: string;
  order_id: string;
  customer_name: string;
  mode: 'quick' | 'standard' | 'transfer';
  status: string;
  location_name: string;
  fee_total: number;
  otp_hash_preview: string;
  created_at: string;
  items: Array<{
    order_item_id: string;
    product_name: string;
    quantity: number;
    item_status: string;
    paid_amount: number;
  }>;
  transfers: Array<{
    transfer_id: string;
    status: string;
    cancel_on_receipt: boolean;
  }>;
  refunds: Array<{
    refund_id: string;
    order_item_id: string;
    item_amount: number;
    fee_amount: number;
    status: string;
    gateway_ref: string | null;
  }>;
  timeline: Array<{
    timeline_id?: string;
    event_id?: string;
    event_type: string;
    note: string | null;
    created_at: string;
  }>;
}

interface LiveProofResponse {
  outbox_events: Array<{
    event_id: string;
    event_type: string;
    topic: string;
    partition: number;
    partition_key: string;
    payload: Record<string, unknown>;
    published_at: string | null;
    created_at: string;
  }>;
  processed_events: Array<{
    event_id: string;
    consumer_name: string;
    processed_at: string;
  }>;
  indexed_summary: Array<{
    offer_id: string;
    product_name: string;
    shop_name: string;
    selling_price: number;
    available_units: number;
    revision: number;
    pg_revision: number;
  }>;
  reconciliation_discrepancies: unknown[];
  note: string;
}

export const AdminDashboardPage: React.FC = () => {
  const { user, token, notify } = useApp();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [allRefunds, setAllRefunds] = useState<AdminGroup['refunds']>([]);
  const [liveProof, setLiveProof] = useState<LiveProofResponse | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!token || user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    try {
      const [ov, gr, lp] = await Promise.all([
        apiRequest<OverviewResponse>('/api/admin/overview'),
        apiRequest<{ groups: AdminGroup[]; all_refunds: AdminGroup['refunds'] }>('/api/admin/groups'),
        apiRequest<LiveProofResponse>('/api/admin/live-proof'),
      ]);
      setOverview(ov);
      setGroups(gr.groups || []);
      setAllRefunds(gr.all_refunds || []);
      setLiveProof(lp);
      setSelectedGroupId((prev) => prev || gr.groups?.[0]?.group_id || '');
    } catch {
      notify('error', 'Failed to refresh admin console.');
    } finally {
      setLoading(false);
    }
  }, [token, user?.role, notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  usePolling(loadAll, 6000, Boolean(token && user?.role === 'admin'));

  const selectedGroup = groups.find((g) => g.group_id === selectedGroupId) || groups[0] || null;

  const fireSimulatorEvent = async (eventType: string, otpMode?: 'correct' | 'wrong') => {
    if (!selectedGroup) return;
    setBusyAction(otpMode ? `${eventType}-${otpMode}` : eventType);
    try {
      let otpValue: string | undefined;
      if (eventType === 'otp_verified') {
        const otpResp = await apiRequest<{ demo_otp: string }>(
          `/api/admin/groups/${selectedGroup.group_id}/demo-otp`
        );
        if (otpMode === 'wrong') {
          const wrongNum = (parseInt(otpResp.demo_otp, 10) + 1) % 1_000_000;
          otpValue = String(wrongNum).padStart(6, '0');
        } else {
          otpValue = otpResp.demo_otp;
        }
      }

      const resp = await apiRequest<{ topic: string; partition: number }>('/api/simulator/fire-event', {
        method: 'POST',
        body: {
          group_id: selectedGroup.group_id,
          event_type: eventType,
          ...(otpValue ? { otp: otpValue } : {}),
        },
      });
      notify(
        'success',
        `Dispatched ${eventType} → ${resp.topic} [partition ${resp.partition}]${
          otpMode === 'wrong' ? ' (wrong OTP proof submitted)' : ''
        }`
      );
      await loadAll();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Simulator event failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const toggleHub = async (hubId: string, nextActive: boolean) => {
    setBusyAction(`hub-${hubId}`);
    try {
      await apiRequest(`/api/admin/hubs/${hubId}/status`, {
        method: 'POST',
        body: { active: nextActive },
      });
      notify('success', nextActive ? 'Hub resumed Quick operations.' : 'Hub paused; active ETAs updated.');
      await loadAll();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not toggle hub status.');
    } finally {
      setBusyAction(null);
    }
  };

  const creditRefund = async (refundId: string) => {
    setBusyAction(`refund-${refundId}`);
    try {
      await apiRequest(`/api/admin/refunds/${refundId}/credit`, {
        method: 'POST',
        body: {},
      });
      notify('success', 'Refund credit event published (SIMULATED gateway).');
      await loadAll();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not credit refund.');
    } finally {
      setBusyAction(null);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <ShieldCheck className="w-10 h-10 text-[#4F46E5] mx-auto" />
        <h1 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: 'var(--font-display)' }}>
          Admin Authentication Required
        </h1>
        <p className="text-sm text-[#64748B]">
          Sign in through the dedicated Admin Portal to access the Fulfilment Simulator, Hub Controls, and Live-Proof Panel.
        </p>
        <Link
          to="/admin-login"
          className="inline-block rounded-lg bg-[#111827] hover:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white"
        >
          Go to Admin Login
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#4F46E5]">
            Operations Console &amp; Live Proof
          </p>
          <h1
            className="text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            BazaarBridge Admin Dashboard
          </h1>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:border-[#4F46E5] px-4 py-2 text-xs font-semibold text-[#111827] cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Live Proof</span>
        </button>
      </div>

      {/* Infrastructure Transparency Banner */}
      {overview && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-[#64748B]">PostgreSQL Engine</p>
            <p className="font-semibold text-[#111827] mt-0.5">{overview.infrastructure.postgresql}</p>
          </div>
          <div>
            <p className="text-[#64748B]">Kafka Event Bus (2 Topics × 2 Partitions)</p>
            <p className="font-semibold text-[#111827] mt-0.5">{overview.infrastructure.kafka}</p>
          </div>
          <div>
            <p className="text-[#64748B]">OpenSearch Fuzzy Index</p>
            <p className="font-semibold text-[#111827] mt-0.5">{overview.infrastructure.opensearch}</p>
          </div>
        </div>
      )}

      {/* Overview KPIs */}
      {loading || !overview ? (
        <div className="h-28 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Catalog SKUs', value: overview.metrics.total_products },
            { label: 'Active Orders', value: overview.metrics.total_orders },
            { label: 'Active Groups', value: overview.metrics.active_fulfilment_groups },
            { label: 'Pending Transfers', value: overview.metrics.pending_transfers },
            { label: 'Sellable Free Units', value: overview.metrics.total_sellable_free_units },
            { label: 'Reconciliation Drift', value: overview.metrics.reconciliation_discrepancies },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-xl border border-[#E2E8F0] p-4">
              <p className="text-xs text-[#64748B]">{kpi.label}</p>
              <p
                className="text-2xl font-bold text-[#111827] tabular-nums mt-1"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {kpi.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Hub Controls */}
      {overview && overview.hubs.length > 0 && (
        <section className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[#111827]">Quick Fulfilment Hub Controls</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {overview.hubs.map((hub) => (
              <div
                key={hub.hub_id}
                className="rounded-xl border border-[#E2E8F0] p-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#111827]">{hub.location_name}</p>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    PINs: {hub.pin_codes.join(', ')} · Capacity: {hub.used_capacity_today}/{hub.order_capacity} ·{' '}
                    <span className={hub.active ? 'text-[#16A34A] font-semibold' : 'text-[#DC2626] font-semibold'}>
                      {hub.active ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyAction === `hub-${hub.hub_id}`}
                  onClick={() => toggleHub(hub.hub_id, !hub.active)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white cursor-pointer ${
                    hub.active ? 'bg-[#D97706] hover:bg-amber-700' : 'bg-[#16A34A] hover:bg-emerald-700'
                  }`}
                >
                  {hub.active ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                  <span>{hub.active ? 'Pause Hub' : 'Resume Hub'}</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fulfilment & Transfer Simulator */}
      <section className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-[#4F46E5]" />
            <h2 className="text-lg font-semibold text-[#111827]">
              Fulfilment, Transfer &amp; OTP Delivery Simulator
            </h2>
          </div>
          <span className="text-xs text-[#64748B]">
            Fires real backend outbox events into Kafka consumers
          </span>
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-[#64748B]">
            No fulfilment groups yet. Place an order as the demo customer to drive events through the simulator.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Group Selector List */}
            <div className="lg:col-span-5 space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {groups.map((g) => {
                const selected = selectedGroup?.group_id === g.group_id;
                return (
                  <button
                    key={g.group_id}
                    type="button"
                    onClick={() => setSelectedGroupId(g.group_id)}
                    className={`w-full text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#4F46E5] bg-indigo-50/60'
                        : 'border-[#E2E8F0] hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold font-mono text-[#111827]">
                        Order #{g.order_id.slice(0, 8).toUpperCase()} · {g.mode.toUpperCase()}
                      </span>
                      <span className="text-[11px] font-semibold text-[#4F46E5]">
                        {g.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-[#64748B] mt-1 truncate">
                      {g.location_name} · {g.items.map((i) => i.product_name).join(', ')}
                    </p>
                    <p className="text-[11px] text-[#64748B] font-mono mt-1">
                      OTP hash: {g.otp_hash_preview}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Selected Group Event Controls */}
            {selectedGroup && (
              <div className="lg:col-span-7 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-5 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#111827]">
                      Group {selectedGroup.group_id.slice(0, 8)} ({selectedGroup.mode.toUpperCase()})
                    </p>
                    <p className="text-xs text-[#64748B]">
                      Current status: <span className="font-semibold text-[#111827]">{selectedGroup.status}</span> ·{' '}
                      {selectedGroup.location_name}
                    </p>
                  </div>
                  <Link
                    to={`/orders/${selectedGroup.order_id}`}
                    className="text-xs font-semibold text-[#4F46E5] hover:underline"
                  >
                    Open Customer View
                  </Link>
                </div>

                {/* Standard/Quick Fulfilment Buttons */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Fulfilment Progression
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { type: 'picked', label: 'Mark Picked' },
                      { type: 'packed', label: 'Mark Packed' },
                      { type: 'rider_assigned', label: 'Assign Rider' },
                      { type: 'picked_up', label: 'Picked Up' },
                      { type: 'out_for_delivery', label: 'Out for Delivery' },
                    ].map((btn) => (
                      <button
                        key={btn.type}
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => fireSimulatorEvent(btn.type)}
                        className="rounded-lg border border-[#E2E8F0] bg-white hover:border-[#4F46E5] hover:text-[#4F46E5] px-3 py-1.5 text-xs font-medium text-[#111827] cursor-pointer"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* OTP Verification & Exception */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Delivery Verification (Hashed HMAC otp_proof)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => fireSimulatorEvent('otp_verified', 'correct')}
                      className="rounded-lg bg-[#16A34A] hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
                    >
                      Deliver — Correct OTP (Autofill)
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => fireSimulatorEvent('otp_verified', 'wrong')}
                      className="rounded-lg bg-[#DC2626] hover:bg-red-700 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
                    >
                      Deliver — Wrong OTP (Code+1)
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => fireSimulatorEvent('delivery_exception')}
                      className="rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3.5 py-2 text-xs font-semibold text-amber-950 cursor-pointer"
                    >
                      Delivery Exception
                    </button>
                  </div>
                </div>

                {/* 3 Distinct Transfer Steps */}
                {selectedGroup.transfers.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                      3-Step Inter-City Transfer ({selectedGroup.transfers[0].status})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => fireSimulatorEvent('in_transit')}
                        className="rounded-lg border border-[#4F46E5] bg-white text-[#4F46E5] hover:bg-indigo-50 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                      >
                        1. Mark In Transit
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => fireSimulatorEvent('received_checked')}
                        className="rounded-lg border border-[#4F46E5] bg-white text-[#4F46E5] hover:bg-indigo-50 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                      >
                        2. Mark Received &amp; QC&rsquo;d
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => fireSimulatorEvent('allocated')}
                        className="rounded-lg border border-[#4F46E5] bg-white text-[#4F46E5] hover:bg-indigo-50 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                      >
                        3. Allocate to Order
                      </button>
                    </div>
                  </div>
                )}

                {/* Recent Group Timeline */}
                <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                  <p className="text-xs font-semibold text-[#111827]">Group Timeline ({selectedGroup.timeline.length})</p>
                  <div className="max-h-36 overflow-y-auto space-y-1 text-xs text-[#64748B]">
                    {selectedGroup.timeline.map((ev, tIdx) => (
                      <p key={ev.timeline_id || ev.event_id || `${ev.event_type}-${tIdx}`} className="tabular-nums">
                        <span className="font-mono text-[#111827]">{ev.event_type}</span>
                        {ev.note ? ` — ${ev.note}` : ''}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Refund Credit Queue (SIMULATED) */}
      {allRefunds.length > 0 && (
        <section className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#111827]">Refund Credit Ledger (SIMULATED Gateway)</h2>
            <span className="text-xs text-[#D97706] font-medium">SIMULATED</span>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {allRefunds.map((ref) => (
              <div key={ref.refund_id} className="py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div>
                  <p className="font-mono font-semibold text-[#111827]">
                    Refund {ref.refund_id.slice(0, 8)} · {formatPaise(ref.item_amount + ref.fee_amount)}
                  </p>
                  <p className="text-[#64748B]">
                    Status: <span className="font-semibold text-[#111827]">{ref.status}</span>{' '}
                    {ref.gateway_ref ? `· ${ref.gateway_ref}` : ''}
                  </p>
                </div>
                {ref.status !== 'credited' ? (
                  <button
                    type="button"
                    disabled={busyAction === `refund-${ref.refund_id}`}
                    onClick={() => creditRefund(ref.refund_id)}
                    className="rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                  >
                    Credit Refund (Simulated)
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#16A34A] font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Credited
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Live-Proof Panel */}
      {liveProof && (
        <section className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-[#4F46E5]" />
              <h2 className="text-lg font-semibold text-[#111827]">
                Live-Proof Panel (Outbox, Processed Events &amp; OpenSearch Revisions)
              </h2>
            </div>
            <p className="text-xs text-[#64748B]">{liveProof.note}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Outbox Rows */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] inline-flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>Transactional Outbox Events ({liveProof.outbox_events.length})</span>
              </h3>
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 max-h-72 overflow-y-auto space-y-2 font-mono text-[11px]">
                {liveProof.outbox_events.length === 0 ? (
                  <p className="text-[#64748B]">No outbox events recorded yet.</p>
                ) : (
                  liveProof.outbox_events.map((ev) => (
                    <div key={ev.event_id} className="rounded-lg bg-white border border-[#E2E8F0] p-2.5 space-y-1">
                      <div className="flex justify-between gap-2 text-[#111827] font-semibold">
                        <span>{ev.event_type}</span>
                        <span className="text-[#4F46E5]">
                          {ev.topic} [p{ev.partition}]
                        </span>
                      </div>
                      <p className="text-[#64748B] break-all">
                        payload: {JSON.stringify(ev.payload)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Processed Events & OpenSearch Revision Sync */}
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] inline-flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  <span>Idempotent Processed Events ({liveProof.processed_events.length})</span>
                </h3>
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 max-h-32 overflow-y-auto space-y-1 font-mono text-[11px]">
                  {liveProof.processed_events.length === 0 ? (
                    <p className="text-[#64748B]">No consumer receipts yet.</p>
                  ) : (
                    liveProof.processed_events.slice(0, 15).map((pe) => (
                      <div key={`${pe.event_id}-${pe.consumer_name}`} className="flex justify-between gap-2">
                        <span className="text-[#111827]">{pe.consumer_name}</span>
                        <span className="text-[#64748B]">{pe.event_id.slice(0, 8)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                  OpenSearch Revision Sync (external_gte)
                </h3>
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 max-h-36 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                  {liveProof.indexed_summary.slice(0, 8).map((doc) => (
                    <div key={doc.offer_id} className="flex items-center justify-between gap-2">
                      <span className="text-[#111827] truncate">{doc.product_name} ({doc.shop_name})</span>
                      <span className="text-[#16A34A] shrink-0 tabular-nums">
                        rev {doc.revision}/{doc.pg_revision} · {doc.available_units}u
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
