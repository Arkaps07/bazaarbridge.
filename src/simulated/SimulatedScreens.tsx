import React from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, MessageSquare, PackageCheck, Bike, Receipt } from 'lucide-react';
import { SimulatedWrapper } from '../kit';
import { useApp } from '../context/AppContext';

export const SimulatedOpsPage: React.FC = () => {
  const { featureFlags } = useApp();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Fulfilment Operations Preview
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            Illustrative picker queue, rider dispatch board, and refund gateway view. Use the real Admin Simulator to fire live Kafka events.
          </p>
        </div>
        <Link
          to="/admin"
          className="rounded-lg bg-[#111827] hover:bg-slate-800 px-4 py-2 text-xs font-semibold text-white"
        >
          Open Real Admin Simulator
        </Link>
      </div>

      <SimulatedWrapper
        featureFlag="FEATURE_SIM_SCREENS"
        enabledFlags={featureFlags}
        label="SIMULATED / SAMPLE DATA — Operations Mockup Screens"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <PackageCheck className="w-4 h-4 text-[#4F46E5]" />
              <span>Hub Picker Queue (SAMPLE)</span>
            </div>
            <ul className="space-y-2 text-xs text-[#64748B]">
              <li className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="font-semibold text-[#111827]">Koramangala Hub · Bin A-04</span>
                <p>AeroPulse Portable Bluetooth Speaker — Pick SLA 6m</p>
              </li>
              <li className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="font-semibold text-[#111827]">Koramangala Hub · Bin B-11</span>
                <p>AcousticOne ANC Headphones — Ready for packing</p>
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <Bike className="w-4 h-4 text-[#16A34A]" />
              <span>Rider Dispatch Board (SAMPLE)</span>
            </div>
            <ul className="space-y-2 text-xs text-[#64748B]">
              <li className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="font-semibold text-[#111827]">Rider #BLR-14 · PIN 560034</span>
                <p>Assigned Quick batch · OTP verification required on drop-off</p>
              </li>
              <li className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="font-semibold text-[#111827]">Rider #BLR-09 · PIN 560038</span>
                <p>En route to Indiranagar · Standard warehouse parcel</p>
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <Receipt className="w-4 h-4 text-[#D97706]" />
              <span>Refund Settlement Monitor (SAMPLE)</span>
            </div>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Sandbox refund settlements are processed by the real idempotent <span className="font-mono text-[#111827]">refund-credit</span> Kafka consumer and can be triggered from the Admin Dashboard.
            </p>
          </div>
        </div>
      </SimulatedWrapper>
    </div>
  );
};

export const SimulatedSupportPage: React.FC = () => {
  const { featureFlags } = useApp();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div>
        <h1
          className="text-3xl font-bold text-[#111827] tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Support Centre &amp; Community Q&amp;A
        </h1>
        <p className="text-sm text-[#64748B] mt-1">
          Sample help articles, delivery policies, and seeded product reviews for demonstration purposes.
        </p>
      </div>

      <SimulatedWrapper
        featureFlag="FEATURE_SIM_SCREENS"
        enabledFlags={featureFlags}
        label="SIMULATED / SAMPLE DATA — Support, Policies & Reviews"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <HelpCircle className="w-4 h-4 text-[#4F46E5]" />
              <span>Frequently Asked Questions (SAMPLE)</span>
            </div>
            <div className="space-y-3 text-xs text-[#64748B]">
              <div>
                <p className="font-semibold text-[#111827]">How do Quick, Standard, and Transfer groups split?</p>
                <p className="mt-0.5">
                  Items stocked in the local Koramangala Hub for PINs 560034, 560095, or 560038 qualify for Quick delivery. Warehouse items ship via Standard, and Mysuru holding-depot items move via a 3-step Inter-City Transfer.
                </p>
              </div>
              <div>
                <p className="font-semibold text-[#111827]">When can I cancel an order item?</p>
                <p className="mt-0.5">
                  Items can be cancelled atomically before the shipment group reaches picked-up / out-for-delivery status. Restocking and refund initiation happen automatically.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <MessageSquare className="w-4 h-4 text-[#4F46E5]" />
              <span>Sample Verified Shopper Reviews (SAMPLE)</span>
            </div>
            <div className="space-y-3 text-xs text-[#64748B]">
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <p className="font-semibold text-[#111827]">5.0 / 5 · AeroPulse Portable Bluetooth Speaker</p>
                <p className="mt-1">
                  &ldquo;Comparing 5 local Bengaluru dealers side by side saved me ₹80 and let me see exact Koramangala hub availability.&rdquo; — Sample Reviewer
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <p className="font-semibold text-[#111827]">4.8 / 5 · Kaveri Pro Wireless Earphones (Mysuru Transfer)</p>
                <p className="mt-1">
                  &ldquo;Loved seeing each transfer milestone from Mysuru depot to Bengaluru QC allocation.&rdquo; — Sample Reviewer
                </p>
              </div>
            </div>
          </div>
        </div>
      </SimulatedWrapper>
    </div>
  );
};
