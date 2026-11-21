import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Send, ShoppingCart, Sparkles } from 'lucide-react';
import { apiRequest, ApiError } from '../services/api';
import { formatPaise } from '../kit';
import { useApp } from '../context/AppContext';

interface AssistantOffer {
  offer_id: string;
  product_id: string;
  product_name?: string;
  shop_name: string;
  dealer_city: string;
  selling_price: number;
  dealer_rating: number;
  sellable_free_units: number;
  effective_delivery_days: number;
  quick_available: boolean;
  reason: string;
}

interface AssistantResponse {
  filters: Record<string, unknown>;
  results: AssistantOffer[];
  message: string;
  fallback: boolean;
}

const SAMPLE_PROMPTS = [
  'Find a bluetooth speaker under ₹800 with fast delivery',
  'Best rated wireless headphones available in Bengaluru',
  'Show affordable computing peripherals under ₹2500',
];

export const AssistantPage: React.FC = () => {
  const { token, refreshCartCount, notify } = useApp();
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runQuery = async (text: string) => {
    if (!token) {
      notify('info', 'Sign in to use the Shopping Assistant.');
      navigate('/login?next=/assistant');
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AssistantResponse>('/api/shopping-assistant', {
        method: 'POST',
        body: { message: trimmed },
      });
      setResponse(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Assistant request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (offer: AssistantOffer) => {
    try {
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: { offer_id: offer.offer_id, quantity: 1 },
      });
      await refreshCartCount();
      notify('success', `Added offer from ${offer.shop_name} to cart.`);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Failed to add to cart.');
    }
  };

  const activeFilterEntries = response
    ? Object.entries(response.filters).filter(([, v]) => v !== undefined && v !== null && v !== '')
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#4F46E5]">
          <Sparkles className="w-4 h-4" />
          <span>Structured Filter Extraction</span>
        </div>
        <h1
          className="text-3xl font-bold text-[#111827] tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          BazaarBridge Shopping Assistant
        </h1>
        <p className="text-sm text-[#64748B]">
          Describe what you need in plain English. The assistant extracts validated filters and returns only real, in-stock offers verified against PostgreSQL.
        </p>
      </div>

      {/* Prompt Input + 3 Sample Prompts */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runQuery(input);
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <label htmlFor="assistant-prompt" className="sr-only">
            Describe what you are shopping for
          </label>
          <input
            id="assistant-prompt"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Bluetooth speaker under ₹800 with fastest delivery..."
            className="flex-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#111827] focus:bg-white focus:border-[#4F46E5] focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 px-5 py-3 text-sm font-semibold text-white cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>{loading ? 'Searching...' : 'Find Deals'}</span>
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {SAMPLE_PROMPTS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => {
                setInput(sample);
                runQuery(sample);
              }}
              className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#4F46E5] px-3 py-1.5 text-xs text-[#111827] transition-colors cursor-pointer"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-5">
          {response.fallback && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
              Showing normal search results (deterministic rule-based filter extraction active).
            </div>
          )}

          <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3">
            <p className="text-sm font-medium text-[#111827]">{response.message}</p>
            {activeFilterEntries.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                <span className="font-semibold text-[#111827]">Validated filters:</span>
                {activeFilterEntries.map(([k, v]) => (
                  <span key={k} className="font-mono text-[#4F46E5]">
                    {k}={k === 'max_price' ? formatPaise(Number(v)) : String(v)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {response.results.map((offer) => (
              <div
                key={offer.offer_id}
                className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <Link
                    to={`/products/${offer.product_id}`}
                    className="text-base font-semibold text-[#111827] hover:text-[#4F46E5] inline-flex items-center gap-1"
                  >
                    <span>{offer.shop_name}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                  <p className="text-xs text-[#64748B]">
                    {offer.dealer_city} · {offer.dealer_rating.toFixed(1)} rating · {offer.sellable_free_units} in stock
                  </p>
                  <p className="text-xs text-[#111827]">{offer.reason}</p>
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between">
                  <span
                    className="text-lg font-bold text-[#111827] tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {formatPaise(offer.selling_price)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/products/${offer.product_id}/compare`}
                      className="text-xs font-medium text-[#4F46E5] hover:underline"
                    >
                      Compare
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleAdd(offer)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
