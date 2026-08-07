/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductCard — Memoized product card component for the billing product grid.
 * Extracted from BillingProductGrid to avoid re-rendering all products when
 * only search/filter state changes.
 */
import { memo } from 'react';
import { Star, Plus } from 'lucide-react';
import type { Product } from '../src/types';

// ─── Helpers ───────────────────────────────────────────────────

function darkenHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  if (isNaN(num)) return hex;
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const CATEGORY_TEXT_COLORS: Record<string, string> = {
  'Pizzas': 'text-red-700 bg-red-50 border-red-200',
  'Burgers': 'text-amber-700 bg-amber-50 border-amber-200',
  'Pasta': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'Beverages': 'text-sky-700 bg-sky-50 border-sky-200',
  'Desserts': 'text-pink-700 bg-pink-50 border-pink-200',
  'Appetizers': 'text-orange-700 bg-orange-50 border-orange-200',
  'Combo Offers': 'text-violet-700 bg-violet-50 border-violet-200',
  'Rice & Biryani': 'text-lime-700 bg-lime-50 border-lime-200',
  'Salads': 'text-green-700 bg-green-50 border-green-200',
  'Soups': 'text-teal-700 bg-teal-50 border-teal-200',
  'Wraps & Rolls': 'text-yellow-700 bg-yellow-50 border-yellow-200',
  'Indian Main Course': 'text-rose-700 bg-rose-50 border-rose-200',
};

// ─── Props ──────────────────────────────────────────────────────

export interface ProductCardProps {
  product: Product;
  categoryColor: string;
  showImages: boolean;
  showItemCode: boolean;
  currencySymbol: string;
  onAddProduct: (product: Product, variant?: any) => void;
}

// ─── Comparator ────────────────────────────────────────────────

function areEqual(prev: ProductCardProps, next: ProductCardProps): boolean {
  const p = prev.product;
  const n = next.product;
  return (
    p.id === n.id &&
    p.price === n.price &&
    p.favorite === n.favorite &&
    p.availability === n.availability &&
    p.image === n.image &&
    p.name === n.name &&
    p.category === n.category &&
    p.code === n.code &&
    (p.variants?.length ?? 0) === (n.variants?.length ?? 0) &&
    prev.categoryColor === next.categoryColor &&
    prev.showImages === next.showImages &&
    prev.showItemCode === next.showItemCode &&
    prev.currencySymbol === next.currencySymbol &&
    prev.onAddProduct === next.onAddProduct
  );
}

// ─── Component ─────────────────────────────────────────────────

function ProductCard({
  product, categoryColor, showImages,
  showItemCode, currencySymbol, onAddProduct,
}: ProductCardProps) {
  const catTextCls = CATEGORY_TEXT_COLORS[product.category] || 'text-gray-600 bg-gray-50 border-gray-200';

  if (!showImages) {
    // ===== NO-IMAGE MODE: tall vertical card =====
    const darkBarColor = categoryColor === '#e5e7eb' ? '#9ca3af' : darkenHex(categoryColor, 40);
    return (
      <div
        key={product.id}
        data-tour="product-card"
        className="bg-white rounded-xl border border-[#e1e2ed] hover:border-[#004ac6]/40 hover:shadow-md transition-all cursor-pointer group relative flex flex-col overflow-hidden min-h-[120px]"
        onClick={() => onAddProduct(product, undefined)}
      >
        <div className="absolute left-0 top-0 bottom-0 w-[5px]" style={{ backgroundColor: darkBarColor }} />
        <div className="pl-[14px] p-3 flex-1 flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex-1 min-w-0">
              <h4 className="text-[13px] font-bold text-[#191b23] leading-tight truncate">{product.name}</h4>
              {showItemCode && (
                <p className="text-[8px] text-gray-400 font-mono mt-0.5">#{product.code}</p>
              )}
              <span className={`inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${catTextCls}`}>
                {product.category}
              </span>
            </div>
            {product.favorite && (
              <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0 mt-0.5" />
            )}
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <p className="text-[13px] font-mono font-bold text-[#004ac6]">
              {currencySymbol}{product.price.toFixed(2)}
              {product.variants && product.variants.length > 0 && (
                <span className="text-[9px] text-gray-400 font-normal ml-1">+variants</span>
              )}
            </p>
            <div className="w-7 h-7 rounded-full bg-[#004ac6] text-white flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity shadow-sm shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== IMAGE MODE: card with image thumbnail =====
  return (
    <div
      key={product.id}
      data-tour="product-card"
      className="bg-white rounded-lg border border-[#e1e2ed] hover:border-[#004ac6]/40 hover:shadow-sm transition-all cursor-pointer group relative flex flex-col overflow-hidden"
      onClick={() => onAddProduct(product, undefined)}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: categoryColor }} />
      <div className="w-full h-[72px] rounded-t-lg overflow-hidden bg-gray-50 shrink-0">
        <img src={product.image} alt={product.name} className="w-full h-full object-cover" loading="lazy"
          onError={(e) => { (e.currentTarget).style.display = 'none'; }}
        />
      </div>
      <div className="p-2.5 flex-1 flex flex-col justify-between gap-1">
        <div className="flex items-start justify-between gap-1.5">
          <div className="flex-1 min-w-0">
            <h4 className="text-[11px] font-bold text-[#191b23] truncate leading-tight">{product.name}</h4>
            {showItemCode && (
              <p className="text-[7px] text-gray-400 font-mono mt-[1px]">#{product.code}</p>
            )}
            <span className={`inline-block mt-0.5 text-[8px] font-medium px-1 py-0.5 rounded-full border ${catTextCls}`}>
              {product.category}
            </span>
          </div>
          {product.favorite && (
            <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0 absolute top-1.5 right-1.5" />
          )}
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className="text-[11px] font-mono font-bold text-[#004ac6]">{currencySymbol}{product.price.toFixed(2)}</p>
          <div className="w-6 h-6 rounded-full bg-[#004ac6] text-white flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity shadow-sm shrink-0">
            <Plus className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ProductCard, areEqual);
