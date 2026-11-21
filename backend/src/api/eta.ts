import type { FulfilmentMode } from './fees';

export interface HubHours {
  open: string; // "HH:MM" in Asia/Kolkata, e.g. "07:00"
  close: string; // "HH:MM" in Asia/Kolkata, e.g. "23:00"
  always_open?: boolean;
}

export interface EtaCalculation {
  eta_window_start: string;
  eta_window_end: string;
  eta_basis: {
    mode: FulfilmentMode;
    label: string;
    picking_queue?: number;
    estimated_minutes_center?: number;
    transfer_days_max?: number;
    sample_note: string;
  };
}

/**
 * Checks whether a timestamp falls inside hub operating hours in Asia/Kolkata (IST = UTC+5:30).
 */
export function isWithinHubHours(hours: HubHours | null | undefined, now: Date = new Date()): boolean {
  if (!hours) return true;
  if (hours.always_open) return true;

  // Convert UTC date to IST minutes since midnight
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + 330) % 1440;

  const [openH, openM] = (hours.open || '00:00').split(':').map(Number);
  const [closeH, closeM] = (hours.close || '23:59').split(':').map(Number);
  const openTotal = openH * 60 + openM;
  const closeTotal = closeH * 60 + closeM;

  if (closeTotal >= openTotal) {
    return istMinutes >= openTotal && istMinutes <= closeTotal;
  }
  // Overnight span
  return istMinutes >= openTotal || istMinutes <= closeTotal;
}

/**
 * Locked v7.2 ETA formula (no external routing API; always returns a RANGE).
 * - quick: accept 5m + picking_queue*4m + pack 5m + assign 5m + travel 20m, shown as +/- 15m range
 * - standard: warehouse 1 business day + local 1-2 days
 * - transfer: transfer_days_max + warehouse 1 day + local 1-2 days
 */
export function computeEtaWindow(params: {
  mode: FulfilmentMode;
  pickingQueue?: number;
  transferDaysMax?: number;
  now?: Date;
}): EtaCalculation {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  if (params.mode === 'quick') {
    const queue = Math.max(0, Math.floor(params.pickingQueue ?? 0));
    const centerMinutes = 5 + queue * 4 + 5 + 5 + 20;
    const minMinutes = Math.max(20, centerMinutes - 15);
    const maxMinutes = centerMinutes + 15;
    return {
      eta_window_start: new Date(nowMs + minMinutes * MINUTE).toISOString(),
      eta_window_end: new Date(nowMs + maxMinutes * MINUTE).toISOString(),
      eta_basis: {
        mode: 'quick',
        label: `${minMinutes}–${maxMinutes} mins`,
        picking_queue: queue,
        estimated_minutes_center: centerMinutes,
        sample_note: 'SAMPLE hub ETA range (accept 5m + queue*4m + pack 5m + assign 5m + travel 20m, ±15m)',
      },
    };
  }

  if (params.mode === 'standard') {
    const startDays = 2; // 1 business day warehouse + 1 day local
    const endDays = 3; // 1 business day warehouse + 2 days local
    return {
      eta_window_start: new Date(nowMs + startDays * DAY).toISOString(),
      eta_window_end: new Date(nowMs + endDays * DAY).toISOString(),
      eta_basis: {
        mode: 'standard',
        label: '2–3 days',
        sample_note: 'SAMPLE standard ETA range (warehouse 1 business day + local 1–2 days)',
      },
    };
  }

  // transfer
  const transferDays = Math.max(1, params.transferDaysMax ?? 3);
  const startDays = transferDays + 2; // transfer_days_max + warehouse 1d + local 1d
  const endDays = transferDays + 3; // transfer_days_max + warehouse 1d + local 2d
  return {
    eta_window_start: new Date(nowMs + startDays * DAY).toISOString(),
    eta_window_end: new Date(nowMs + endDays * DAY).toISOString(),
    eta_basis: {
      mode: 'transfer',
      label: `${startDays}–${endDays} days (incl. ~${transferDays}d transfer)`,
      transfer_days_max: transferDays,
      sample_note: `SAMPLE transfer ETA range (${transferDays}d transfer + warehouse 1d + local 1–2d)`,
    },
  };
}
