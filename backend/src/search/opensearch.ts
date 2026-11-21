import { Client } from '@opensearch-project/opensearch';
import { envConfig } from '../config/env';

export const OFFERS_INDEX = 'offers';

/**
 * Locked v7.2 OpenSearch "offers" document shape.
 * NOT INDEXED: quick_available, hub_units, 30-day reference price, OTPs (raw or proofs),
 * phone numbers, addresses, secrets.
 */
export interface OpenSearchOfferDoc {
  offer_id: string;
  product_id: string;
  product_name: string;
  brand: string;
  category_name: string;
  specs: Record<string, string | number | boolean>;
  dealer_id: string;
  shop_name: string;
  dealer_city: string;
  dealer_state: string;
  origin_city: string;
  origin_state: string;
  is_outside_bangalore: boolean;
  fulfilment_route: string;
  selling_price: number;
  available_units: number; // sellable AND hub-active only
  home_units: number;
  eligible_modes: string[];
  bangalore_delivery_days: number | null;
  transfer_days_max: number | null;
  effective_days: number;
  dealer_rating: number;
  total_reviews: number;
  verified: boolean;
  warranty_months: number;
  revision: number;
}

export interface SearchQueryInput {
  q?: string;
  category?: string;
  maxPricePaise?: number;
  city?: string;
  limit?: number;
}

export interface SearchHit {
  offer_id: string;
  product_id: string;
  score: number;
}

let osClient: Client | null = null;

