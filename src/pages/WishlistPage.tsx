import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { apiRequest } from '../services/api';
import { useApp } from '../context/AppContext';
import { ProductCard, type ProductSummaryCardData } from '../components/ProductCard';

interface WishlistEntry {
  wishlist_id: string;
  product_id: string;
  added_at: string;
  product: ProductSummaryCardData;
}

export const WishlistPage: React.FC = () => {
  const { token, wishlistIds } = useApp();
  const [items, setItems] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiRequest<{ items: WishlistEntry[] }>('/api/wishlist')
      .then((res) => setItems(res.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [token, wishlistIds]);

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <Heart className="w-10 h-10 text-[#64748B] mx-auto" />
        <h1 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: 'var(--font-display)' }}>
          Sign in to view your wishlist
        </h1>
        <Link to="/login?next=/wishlist" className="inline-block rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1
            className="text-3xl font-bold text-[#111827] tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Saved Wishlist
          </h1>
          <p className="text-sm text-[#64748B] mt-1">Products you have bookmarked to compare dealer deals later.</p>
        </div>
        <Link to="/search" className="text-sm font-medium text-[#4F46E5] hover:underline">
          Browse catalog
        </Link>
      </div>

      {loading ? (
        <div className="h-56 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center space-y-3">
          <p className="text-base font-semibold text-[#111827]">Your wishlist is empty</p>
          <p className="text-sm text-[#64748B]">Click the heart icon on any product card to save it here.</p>
          <Link to="/search" className="inline-block mt-2 rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white">
            Explore Products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((w) => (
            <ProductCard key={w.wishlist_id} product={w.product} />
          ))}
        </div>
      )}
    </div>
  );
};
