import React, { useEffect, useRef } from 'react';

/**
 * Locked v7.2 Kit — formatPaise(paise)
 * Converts integer paise to clean Indian Rupee currency formatting without floating-point drift.
 */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const formattedRupees = rupees.toLocaleString('en-IN');
  if (rem === 0) return `${sign}₹${formattedRupees}`;
  return `${sign}₹${formattedRupees}.${String(rem).padStart(2, '0')}`;
}

/**
 * Locked v7.2 Kit — usePolling(fn, ms)
 * Safe interval poller that cleans up on unmount and avoids overlapping async calls.
 */
export function usePolling(fn: () => void | Promise<void>, ms: number, enabled = true): void {
  const savedFn = useRef(fn);
  useEffect(() => {
    savedFn.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled || ms <= 0) return;
    let active = true;
    let running = false;

    const tick = async () => {
      if (!active || running) return;
      running = true;
      try {
        await savedFn.current();
      } finally {
        running = false;
      }
    };

    const id = window.setInterval(tick, ms);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [ms, enabled]);
}

interface SimulatedWrapperProps {
  featureFlag?: string;
  enabledFlags?: Set<string>;
  label?: string;
  children: React.ReactNode;
}

/**
 * Locked v7.2 Kit — <SimulatedWrapper featureFlag label>
 * Visibly marks seeded/simulated screens with an honest yellow SAMPLE / SIMULATED banner
 * and hides content if its featureFlag is explicitly disabled.
 */
export const SimulatedWrapper: React.FC<SimulatedWrapperProps> = ({
  featureFlag,
  enabledFlags,
  label = 'SIMULATED / SAMPLE DATA',
  children,
}) => {
  if (featureFlag && enabledFlags && !enabledFlags.has(featureFlag)) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div
        role="note"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900"
      >
        <span>{label}</span>
        <span className="text-amber-800/80">
          Seeded demonstration screen running alongside the real BazaarBridge pipeline.
        </span>
      </div>
      {children}
    </div>
  );
};
