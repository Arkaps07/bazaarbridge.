import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ArrowUpRight, Check } from 'lucide-react';
import { getCategoryImage } from '../assets/media';
import { formatPaise } from '../kit';
import { useApp } from '../context/AppContext';

export interface ProductSummaryCardData {
  product_id: string;
  name: string;
  brand: string;
  category_name: string;
  dealer_count: number;
  min_price_paise: number | null;
  max_price_paise?: number | null;
  best_rating: number;
  total_free_units: number;
  quick_available: boolean;
  cities?: string[];
  has_transfer_only?: boolean;
}

export const ProductCard: React.FC<{ product: ProductSummaryCardData }> = ({ product }) => {
  const { wishlistIds, toggleWishlist, compareIds, toggleCompareId, featureFlags } = useApp();
  const [imgFailed, setImgFailed] = useState(false);

  const isWishlisted = wishlistIds.has(product.product_id);
  const isCompared = compareIds.includes(product.product_id);

  return (
    <article className="group bg-white rounded-xl border border-[#E2E8F0] overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[4/3] bg-[#F1F5F9] overflow-hidden">
        <Link to={`/products/${product.product_id}`} className="block w-full h-full">
          {!imgFailed ? (
            <img
              src={getCategoryImage(product.category_name)}
              alt={`${product.brand} ${product.name}`}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-6 text-center text-sm font-medium text-[#64748B]">
              {product.name}
            </div>
          )}
        </Link>

        {featureFlags.has('FEATURE_WISHLIST') && (
          <button
            type="button"
            onClick={() => toggleWishlist(product.product_id)}
            aria-label={isWishlisted ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
            className={`absolute top-3 right-3 p-2 rounded-lg bg-white/90 backdrop-blur-sm border border-[#E2E8F0] transition-colors cursor-pointer ${
              isWishlisted ? 'text-[#DC2626]' : 'text-[#64748B] hover:text-[#111827]'
            }`}
          >
            <Heart className={`w-4 h-4 ${isWishlisted ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
        <div className="space-y-1.5">
          {/* Clean unboxed metadata with middot separators (zero pill spam) */}
          <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <span>{product.brand}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{product.category_name}</span>
          </div>

          <Link
            to={`/products/${product.product_id}`}
            className="block text-base font-semibold text-[#111827] leading-snug hover:text-[#4F46E5] transition-colors line-clamp-2"
          >
            {product.name}
          </Link>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#64748B] pt-0.5">
            <span>{product.dealer_count} {product.dealer_count === 1 ? 'dealer' : 'dealers'}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{product.best_rating.toFixed(1)} rating</span>
            <span aria-hidden="true">·</span>
            <span className={product.quick_available ? 'text-[#16A34A] font-medium' : ''}>
              {product.quick_available
                ? 'Quick eligible'
                : product.has_transfer_only
                  ? 'Transfer ~2–3d'
                  : 'Standard'}
            </span>
          </div>
        </div>

        <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-[#64748B]">Starting from</p>
            <p className="text-lg font-semibold text-[#111827] tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
              {formatPaise(product.min_price_paise)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {featureFlags.has('FEATURE_COMPARE') && (
              <button
                type="button"
                onClick={() => toggleCompareId(product.product_id)}
                aria-label={`Compare ${product.name} specs`}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  isCompared
                    ? 'border-[#4F46E5] bg-indigo-50 text-[#4F46E5]'
                    : 'border-[#E2E8F0] text-[#64748B] hover:text-[#111827]'
                }`}
              >
                {isCompared ? (
                  <span className="inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Added
                  </span>
                ) : (
                  'Specs'
                )}
              </button>
            )}

            <Link
              to={`/products/${product.product_id}/compare`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#4F46E5] bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <span>Offers</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
};
