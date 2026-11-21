import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Search,
  MapPin,
  Layers,
  Clock,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { apiRequest } from '../services/api';
import { MEDIA_ASSETS, getCategoryImage } from '../assets/media';
import { ProductCard, type ProductSummaryCardData } from '../components/ProductCard';

interface CategoryRow {
  category_id: string;
  category_name: string;
}

interface DealerSummary {
  dealer_id: string;
  shop_name: string;
  city: string;
  state: string;
  dealer_rating: number;
  total_reviews: number;
}

interface ProductsResponse {
  categories: CategoryRow[];
  dealers: DealerSummary[];
  products: ProductSummaryCardData[];
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<ProductsResponse>('/api/products')
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setError('Could not load catalog from BazaarBridge API.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  };

  const featuredProducts = data?.products.slice(0, 9) ?? [];
  const topDealers = [...(data?.dealers ?? [])]
    .sort((a, b) => b.dealer_rating - a.dealer_rating)
    .slice(0, 6);

  return (
    <div className="space-y-20 pb-8">
      {/* Split Editorial Hero (Above the Fold, Clean Light Canvas) */}
      <section className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#4F46E5]">
                  Bengaluru &amp; Regional Local Dealers
                </p>
                <h1
                  className="text-4xl sm:text-5xl font-bold text-[#111827] tracking-tight leading-[1.1]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Better Deals. Smarter Choices. Delivered Locally.
                </h1>
                <p className="text-base sm:text-lg text-[#64748B] leading-relaxed max-w-xl">
                  Compare verified local dealers across price, delivery speed, ratings, value score, and live stock — with atomic reservations and Quick, Standard, or Inter-City Transfer fulfilment.
                </p>
              </div>

              {/* Prominent Hero Search Bar */}
              <form onSubmit={handleHeroSearch} className="flex flex-col sm:flex-row gap-2.5 max-w-xl">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <label htmlFor="hero-search" className="sr-only">
                    Search products, brands, or categories
                  </label>
                  <input
                    id="hero-search"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder='Try "bluetoth", "headphones", or "smartwatch"...'
                    className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-4 py-3 text-sm text-[#111827] placeholder:text-[#64748B] focus:bg-white focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-6 py-3 text-sm font-semibold text-white transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Search Deals</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-sm text-[#64748B]">
                <Link
                  to="/products/50000000-0000-4000-8000-000000000001/compare"
                  className="font-medium text-[#4F46E5] hover:underline inline-flex items-center gap-1"
                >
                  <span>Compare 5-Dealer Flagship Speaker</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
                <Link to="/outside-bangalore" className="hover:text-[#111827]">
                  Explore Mysuru &amp; Regional Transfers
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6 flex">
              <div className="relative w-full min-h-[280px] lg:min-h-[400px] rounded-2xl overflow-hidden border border-[#E2E8F0] bg-[#F1F5F9]">
                <img
                  src={MEDIA_ASSETS.hero}
                  alt="Curated modern electronics available across Bengaluru local dealers on BazaarBridge"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Browse by Category */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-semibold text-[#111827] tracking-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Browse by Category
            </h2>
            <p className="text-sm text-[#64748B] mt-1">
              Explore live offers across 40 electronics SKUs stocked across Bengaluru hubs, warehouses, and regional depots.
            </p>
          </div>
          <Link
            to="/search"
            className="text-sm font-medium text-[#4F46E5] hover:underline whitespace-nowrap"
          >
            View full catalog
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {(data?.categories ?? []).map((cat) => (
            <Link
              key={cat.category_id}
              to={`/search?category=${encodeURIComponent(cat.category_name)}`}
              className="group bg-white rounded-xl border border-[#E2E8F0] overflow-hidden hover:border-[#4F46E5] transition-all"
            >
              <div className="aspect-[4/3] bg-[#F1F5F9] overflow-hidden">
                <img
                  src={getCategoryImage(cat.category_name)}
                  alt={cat.category_name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              <div className="p-3.5">
                <p className="text-sm font-semibold text-[#111827] group-hover:text-[#4F46E5] transition-colors">
                  {cat.category_name}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Products & Best Price Offers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-semibold text-[#111827] tracking-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Featured Products &amp; Best Price Offers
            </h2>
            <p className="text-sm text-[#64748B] mt-1">
              Live starting prices verified directly against PostgreSQL inventory. Click any item to compare dealers.
            </p>
          </div>
          <Link
            to="/search"
            className="text-sm font-medium text-[#4F46E5] hover:underline whitespace-nowrap"
          >
            Browse all 40 products
          </Link>
        </div>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-[#E2E8F0] h-80 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-[#DC2626]">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.product_id} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* How BazaarBridge Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 lg:p-10 space-y-8">
          <div className="max-w-2xl">
            <h2
              className="text-2xl font-semibold text-[#111827] tracking-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              How BazaarBridge Works
            </h2>
            <p className="text-sm text-[#64748B] mt-1.5">
              Every comparison score, stock hold, delivery fee, and shipment update is computed on the backend from authoritative inventory records.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2.5">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 text-[#4F46E5] flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-[#111827]">1. Compare Across 5 Dimensions</h3>
              <p className="text-sm text-[#64748B] leading-relaxed">
                Rank dealers on Best Budget, Fastest Delivery, Best Rated, Best Value (45/25/20/10 weighted score), or Most Available — with transparent reason strings.
              </p>
            </div>

            <div className="space-y-2.5">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-[#16A34A] flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-[#111827]">2. Atomic 10-Minute Holds</h3>
              <p className="text-sm text-[#64748B] leading-relaxed">
                Reserving at checkout locks exact sellable units in PostgreSQL so two shoppers can never oversell the final unit in stock.
              </p>
            </div>

            <div className="space-y-2.5">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-[#D97706] flex items-center justify-center">
                <Truck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-[#111827]">3. Hybrid Fulfilment Splitting</h3>
              <p className="text-sm text-[#64748B] leading-relaxed">
                Mixed baskets split automatically into Quick (local Koramangala Hub), Standard (Bengaluru Warehouse), and Transfer (Mysuru Holding Depot) groups with OTP delivery proofs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Top-Rated Local Dealers + Outside Bangalore CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h2
                className="text-2xl font-semibold text-[#111827] tracking-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Top-Rated Verified Dealers
              </h2>
              <p className="text-sm text-[#64748B] mt-1">
                Seeded SAMPLE dealer ratings across Bengaluru and Mysuru storefronts.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {topDealers.map((dealer) => (
              <Link
                key={dealer.dealer_id}
                to={`/search?city=${encodeURIComponent(dealer.city)}`}
                className="bg-white rounded-xl border border-[#E2E8F0] p-5 hover:border-[#4F46E5] transition-colors flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#111827]">{dealer.shop_name}</p>
                  <p className="text-xs text-[#64748B] inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{dealer.city}, {dealer.state}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-[#111827] tabular-nums">
                    {dealer.dealer_rating.toFixed(1)} / 5
                  </p>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    {dealer.total_reviews} reviews
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white rounded-2xl border border-[#E2E8F0] p-6 space-y-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-[#111827] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3
            className="text-lg font-semibold text-[#111827]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Outside Bangalore Deals
          </h3>
          <p className="text-sm text-[#64748B] leading-relaxed">
            Shop regional dealers from Mysuru and beyond — clearly separated into items already held in Bangalore stock versus offers transferred from regional depots (~2–3 days).
          </p>
          <Link
            to="/outside-bangalore"
            className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] hover:text-[#4F46E5] px-4 py-2.5 text-sm font-medium text-[#111827] transition-colors"
          >
            <span>View Outside Bangalore Catalog</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
};
