import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Scale } from 'lucide-react';
import { apiRequest } from '../services/api';
import { formatPaise } from '../kit';
import { useApp } from '../context/AppContext';

interface CompareProduct {
  product_id: string;
  name: string;
  brand: string;
  category_name: string;
  min_price_paise: number | null;
  dealer_count: number;
  best_rating: number;
  specs: Record<string, string>;
}

export const CompareSpecsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { compareIds } = useApp();
  const idsParam = searchParams.get('ids') || compareIds.join(',');

  const [products, setProducts] = useState<CompareProduct[]>([]);
  const [specKeys, setSpecKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!idsParam) {
      setLoading(false);
      return;
    }
    apiRequest<{ products: CompareProduct[]; spec_keys: string[] }>(
      `/api/products/compare?ids=${encodeURIComponent(idsParam)}`
    )
      .then((res) => {
        setProducts(res.products || []);
        setSpecKeys(res.spec_keys || []);
      })
      .catch(() => {
        setProducts([]);
        setSpecKeys([]);
      })
      .finally(() => setLoading(false));
  }, [idsParam]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div>
        <Link to="/search" className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#111827]">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Browse &amp; Search</span>
        </Link>
        <h1
          className="text-3xl font-bold text-[#111827] tracking-tight mt-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Side-by-Side Product Specs
        </h1>
      </div>

      {loading ? (
        <div className="h-64 bg-white rounded-2xl border border-[#E2E8F0] animate-pulse" />
      ) : products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center space-y-3">
          <Scale className="w-8 h-8 text-[#94A3B8] mx-auto" />
          <p className="text-base font-semibold text-[#111827]">Select 2–3 products to compare specs</p>
          <p className="text-sm text-[#64748B]">
            Click the &ldquo;Specs&rdquo; button on any product card in Browse &amp; Search.
          </p>
          <Link to="/search" className="inline-block mt-2 rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white">
            Browse Products
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th className="p-4 text-xs font-semibold uppercase tracking-wider text-[#64748B] w-48">
                  Attribute
                </th>
                {products.map((p) => (
                  <th key={p.product_id} className="p-4 min-w-[220px]">
                    <p className="text-xs text-[#64748B]">{p.brand}</p>
                    <Link
                      to={`/products/${p.product_id}`}
                      className="text-sm font-semibold text-[#111827] hover:text-[#4F46E5]"
                    >
                      {p.name}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              <tr>
                <td className="p-4 font-medium text-[#64748B]">Best Price</td>
                {products.map((p) => (
                  <td key={p.product_id} className="p-4 font-semibold text-[#111827] tabular-nums font-mono">
                    {formatPaise(p.min_price_paise)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-4 font-medium text-[#64748B]">Active Dealers</td>
                {products.map((p) => (
                  <td key={p.product_id} className="p-4 text-[#111827] tabular-nums">
                    {p.dealer_count} ({p.best_rating.toFixed(1)} top rating)
                  </td>
                ))}
              </tr>
              {specKeys.map((key) => (
                <tr key={key}>
                  <td className="p-4 font-medium text-[#64748B] capitalize">{key.replace(/_/g, ' ')}</td>
                  {products.map((p) => (
                    <td key={p.product_id} className="p-4 text-[#111827]">
                      {p.specs?.[key] ? String(p.specs[key]) : 'Not available'}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="p-4 font-medium text-[#64748B]">Actions</td>
                {products.map((p) => (
                  <td key={p.product_id} className="p-4">
                    <Link
                      to={`/products/${p.product_id}/compare`}
                      className="inline-block rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-3.5 py-2 text-xs font-semibold text-white"
                    >
                      Compare Dealer Offers
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
