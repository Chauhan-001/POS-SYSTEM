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
    p.isCombo === n.isCombo &&
    (p.comboComponentIds?.length ?? 0) === (n.comboComponentIds?.length ?? 0) &&
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
  const catTextCls = CATEGORY_TEXT_COLORS[product.category] || 'text-gray-700 bg-gray-100 border-gray-300';

  if (!showImages) {
    // ===== NO-IMAGE MODE: tall vertical card =====
    const darkBarColor = categoryColor === '#e5e7eb' ? '#9ca3af' : darkenHex(categoryColor, 40);
    return (
      <div
        key={product.id}
        data-tour="product-card"
        className="bg-[var(--color-bg-white)] rounded-xl border border-gray-200 hover:border-[var(--brand-color)] hover:shadow-lg transition-all cursor-pointer group relative flex flex-col overflow-hidden min-h-[128px] p-3.5 select-none"
        onClick={() => onAddProduct(product, undefined)}
      >
        <div className="absolute left-0 top-0 bottom-0 w-[6px]" style={{ backgroundColor: darkBarColor }} />
        <div className="pl-2 flex-1 flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-extrabold text-gray-900 leading-snug truncate">{product.name}</h4>
              {showItemCode && (
                <p className="text-[10px] text-gray-400 font-mono mt-0.5">#{product.code}</p>
              )}
              <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${catTextCls}`}>
                {product.category}
              </span>
            </div>
            {product.favorite && (
              <Star className="w-4 h-4 text-amber-500 fill-amber-400 shrink-0 mt-0.5" />
            )}
          </div>
          <div className="flex items-center justify-between gap-1.5 mt-2 pt-2 border-t border-gray-100">
            <p className="text-base font-extrabold font-mono text-[var(--brand-color)]">
              {((product.variants && product.variants.length > 0) || (product.menuConfig?.variantConfigurations && product.menuConfig.variantConfigurations.length > 0)) ? (
                <span className="text-[11px] font-bold text-gray-500 font-sans">{product.variants?.length || product.menuConfig?.variantConfigurations?.length || 0} variant{((product.variants?.length || product.menuConfig?.variantConfigurations?.length || 0) === 1) ? '' : 's'}</span>
              ) : (
                <>{currencySymbol}{((product.isCombo ? (product.comboPrice ?? product.price) : product.price) || 0).toFixed(2)}</>
              )}
              {product.isCombo && (
                <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full ml-1 uppercase tracking-wide">Combo</span>
              )}
            </p>
            <div className="w-9 h-9 rounded-full bg-[var(--brand-color)] text-white flex items-center justify-center shadow-md group-hover:scale-110 active:scale-95 transition-all shrink-0">
              <Plus className="w-5 h-5 stroke-[2.5]" />
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
      className="bg-[var(--color-bg-white)] rounded-xl border border-gray-200 hover:border-[var(--brand-color)] hover:shadow-lg transition-all cursor-pointer group relative flex flex-col overflow-hidden select-none"
      onClick={() => onAddProduct(product, undefined)}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1.5 z-10" style={{ backgroundColor: categoryColor }} />
      <div
        className="w-full h-24 rounded-t-xl overflow-hidden shrink-0 relative"
        style={{ background: `linear-gradient(135deg, ${categoryColor}1a, ${categoryColor}40)` }}
      >
        {/* Placeholder initial — visible whenever the product has no photo
            or the photo fails to load (broken link / offline). */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-black select-none" style={{ color: categoryColor }}>
            {(product.name || '?').charAt(0).toUpperCase()}
          </span>
        </div>
        {product.image && (
          <img
            src={product.image}
            alt={product.name}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {product.favorite && (
          <div className="absolute top-2 right-2 z-10 bg-white/90 backdrop-blur-sm p-1 rounded-full shadow-sm">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
          </div>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col justify-between gap-2">
        <div>
          <h4 className="text-sm font-extrabold text-gray-900 truncate leading-snug">{product.name}</h4>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${catTextCls}`}>
              {product.category}
            </span>
            {showItemCode && (
              <span className="text-[10px] text-gray-400 font-mono">#{product.code}</span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-1 mt-1 pt-2 border-t border-gray-100">
          <p className="text-base font-extrabold font-mono text-[var(--brand-color)]">
            {((product.variants && product.variants.length > 0) || (product.menuConfig?.variantConfigurations && product.menuConfig.variantConfigurations.length > 0)) ? (
              <span className="text-[11px] font-bold text-gray-500 font-sans">{product.variants?.length || product.menuConfig?.variantConfigurations?.length || 0} variant{((product.variants?.length || product.menuConfig?.variantConfigurations?.length || 0) === 1) ? '' : 's'}</span>
            ) : (
              <>{currencySymbol}{((product.isCombo ? (product.comboPrice ?? product.price) : product.price) || 0).toFixed(2)}</>
            )}
            {product.isCombo && (
              <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full ml-1 uppercase tracking-wide">Combo</span>
            )}
          </p>
          <div className="w-9 h-9 rounded-full bg-[var(--brand-color)] text-white flex items-center justify-center shadow-md group-hover:scale-110 active:scale-95 transition-all shrink-0">
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ProductCard, areEqual);