export function getOpenSearchClient(): Client | null {
  if (!envConfig.isOpenSearchConfigured) return null;
  if (!osClient) {
    osClient = new Client({
      node: envConfig.openSearchUrl,
      auth: envConfig.openSearchUser
        ? {
            username: envConfig.openSearchUser,
            password: process.env.OPENSEARCH_PASSWORD || '',
          }
        : undefined,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }
  return osClient;
}

/**
 * Levenshtein edit distance for local preview fuzzy search parity ("bluetoth" -> "bluetooth" = distance 1).
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function fuzzyTokenMatch(queryToken: string, candidateText: string): number {
  const words = candidateText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const q = queryToken.toLowerCase();
  if (!q) return 1;

  let best = 0;
  for (const w of words) {
    if (w === q) return 3;
    if (w.startsWith(q) || w.includes(q)) {
      best = Math.max(best, 2.2);
      continue;
    }
    const maxDist = q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2;
    if (maxDist > 0 && Math.abs(w.length - q.length) <= maxDist) {
      const d = editDistance(q, w);
      if (d <= maxDist) {
        best = Math.max(best, 1.8 - d * 0.35);
      }
    }
  }
  return best;
}

/**
 * Local Preview revision-guarded index mirror used ONLY when OPENSEARCH_URL is unset.
 * Mirrors exact external_gte revision guard semantics (409 -> outcome: 'stale').
 */
class LocalPreviewSearchIndex {
  private docs = new Map<string, OpenSearchOfferDoc>();

  upsert(doc: OpenSearchOfferDoc): { revision: number; outcome: 'written' | 'stale' } {
    const existing = this.docs.get(doc.offer_id);
    if (existing && doc.revision < existing.revision) {
      return { revision: existing.revision, outcome: 'stale' };
    }
    this.docs.set(doc.offer_id, { ...doc });
    return { revision: doc.revision, outcome: 'written' };
  }

  getDoc(offerId: string): OpenSearchOfferDoc | null {
    return this.docs.get(offerId) ?? null;
  }

  getAllDocs(): OpenSearchOfferDoc[] {
    return Array.from(this.docs.values());
  }

  clear(): void {
    this.docs.clear();
  }

  search(params: SearchQueryInput): { hits: SearchHit[] } {
    const limit = params.limit ?? 100;
    const tokens = (params.q || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const scored: SearchHit[] = [];

    for (const doc of this.docs.values()) {
      if (doc.available_units <= 0) continue;

      // v7.2 lowercase keyword exact filters
      if (
        params.category &&
        doc.category_name.toLowerCase() !== params.category.trim().toLowerCase()
      ) {
        continue;
      }
      if (
        params.city &&
        doc.dealer_city.toLowerCase() !== params.city.trim().toLowerCase()
      ) {
        continue;
      }
      if (
        typeof params.maxPricePaise === 'number' &&
        Number.isFinite(params.maxPricePaise) &&
        doc.selling_price > params.maxPricePaise
      ) {
        continue;
      }

      let score = 1;
      if (tokens.length > 0) {
        const searchable = `${doc.product_name} ${doc.brand} ${doc.category_name} ${doc.shop_name} ${doc.dealer_city}`;
        let matchedTokens = 0;
        let totalTokenScore = 0;
        for (const t of tokens) {
          const s = fuzzyTokenMatch(t, searchable);
          if (s > 0) {
            matchedTokens += 1;
            totalTokenScore += s;
          }
        }
        if (matchedTokens === 0) continue;
        // Require at least all tokens or strong partial match
        if (tokens.length > 1 && matchedTokens < Math.ceil(tokens.length * 0.5)) continue;
        score = totalTokenScore + (matchedTokens === tokens.length ? 2 : 0);
      }

      scored.push({
        offer_id: doc.offer_id,
        product_id: doc.product_id,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score || a.offer_id.localeCompare(b.offer_id));
    return { hits: scored.slice(0, limit) };
  }
}

export const localSearchIndex = new LocalPreviewSearchIndex();

export async function ensureIndex(): Promise<{ engine: 'aiven_opensearch' | 'local_sandbox'; ready: boolean }> {
  const client = getOpenSearchClient();
  if (!client) {
    return { engine: 'local_sandbox', ready: true };
  }

  const exists = await client.indices.exists({ index: OFFERS_INDEX });
  if (!exists.body) {
    await client.indices.create({
      index: OFFERS_INDEX,
      body: {
        settings: {
          analysis: {
            normalizer: {
              lowercase_normalizer: {
                type: 'custom',
                filter: ['lowercase', 'asciifolding'],
              },
            },
          },
        },
        mappings: {
          properties: {
            offer_id: { type: 'keyword' },
            product_id: { type: 'keyword' },
            product_name: { type: 'text' },
            brand: { type: 'text' },
            category_name: { type: 'keyword', normalizer: 'lowercase_normalizer' },
            dealer_id: { type: 'keyword' },
            shop_name: { type: 'text' },
            dealer_city: { type: 'keyword', normalizer: 'lowercase_normalizer' },
            dealer_state: { type: 'keyword', normalizer: 'lowercase_normalizer' },
            origin_city: { type: 'keyword', normalizer: 'lowercase_normalizer' },
            origin_state: { type: 'keyword', normalizer: 'lowercase_normalizer' },
            is_outside_bangalore: { type: 'boolean' },
            fulfilment_route: { type: 'keyword' },
            selling_price: { type: 'long' },
            available_units: { type: 'integer' },
            home_units: { type: 'integer' },
            eligible_modes: { type: 'keyword' },
            bangalore_delivery_days: { type: 'integer' },
            transfer_days_max: { type: 'integer' },
            effective_days: { type: 'integer' },
            dealer_rating: { type: 'float' },
            total_reviews: { type: 'integer' },
            verified: { type: 'boolean' },
            warranty_months: { type: 'integer' },
            revision: { type: 'long' },
          },
        },
      },
    });
  }
  return { engine: 'aiven_opensearch', ready: true };
}

export async function upsertOfferDoc(
  doc: OpenSearchOfferDoc
): Promise<{ revision: number; outcome: 'written' | 'stale' }> {
  const client = getOpenSearchClient();
  if (!client) {
    return localSearchIndex.upsert(doc);
  }

  try {
    await client.index({
      index: OFFERS_INDEX,
      id: doc.offer_id,
      version: doc.revision,
      version_type: 'external_gte',
      body: doc,
      refresh: true,
    });
    return { revision: doc.revision, outcome: 'written' };
  } catch (err: unknown) {
    const statusCode = (err as { meta?: { statusCode?: number }; statusCode?: number })?.meta?.statusCode
      ?? (err as { statusCode?: number })?.statusCode;
    if (statusCode === 409) {
      // 409 version_conflict = a NEWER revision is already indexed = SUCCESS
      return { revision: doc.revision, outcome: 'stale' };
    }
    throw err;
  }
}

export async function searchOffers(params: SearchQueryInput): Promise<{ hits: SearchHit[] }> {
  const client = getOpenSearchClient();
  if (!client) {
    return localSearchIndex.search(params);
  }

  const must: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [{ range: { available_units: { gt: 0 } } }];

  if (params.q && params.q.trim()) {
    must.push({
      multi_match: {
        query: params.q.trim(),
        fields: ['product_name^3', 'brand^2', 'shop_name', 'category_name'],
        fuzziness: 'AUTO',
        prefix_length: 1,
      },
    });
  } else {
    must.push({ match_all: {} });
  }

  if (params.category && params.category.trim()) {
    filter.push({ term: { category_name: params.category.trim().toLowerCase() } });
  }
  if (params.city && params.city.trim()) {
    filter.push({ term: { dealer_city: params.city.trim().toLowerCase() } });
  }
  if (typeof params.maxPricePaise === 'number' && Number.isFinite(params.maxPricePaise)) {
    filter.push({ range: { selling_price: { lte: params.maxPricePaise } } });
  }

  const resp = await client.search({
    index: OFFERS_INDEX,
    size: params.limit ?? 100,
    body: {
      _source: ['offer_id', 'product_id'],
      query: {
        bool: { must, filter },
      },
    },
  });

  const rawHits = (resp.body?.hits?.hits ?? []) as Array<{
    _score?: number;
    _source?: { offer_id: string; product_id: string };
  }>;

  return {
    hits: rawHits
      .filter((h) => h._source?.offer_id)
      .map((h) => ({
        offer_id: h._source!.offer_id,
        product_id: h._source!.product_id,
        score: h._score ?? 1,
      })),
  };
}

export async function getIndexedOfferDoc(offerId: string): Promise<OpenSearchOfferDoc | null> {
  const client = getOpenSearchClient();
  if (!client) {
    return localSearchIndex.getDoc(offerId);
  }
  try {
    const resp = await client.get({ index: OFFERS_INDEX, id: offerId });
    return (resp.body?._source as OpenSearchOfferDoc) ?? null;
  } catch {
    return null;
  }
}
