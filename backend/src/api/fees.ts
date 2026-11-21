// Locked v7.2 SAMPLE delivery fee constants (BIGINT paise, integer arithmetic only)
export const FEE_QUICK_PAISE = 4900; // Rs. 49
export const FEE_STANDARD_PAISE = 2900; // Rs. 29
export const FEE_TRANSFER_PAISE = 6900; // Rs. 29 handling + Rs. 40 inter-location
export const FREE_STANDARD_THRESHOLD_PAISE = 99900; // Rs. 999

export type FulfilmentMode = 'quick' | 'standard' | 'transfer';

export function computeGroupFee(mode: FulfilmentMode, groupItemsTotalPaise: number): number {
  if (!Number.isInteger(groupItemsTotalPaise) || groupItemsTotalPaise < 0) {
    throw new Error('INVALID_AMOUNT');
  }
  switch (mode) {
    case 'quick':
      return FEE_QUICK_PAISE;
    case 'standard':
      return groupItemsTotalPaise >= FREE_STANDARD_THRESHOLD_PAISE ? 0 : FEE_STANDARD_PAISE;
    case 'transfer':
      return FEE_TRANSFER_PAISE;
    default:
      throw new Error(`UNKNOWN_MODE:${String(mode)}`);
  }
}

export interface AllocationLine {
  id: string;
  weightPaise: number;
}

/**
 * Locked v7.2 proportional integer allocation:
 * floor proportional, leftover paise distributed +1 each in order_item_id ASC order.
 * Guarantees SUM(shares) === totalPaise and zero floating-point drift.
 */
export function allocateProportional(totalPaise: number, lines: AllocationLine[]): Map<string, number> {
  const result = new Map<string, number>();
  if (lines.length === 0) return result;
  if (!Number.isInteger(totalPaise) || totalPaise < 0) {
    throw new Error('INVALID_ALLOCATION_TOTAL');
  }

  // Deterministic order_item_id sort
  const ordered = [...lines].sort((a, b) => a.id.localeCompare(b.id));
  const totalWeight = ordered.reduce((acc, l) => acc + l.weightPaise, 0);

  if (totalPaise === 0 || totalWeight === 0) {
    for (const l of ordered) result.set(l.id, 0);
    return result;
  }

  let allocatedSum = 0;
  for (const line of ordered) {
    const share = Math.floor((totalPaise * line.weightPaise) / totalWeight);
    result.set(line.id, share);
    allocatedSum += share;
  }

  let remainder = totalPaise - allocatedSum;
  let idx = 0;
  while (remainder > 0) {
    const line = ordered[idx % ordered.length];
    result.set(line.id, (result.get(line.id) ?? 0) + 1);
    remainder -= 1;
    idx += 1;
  }

  return result;
}
