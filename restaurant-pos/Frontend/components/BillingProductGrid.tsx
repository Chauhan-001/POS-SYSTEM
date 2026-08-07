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

  // Compute filtered products once to avoid duplicating filter logic
  const filteredProducts = products
    .filter(p => billingCategory === 'All' || p.category === billingCategory)
    .filter(p => !billingSearch || p.name.toLowerCase().includes(billingSearch.toLowerCase()) || p.code.toLowerCase().includes(billingSearch.toLowerCase()))
    .filter(p => !showFavoritesOnly || p.favorite)
    .filter(p => p.availability);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#faf8ff] p-4">
      {/* Category filter chips — with visible colored dots and easy navigation */}
      <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0" data-tour="category-chips">
        {["All", ...categories].map((cat) => {
          const baseColor = cat === 'All' ? '#004ac6' : (categoryColors[cat] || '#e5e7eb');
          const isActive = billingCategory === cat;
          // Darker shade for the active chip background
          const activeBg = cat === 'All' ? '#004ac6' : darkenHex(baseColor, 20);
          const chipCount = cat !== 'All' ? products.filter(p => p.category === cat && p.availability).length : 0;
          return (
            <button key={cat} onClick={() => onSetCategory(cat)}
              className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 shrink-0 border ${
                isActive
                  ? 'text-white shadow-sm border-transparent'
                  : 'text-gray-600 bg-white border-[#e1e2ed] hover:bg-[#f3f3fe] hover:border-[#004ac6]/30'
              }`}
              style={isActive ? { backgroundColor: activeBg } : {}}
            >
              {/* Colored dot — always visible, even when active */}
              <span className="w-3 h-3 rounded-full shrink-0 ring-1 ring-offset-[2px]"
                style={{
                  backgroundColor: isActive ? '#ffffff' : baseColor,
                  ...(isActive ? {} : { boxShadow: `0 0 0 1.5px ${baseColor}40` }),
                }}
              />
              <span>{cat}</span>
              {chipCount > 0 && !isActive && (
                <span className="text-[9px] font-medium ml-0.5 opacity-60">{chipCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search bar with back button + favorites */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <button onClick={onBackToOrders}
          className="p-2 bg-white border border-[#e1e2ed] rounded-lg text-gray-500 hover:text-[#004ac6] hover:border-[#004ac6]/30 transition-all shadow-sm shrink-0"
          title="Back to Order Management"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input ref={billingSearchRef as any} type="text" placeholder="Search products by name or code... (F1)"
            value={billingSearch} onChange={(e) => onSetSearch(e.target.value)} onKeyDown={onSearchKeyDown}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
          />
        </div>
        <button onClick={onToggleFavorites}
          className={`flex items-center gap-1 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
            showFavoritesOnly ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-white text-gray-500 border border-[#e1e2ed] hover:bg-amber-50'
          }`}
          title="Toggle favorites only"
        >
          <Star className="w-3.5 h-3.5 fill-current" />
        </button>
      </div>

      {/* Product grid */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pb-6" data-tour="product-grid">
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
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Search className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No products found</p>
            <p className="text-xs mt-1">Try changing the category or search term</p>
          </div>
        )}
      </div>
    </div>
  );
}
