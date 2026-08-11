import { Search, Star, ArrowLeft } from 'lucide-react';
import { Product } from '../src/types';
import ProductCard from './ProductCard';

interface BillingProductGridProps {
  categories: string[];
  billingCategory: string;
  onSetCategory: (cat: string) => void;
  billingSearch: string;
  onSetSearch: (val: string) => void;
  billingSearchRef: React.RefObject<HTMLInputElement | null>;
  onBackToOrders: () => void;
  showFavoritesOnly: boolean;
  onToggleFavorites: () => void;
  products: Product[];
  categoryColors: Record<string, string>;
  moduleSettings: { showImagesInBilling?: boolean; showItemCodeOnCard?: boolean };
  currencySymbol: string;
  onAddProduct: (product: Product, variant?: any) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent) => void;
}

// Darken a hex color by a fixed amount for the left accent bar
function darkenHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  if (isNaN(num)) return hex;
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default function BillingProductGrid({
  categories, billingCategory, onSetCategory,
  billingSearch, onSetSearch, billingSearchRef,
  onBackToOrders, showFavoritesOnly, onToggleFavorites,
  products, categoryColors, moduleSettings, currencySymbol,
  onAddProduct, onSearchKeyDown,
}: BillingProductGridProps) {
  const showImages = moduleSettings.showImagesInBilling !== false;

  // Standard high-level categories for fast access
  const defaultCategories = ["All", ...categories];

  // Compute filtered products once to avoid duplicating filter logic
  const filteredProducts = products
    .filter(p => billingCategory === 'All' || p.category === billingCategory)
    .filter(p => !billingSearch || p.name.toLowerCase().includes(billingSearch.toLowerCase()) || p.code.toLowerCase().includes(billingSearch.toLowerCase()))
    .filter(p => !showFavoritesOnly || p.favorite)
    .filter(p => p.availability);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#f8fafc] p-4 gap-4">
      {/* Top Bar: Search input + Back button + Favorites toggle */}
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onBackToOrders}
          className="p-3 bg-white border border-gray-300 rounded-xl text-gray-700 hover:text-[var(--brand-color)] hover:border-[var(--brand-color)] hover:shadow transition-all shrink-0 cursor-pointer"
          title="Back to Orders"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            ref={billingSearchRef as any}
            type="text"
            placeholder="Search items by name or code... (F1)"
            value={billingSearch}
            onChange={(e) => onSetSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] focus:border-transparent shadow-sm bg-white"
          />
        </div>
        <button
          onClick={onToggleFavorites}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer shadow-sm ${
            showFavoritesOnly
              ? 'bg-amber-500 text-white border border-amber-600 shadow-md'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-amber-50 hover:border-amber-300'
          }`}
          title="Toggle Favorites"
        >
          <Star className={`w-4 h-4 ${showFavoritesOnly ? 'fill-white' : 'fill-amber-400 text-amber-500'}`} />
          <span>Favorites</span>
        </button>
      </div>

      {/* Category Navigation Bar — Large, touch-friendly buttons */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0 no-scrollbar" data-tour="category-chips">
        {defaultCategories.map((cat) => {
          const baseColor = cat === 'All' ? '#004ac6' : (categoryColors[cat] || '#64748b');
          const isActive = billingCategory === cat;
          const activeBg = cat === 'All' ? '#004ac6' : darkenHex(baseColor, 15);
          const chipCount = cat !== 'All' ? products.filter(p => p.category === cat && p.availability).length : products.filter(p => p.availability).length;

          return (
            <button
              key={cat}
              onClick={() => onSetCategory(cat)}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all flex items-center gap-2 shrink-0 border cursor-pointer ${
                isActive
                  ? 'text-white shadow-md border-transparent scale-[1.02]'
                  : 'text-gray-800 bg-white border-gray-300 hover:bg-gray-100 hover:border-gray-400'
              }`}
              style={isActive ? { backgroundColor: activeBg } : {}}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: isActive ? '#ffffff' : baseColor,
                }}
              />
              <span>{cat === 'All' ? 'ALL ITEMS' : cat}</span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {chipCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Product Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 pb-6" data-tour="product-grid">
          {filteredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryColor={categoryColors[product.category] || '#e5e7eb'}
              showImages={showImages}
              showItemCode={moduleSettings.showItemCodeOnCard ?? false}
              currencySymbol={currencySymbol}
              onAddProduct={onAddProduct}
            />
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white rounded-2xl border border-dashed border-gray-300 my-4">
            <Search className="w-12 h-12 mb-3 text-gray-300" />
            <p className="text-base font-bold text-gray-700">No products found</p>
            <p className="text-xs text-gray-500 mt-1">Try selecting a different category or clearing the search</p>
          </div>
        )}
      </div>
    </div>
  );
}
