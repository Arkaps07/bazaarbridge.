import type { ComparisonCategory } from './comparison';

export interface ValidatedAssistantFilters {
  q?: string;
  category?: string;
  product_type?: string;
  connectivity?: string;
  features?: string[];
  max_price?: number; // paise
  max_delivery_days?: number;
  city?: string;
  delivery_mode?: 'quick' | 'standard';
  sort_preference?: ComparisonCategory;
}

const ALLOWED_KEYS = new Set([
  'q',
  'category',
  'product_type',
  'connectivity',
  'features',
  'max_price',
  'max_delivery_days',
  'city',
  'delivery_mode',
  'sort_preference',
]);

const VALID_SORT: Set<string> = new Set(['budget', 'fastest', 'rated', 'value', 'available']);

export function validateAssistantFilters(
  raw: unknown,
  knownCategories: string[],
  knownCities: string[]
): ValidatedAssistantFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_FILTER_OBJECT');
  }
  const obj = raw as Record<string, unknown>;
  const out: ValidatedAssistantFilters = {};

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      // Strictly strip/reject unknown fields; ignore null/undefined
      continue;
    }
    const val = obj[key];
    if (val === null || val === undefined || val === '') continue;

    if (key === 'q' && typeof val === 'string') {
      out.q = val.trim().slice(0, 120);
    } else if (key === 'category' && typeof val === 'string') {
      const matched = knownCategories.find((c) => c.toLowerCase() === val.trim().toLowerCase());
      if (matched) out.category = matched;
    } else if (key === 'product_type' && typeof val === 'string') {
      out.product_type = val.trim().slice(0, 60);
    } else if (key === 'connectivity' && typeof val === 'string') {
      out.connectivity = val.trim().slice(0, 40);
    } else if (key === 'features' && Array.isArray(val)) {
      out.features = val
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 5)
        .map((f) => f.trim().slice(0, 40));
    } else if (key === 'max_price' && typeof val === 'number' && Number.isFinite(val)) {
      if (val > 0 && val <= 50000000) {
        out.max_price = Math.round(val);
      }
    } else if (key === 'max_delivery_days' && typeof val === 'number' && Number.isFinite(val)) {
      if (val >= 1 && val <= 14) {
        out.max_delivery_days = Math.round(val);
      }
    } else if (key === 'city' && typeof val === 'string') {
      const matched = knownCities.find((c) => c.toLowerCase() === val.trim().toLowerCase());
      if (matched) out.city = matched;
    } else if (key === 'delivery_mode' && (val === 'quick' || val === 'standard')) {
      out.delivery_mode = val;
    } else if (key === 'sort_preference' && typeof val === 'string' && VALID_SORT.has(val)) {
      out.sort_preference = val as ComparisonCategory;
    }
  }

  return out;
}

/**
 * Deterministic rule-based filter extraction fallback (used when Gemini is unconfigured,
 * times out, or returns invalid JSON). Never invents products or prices.
 */
export function ruleBasedExtractFilters(
  message: string,
  knownCategories: string[],
  knownCities: string[]
): ValidatedAssistantFilters {
  const lower = message.toLowerCase();
  const filters: ValidatedAssistantFilters = {};

  // Match budget in rupees: "under 1000", "below ₹800", "max Rs 1500", "< 2000"
  const priceMatch = lower.match(/(?:under|below|max|upto|up to|less than|<)\s*(?:rs\.?|₹|inr)?\s*(\d{2,6})/);
  if (priceMatch) {
    const rupees = parseInt(priceMatch[1], 10);
    if (rupees > 0 && rupees <= 500000) {
      filters.max_price = rupees * 100;
    }
  }

  // Match city
  for (const city of knownCities) {
    if (lower.includes(city.toLowerCase())) {
      filters.city = city;
      break;
    }
  }

  // Match category by keywords
  if (/speaker|headphone|earphone|earbud|audio|soundbar|bluetooth|bluetoth/.test(lower)) {
    const c = knownCategories.find((cat) => /audio/i.test(cat));
    if (c) filters.category = c;
  } else if (/keyboard|mouse|webcam|hub|laptop|monitor|computing/.test(lower)) {
    const c = knownCategories.find((cat) => /computing/i.test(cat));
    if (c) filters.category = c;
  } else if (/watch|band|tracker|wearable|fitness/.test(lower)) {
    const c = knownCategories.find((cat) => /wearable/i.test(cat));
    if (c) filters.category = c;
  } else if (/lamp|purifier|coffee|kettle|home|kitchen/.test(lower)) {
    const c = knownCategories.find((cat) => /home/i.test(cat));
    if (c) filters.category = c;
  } else if (/charger|power\s?bank|cable|adapter|mobile|gan/.test(lower)) {
    const c = knownCategories.find((cat) => /mobile|power/i.test(cat));
    if (c) filters.category = c;
  }

  // Delivery mode
  if (/quick|fast|today|urgent|hub|express/.test(lower)) {
    filters.delivery_mode = 'quick';
    filters.sort_preference = 'fastest';
  }
  if (/cheap|budget|lowest|affordable/.test(lower)) {
    filters.sort_preference = 'budget';
  } else if (/best rated|top rated|trusted|highest rated/.test(lower)) {
    filters.sort_preference = 'rated';
  } else if (/value|balanced/.test(lower)) {
    filters.sort_preference = 'value';
  }

  // Extract core search keyword
  const keywordMatch = lower.match(
    /(bluetooth|bluetoth|speaker|earphones|headphones|keyboard|mouse|smartwatch|power bank|charger|lamp|purifier|webcam|earbuds)/
  );
  if (keywordMatch) {
    filters.q = keywordMatch[1];
  } else {
    const cleaned = lower
      .replace(/(?:under|below|max|upto|up to|less than|show|me|find|want|need|buy|get|in|from|with|for|rs\.?|₹|\d+)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 2) {
      filters.q = cleaned.slice(0, 60);
    }
  }

  return filters;
}
