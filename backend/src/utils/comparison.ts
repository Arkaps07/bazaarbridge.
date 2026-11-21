export type ComparisonCategory = 'budget' | 'fastest' | 'rated' | 'value' | 'available';

export interface OfferForComparison {
  offer_id: string;
  product_id: string;
  product_name: string;
  dealer_id: string;
  shop_name: string;
  dealer_city: string;
  dealer_state: string;
  dealer_rating: number;
  total_reviews: number;
  verified: boolean;
  selling_price: number; // integer paise
  status: string;
  bangalore_delivery_days: number | null;
  transfer_days_min: number | null;
  transfer_days_max: number | null;
  eligible_modes: string[];
  warranty_months: number;
  warranty_note: string | null;
  sellable_free_units: number;
  home_free_units: number;
  hub_free_units: number;
  default_location_id: string;
  default_location_name: string;
  default_location_city: string;
  default_location_type: string;
}

export interface RankedOffer extends OfferForComparison {
  effective_days: number;
  value_score?: number;
  reason: string;
  rank: number;
}

function formatRupees(paise: number): string {
  if (paise % 100 === 0) {
    return `Rs.${(paise / 100).toLocaleString('en-IN')}`;
  }
  return `Rs.${(paise / 100).toFixed(2)}`;
}

export function computeEffectiveDays(offer: OfferForComparison): number {
  if (offer.home_free_units > 0 && offer.bangalore_delivery_days != null) {
    return offer.bangalore_delivery_days;
  }
  if (offer.hub_free_units > 0 && offer.bangalore_delivery_days != null) {
    return offer.bangalore_delivery_days;
  }
  return offer.transfer_days_max ?? offer.bangalore_delivery_days ?? 4;
}

/**
 * Implements the exact v7.2 five-category dealer comparison algorithms.
 * Only active offers with sellable_free_units > 0 qualify.
 * Every result includes a verbatim reason string derived ONLY from stored fields.
 */
export function rankOffersByCategory(
  rawOffers: OfferForComparison[],
  category: ComparisonCategory
): RankedOffer[] {
  const eligible = rawOffers
    .filter((o) => o.status === 'active' && o.sellable_free_units > 0)
    .map((o) => ({
      ...o,
      effective_days: computeEffectiveDays(o),
    }));

  const count = eligible.length;
  if (count === 0) return [];

  if (category === 'budget') {
    const sorted = [...eligible].sort((a, b) => {
      if (a.selling_price !== b.selling_price) return a.selling_price - b.selling_price;
      if (a.effective_days !== b.effective_days) return a.effective_days - b.effective_days;
      return b.dealer_rating - a.dealer_rating;
    });
    return sorted.map((o, idx) => ({
      ...o,
      rank: idx + 1,
      reason:
        idx === 0
          ? `Lowest price ${formatRupees(o.selling_price)} among ${count} in-stock offers — ${o.effective_days}-day delivery`
          : `Ranked #${idx + 1} on price at ${formatRupees(o.selling_price)} — ${o.effective_days}-day delivery`,
    }));
  }

  if (category === 'fastest') {
    const sorted = [...eligible].sort((a, b) => {
      if (a.effective_days !== b.effective_days) return a.effective_days - b.effective_days;
      return a.selling_price - b.selling_price;
    });
    return sorted.map((o, idx) => ({
      ...o,
      rank: idx + 1,
      reason:
        idx === 0
          ? `Fastest ${o.effective_days}-day delivery among ${count} in-stock offers at ${formatRupees(o.selling_price)}`
          : `${o.effective_days}-day delivery at ${formatRupees(o.selling_price)} from ${o.shop_name}`,
    }));
  }

  if (category === 'rated') {
    const sorted = [...eligible].sort((a, b) => {
      if (b.dealer_rating !== a.dealer_rating) return b.dealer_rating - a.dealer_rating;
      if (b.total_reviews !== a.total_reviews) return b.total_reviews - a.total_reviews;
      return a.selling_price - b.selling_price;
    });
    return sorted.map((o, idx) => ({
      ...o,
      rank: idx + 1,
      reason:
        idx === 0
          ? `Highest dealer rating ${o.dealer_rating.toFixed(1)}/5 (${o.total_reviews} reviews) among ${count} in-stock offers at ${formatRupees(o.selling_price)}`
          : `Rated ${o.dealer_rating.toFixed(1)}/5 (${o.total_reviews} reviews) at ${formatRupees(o.selling_price)}`,
    }));
  }

  if (category === 'available') {
    const sorted = [...eligible].sort((a, b) => {
      if (b.sellable_free_units !== a.sellable_free_units) {
        return b.sellable_free_units - a.sellable_free_units;
      }
      return a.selling_price - b.selling_price;
    });
    return sorted.map((o, idx) => ({
      ...o,
      rank: idx + 1,
      reason:
        idx === 0
          ? `Highest sellable stock (${o.sellable_free_units} free units) among ${count} in-stock offers at ${formatRupees(o.selling_price)}`
          : `${o.sellable_free_units} sellable free units at ${formatRupees(o.selling_price)}`,
    }));
  }

  // category === 'value'
  // BEST VALUE = 0.45*price + 0.25*delivery + 0.20*rating + 0.10*stock
  const prices = eligible.map((o) => o.selling_price);
  const days = eligible.map((o) => o.effective_days);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minDays = Math.min(...days);
  const maxDays = Math.max(...days);

  const scored = eligible.map((o) => {
    const priceScore =
      maxPrice === minPrice ? 100 : (100 * (maxPrice - o.selling_price)) / (maxPrice - minPrice);
    const deliveryScore =
      maxDays === minDays ? 100 : (100 * (maxDays - o.effective_days)) / (maxDays - minDays);
    const ratingScore = (100 * o.dealer_rating) / 5;
    const stockScore = 100; // MVP indicator for any in-stock offer
    const valueScore = Number(
      (0.45 * priceScore + 0.25 * deliveryScore + 0.2 * ratingScore + 0.1 * stockScore).toFixed(2)
    );
    return { ...o, value_score: valueScore };
  });

  const sorted = [...scored].sort((a, b) => {
    if ((b.value_score ?? 0) !== (a.value_score ?? 0)) {
      return (b.value_score ?? 0) - (a.value_score ?? 0);
    }
    return a.selling_price - b.selling_price;
  });

  return sorted.map((o, idx) => ({
    ...o,
    rank: idx + 1,
    reason:
      idx === 0
        ? `Best overall balance (score ${o.value_score}/100): ${formatRupees(o.selling_price)}, ${o.effective_days}-day delivery, ${o.dealer_rating.toFixed(1)}/5 rating across ${count} offers`
        : `Value score ${o.value_score}/100 at ${formatRupees(o.selling_price)} (${o.effective_days}-day delivery, ${o.dealer_rating.toFixed(1)}/5)`,
  }));
}
