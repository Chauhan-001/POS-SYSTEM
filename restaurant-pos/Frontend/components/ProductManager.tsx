/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Search, Plus, Trash2, Edit2, CheckCircle, XCircle, Star, Sparkles, X, ArrowUpDown, GripVertical, Tag, Layers, Globe, Globe2, Loader2, SlidersHorizontal, Copy, Settings2, CheckCheck, ChefHat } from 'lucide-react';
import { Product, ProductVariant, Branch, ProductMenuConfig, ProductConfigRef } from '../src/types';
import * as api from '../src/api/client';
import { debugWarn } from '../src/utils/debugLog';
import ImageInput from './common/ImageInput';
import AddItemModal from './menu/AddItemModal';
import ProductConfigEditor from './menu/ProductConfigEditor';
import ProductRegistrationWizard from './menu/ProductRegistrationWizard';
import EasyRecipeMaker from './inventory/pages/EasyRecipeMaker';
import { useProductConfigSummary } from './menu/useProductConfig';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const CATEGORY_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e','#06b6d4',
  '#3b82f6','#6366f1','#a855f7','#ec4899','#14b8a6',
  '#f43f5e','#d946ef','#0ea5e9','#84cc16','#f59e0b',
];

interface ProductManagerProps {
  products: Product[];
  onUpdateProducts: (updated: Product[]) => void;
  currencySymbol: string;
  categories: string[];
  onUpdateCategories: (updated: string[]) => void;
  categoryColors: Record<string, string>;
  onUpdateCategoryColors: (colors: Record<string, string>) => void;
  branches?: Branch[];
  /** Restaurant-level tax config — powers automatic tax recommendation in registration. */
  defaultTaxRate?: number;
  taxRules?: Record<'prepared_food' | 'beverage' | 'packaged' | 'other', number | null>;
  branchProductPrices?: Record<string, Record<string, number>>;
  onSetBranchProductPrices?: (prices: Record<string, Record<string, number>>) => void;
  branchVariantPrices?: Record<string, Record<string, Record<string, number>>>;
  onSetBranchVariantPrices?: (prices: Record<string, Record<string, Record<string, number>>>) => void;
}

function SortableCategory({ id, onRemove, onEdit, color, onColorChange }: { id: string, onRemove: () => void, onEdit: (val: string) => void, color: string, onColorChange: (color: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 bg-[var(--color-bg-white)] p-2 rounded-lg border shadow-sm">
      <div {...attributes} {...listeners} className="cursor-grab text-gray-400">
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="relative">
        <div
          className="w-5 h-5 rounded-full border border-gray-300 cursor-pointer shrink-0"
          style={{ backgroundColor: color }}
          onClick={() => setShowPicker(!showPicker)}
          title="Change color"
        />
        {showPicker && (
          <div className="absolute top-7 left-0 z-10 bg-[var(--color-bg-white)] border border-gray-200 rounded-xl p-2 shadow-xl flex gap-1 flex-wrap w-40">
            {CATEGORY_PALETTE.map(c => (
              <div
                key={c}
                className="w-6 h-6 rounded-full border border-gray-200 cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                onClick={() => { onColorChange(c); setShowPicker(false); }}
              />
            ))}
          </div>
        )}
      </div>
      <input type="text" value={id} onChange={(e) => onEdit(e.target.value)} className="flex-1 px-2 py-1 text-xs border rounded" />
      <button onClick={onRemove} className="p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

export default function ProductManager({ 
  products, 
  onUpdateProducts, 
  currencySymbol,
  categories,
  onUpdateCategories,
  categoryColors,
  onUpdateCategoryColors,
  branches = [],
  defaultTaxRate = 0,
  taxRules,
  branchProductPrices = {},
  onSetBranchProductPrices,
  branchVariantPrices = {},
  onSetBranchVariantPrices,
}: ProductManagerProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddChoiceOpen, setIsAddChoiceOpen] = useState(false);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [configEditorProduct, setConfigEditorProduct] = useState<Product | null>(null);
  const [lastCreatedProduct, setLastCreatedProduct] = useState<Product | null>(null);
  // Configuration summary (card badges) — resolved server-side, no local logic.
  const { summary: configSummary, loaded: summaryLoaded, refresh: refreshConfigSummary } = useProductConfigSummary(products);

  // Form states
  const [pCode, setPCode] = useState('');
  const [pName, setPName] = useState('');
  const [pPrice, setPPrice] = useState(0);
  const [pCategory, setPCategory] = useState('Pizzas');
  const [pGst, setPGst] = useState(5);
  const [pImage, setPImage] = useState('');
  const [pAvailability, setPAvailability] = useState(true);
  const [pFavorite, setPFavorite] = useState(false);
  const [pVariants, setPVariants] = useState<ProductVariant[]>([]);
  // ── Meal combo builder state ──
  const [pIsCombo, setPIsCombo] = useState(false);
  const [pComboComponentIds, setPComboComponentIds] = useState<string[]>([]);
  const [pComboPrice, setPComboPrice] = useState(0);

  // ── Recipe editor state ──
  const [recipeProduct, setRecipeProduct] = useState<any | null>(null);
  const [showRecipeMaker, setShowRecipeMaker] = useState(false);

  // DND setup
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      const oldIndex = categories.indexOf(active.id);
      const newIndex = categories.indexOf(over.id);
      onUpdateCategories(arrayMove(categories, oldIndex, newIndex));
    }
  };

  // Variant helper states
  const [varName, setVarName] = useState('');
  const [varPrice, setVarPrice] = useState(0);

  // Custom Category Input state
  const [newCatInput, setNewCatInput] = useState('');

  // Deletion confirmation helper state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Per-branch pricing state
  const [pricingModalProduct, setPricingModalProduct] = useState<Product | null>(null);
  const [pricingForm, setPricingForm] = useState<Record<string, string>>({});
  // Meal-combo per-branch price: branchId → combo price (only for isCombo)
  const [comboPricingForm, setComboPricingForm] = useState<Record<string, string>>({});
  // Variant pricing: branchId → { variantName: price }
  const [variantPricingForm, setVariantPricingForm] = useState<Record<string, Record<string, string>>>({});

  // ── Customer-site visibility ─────────────────────────────────────
  // productId → MenuAvailabilityState (default visible + available). Loaded
  // once from the backend so the owner can list/unlist products on the
  // customer website right from the product card. Hidden products never
  // appear on the site (not even SOLD OUT).
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, any>>({});
  const [siteTogglePending, setSiteTogglePending] = useState<string | null>(null);
  const [siteVisibilityLoaded, setSiteVisibilityLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.fetchAvailability().then((rows: any[]) => {
      if (cancelled) return;
      if (Array.isArray(rows)) {
        const map: Record<string, any> = {};
        for (const r of rows) {
          if (r?.productId) map[r.productId] = r;
        }
        setAvailabilityMap(map);
      }
      setSiteVisibilityLoaded(true);
    }).catch(() => { if (!cancelled) setSiteVisibilityLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  /** Toggle whether a product is listed on the customer website. */
  const handleToggleSiteVisibility = (product: Product) => {
    // Only server-backed products (Mongo id) can be persisted.
    if (!/^[a-fA-F0-9]{24}$/.test(product.id)) return;
    const current = availabilityMap[product.id];
    const nextVisible = !(current?.visibleOnSite !== false);
    // Preserve the current sold-out status + its auto-restore timer + reason —
    // only visibility flips (the backend keeps unavailableUntil/reason when
    // the caller doesn't override them, so hiding never wipes a restore timer).
    const currentStatus = current?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    // Optimistic flip first — the API layer queues offline writes.
    setAvailabilityMap((prev) => ({
      ...prev,
      [product.id]: { ...(prev[product.id] || {}), visibleOnSite: nextVisible },
    }));
    setSiteTogglePending(product.id);
    api.updateAvailabilityBulk({
      items: [{
        productId: product.id,
        status: currentStatus,
        visibleOnSite: nextVisible,
        // Pass through any existing restore timer/reason untouched.
        ...(current?.unavailableUntil ? { unavailableUntil: current.unavailableUntil } : {}),
        reason: nextVisible ? (current?.reason || 'Owner re-listed on website') : (current?.reason || 'Owner removed from website'),
      }],
    }).catch((err) => debugWarn('ProductManager', 'site visibility toggle failed:', err))
      .finally(() => setSiteTogglePending((cur) => (cur === product.id ? null : cur)));
  };

  const openPricingModal = (product: Product) => {
    const existing: Record<string, string> = {};
    branches.filter(b => b.isActive).forEach(b => {
      const override = branchProductPrices[b.id]?.[product.id];
      existing[b.id] = override !== undefined ? String(override) : '';
    });
    setPricingForm(existing);

    // Initialize per-branch combo pricing (meal combos only)
    const comboExisting: Record<string, string> = {};
    branches.filter(b => b.isActive).forEach(b => {
      const override = (product as any).comboBranchPrice?.[b.id];
      comboExisting[b.id] = override !== undefined ? String(override) : '';
    });
    setComboPricingForm(comboExisting);

    // Initialize variant pricing form
    const vExisting: Record<string, Record<string, string>> = {};
    if (product.variants && product.variants.length > 0) {
      branches.filter(b => b.isActive).forEach(b => {
        vExisting[b.id] = {};
        product.variants!.forEach(v => {
          const override = branchVariantPrices[b.id]?.[product.id]?.[v.name];
          vExisting[b.id][v.name] = override !== undefined ? String(override) : '';
        });
      });
    }
    setVariantPricingForm(vExisting);
    setPricingModalProduct(product);
  };

  const handleSaveBranchPrices = () => {
    if (!pricingModalProduct) return;
    // Save base prices
    const updated = { ...branchProductPrices };
    branches.filter(b => b.isActive).forEach(b => {
      const val = pricingForm[b.id]?.trim();
      if (val && !isNaN(Number(val))) {
        if (!updated[b.id]) updated[b.id] = {};
        updated[b.id][pricingModalProduct.id] = Number(val);
      } else {
        if (updated[b.id]) {
          delete updated[b.id][pricingModalProduct.id];
          if (Object.keys(updated[b.id]).length === 0) delete updated[b.id];
        }
      }
    });
    onSetBranchProductPrices?.(updated);

    // Per-branch COMBO price (meal combos only): patch the product in state so
    // the billing tile and the auto-applied backing offer use the branch price,
    // then persist to the backend (the offer carries comboBranchPrices too).
    let comboBranchPriceMap: Record<string, number> | undefined;
    if (pricingModalProduct.isCombo) {
      comboBranchPriceMap = {};
      branches.filter(b => b.isActive).forEach(b => {
        const val = comboPricingForm[b.id]?.trim();
        if (val && !isNaN(Number(val))) comboBranchPriceMap![b.id] = Number(val);
      });
      onUpdateProducts(products.map(p =>
        p.id === pricingModalProduct.id ? { ...p, comboBranchPrice: comboBranchPriceMap } : p
      ));
    }

    // BACKEND CALLED — persist the branch-price map to /api/products so the
    // customer site (and other terminals) price this item the same way. Only
    // products that exist server-side (Mongo id) can be updated.
    const pid = pricingModalProduct.id;
    if (/^[a-fA-F0-9]{24}$/.test(pid)) {
      const branchPriceMap: Record<string, number> = {};
      branches.filter(b => b.isActive).forEach(b => {
        const val = pricingForm[b.id]?.trim();
        if (val && !isNaN(Number(val))) branchPriceMap[b.id] = Number(val);
      });
      api.updateProduct(pid, {
        branchPrice: branchPriceMap,
        ...(comboBranchPriceMap ? { comboBranchPrice: comboBranchPriceMap } : {}),
      })
        .then(() => debugWarn('ProductManager', 'branch prices synced to backend'))
        .catch(err => debugWarn('ProductManager', 'updateProduct branchPrice failed:', err));
    }

    // Save variant prices
    if (pricingModalProduct.variants && pricingModalProduct.variants.length > 0) {
      const vUpdated = { ...branchVariantPrices };
      branches.filter(b => b.isActive).forEach(b => {
        const branchVForm = variantPricingForm[b.id];
        if (!branchVForm) return;
        pricingModalProduct.variants!.forEach(v => {
          const val = branchVForm[v.name]?.trim();
          if (val && !isNaN(Number(val))) {
            if (!vUpdated[b.id]) vUpdated[b.id] = {};
            if (!vUpdated[b.id][pricingModalProduct.id]) vUpdated[b.id][pricingModalProduct.id] = {};
            vUpdated[b.id][pricingModalProduct.id][v.name] = Number(val);
          } else {
            // Remove variant override
            if (vUpdated[b.id]?.[pricingModalProduct.id]) {
              delete vUpdated[b.id][pricingModalProduct.id][v.name];
              if (Object.keys(vUpdated[b.id][pricingModalProduct.id]).length === 0) {
                delete vUpdated[b.id][pricingModalProduct.id];
              }
              if (Object.keys(vUpdated[b.id]).length === 0) delete vUpdated[b.id];
            }
          }
        });
      });
      onSetBranchVariantPrices?.(vUpdated);

      // BACKEND CALLED — persist the per-variant branch-price maps
      // (variantName → branchId → price) so other terminals and future
      // refreshes price variants the same way. The backend applies these in
      // place and never recreates the variant docs (safe against clobbering).
      if (/^[a-fA-F0-9]{24}$/.test(pid)) {
        const variantBranchPrices: Record<string, Record<string, number>> = {};
        pricingModalProduct.variants!.forEach(v => {
          const map: Record<string, number> = {};
          branches.filter(b => b.isActive).forEach(b => {
            const val = variantPricingForm[b.id]?.[v.name]?.trim();
            if (val && !isNaN(Number(val))) map[b.id] = Number(val);
          });
          variantBranchPrices[v.name] = map;
        });
        api.updateProduct(pid, { variantBranchPrices })
          .then(() => debugWarn('ProductManager', 'variant branch prices synced to backend'))
          .catch(err => debugWarn('ProductManager', 'updateProduct variantBranchPrices failed:', err));
      }
    }

    setPricingModalProduct(null);
  };

  // Assign a color to a category if it doesn't have one
  const ensureCategoryColor = (cat: string) => {
    if (!categoryColors[cat]) {
      const usedColors = new Set(Object.values(categoryColors));
      const nextColor = CATEGORY_PALETTE.find(c => !usedColors.has(c)) || CATEGORY_PALETTE[0];
      onUpdateCategoryColors({ ...categoryColors, [cat]: nextColor });
    }
  };

  // Duplicate check
  const findDuplicate = (name: string, code: string, excludeId?: string): string | null => {
    const dupName = products.find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId);
    if (dupName) return `Product name "${name}" already exists (${dupName.code})`;
    const dupCode = products.find(p => p.code === code && p.id !== excludeId);
    if (dupCode) return `Code "${code}" already in use by "${dupCode.name}"`;
    return null;
  };

  // Export CSV — download all products as a CSV file
  const handleExportCSV = () => {
    const headers = ['code','name','price','category','gstPercent','image','availability','favorite','variants'];
    const rows = products.map(p => [
      p.code,
      `"${p.name.replace(/"/g, '""')}"`,
      p.price,
      `"${p.category}"`,
      p.gstPercent,
      `"${p.image}"`,
      p.availability ? '1' : '0',
      p.favorite ? '1' : '0',
      p.variants ? `"${p.variants.map(v => `${v.name}:${v.price}`).join(';')}"` : '',
    ].join(','));
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `products_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Import CSV — parse uploaded file and add products
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      alert('Please select a CSV file.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Maximum CSV size is 5MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.replace(/^\uFEFF/, '').split('\n').filter(Boolean);
      if (lines.length < 2) return;
      const newProducts: Product[] = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1'));
        if (vals.length < 4) continue;
        const [code, name, priceStr, category, gstStr, image, availStr, favStr, variantsStr] = vals;
        const existingCode = products.find(p => p.code === code) || newProducts.find(p => p.code === code);
        if (existingCode) continue;
        const variants = variantsStr ? variantsStr.split(';').filter(Boolean).map(pair => {
          const [vname, vprice] = pair.split(':');
          return { name: vname.trim(), price: Number(vprice) || 0 };
        }) : undefined;
        const cat = category || 'Uncategorized';
        if (!categories.includes(cat)) {
          onUpdateCategories([...categories, cat]);
          ensureCategoryColor(cat);
        }
        newProducts.push({
          id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          code: code || Math.floor(100 + Math.random() * 900).toString(),
          name: name || 'Imported Item',
          price: Number(priceStr) || 0,
          category: cat,
          gstPercent: Number(gstStr) || 5,
          image: image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
          availability: availStr !== '0',
          favorite: favStr === '1',
          variants,
        });
      }
      if (newProducts.length > 0) {
        onUpdateProducts([...newProducts, ...products]);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filtered = products.filter(p => {
    // Menu items only — inventory items (availability=false) belong in
    // the Inventory module, never in the Product & Catalog manager.
    if (!p.availability) return false;
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.code.includes(search);
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleToggleAvailability = (productId: string) => {
    const updated = products.map(p => p.id === productId ? { ...p, availability: !p.availability } : p);
    onUpdateProducts(updated);
  };

  const handleToggleFavorite = (productId: string) => {
    const updated = products.map(p => p.id === productId ? { ...p, favorite: !p.favorite } : p);
    onUpdateProducts(updated);
  };

  const handleAddVariant = () => {
    if (!varName.trim()) return;
    setPVariants([...pVariants, { name: varName.trim(), price: Number(varPrice) }]);
    setVarName('');
    setVarPrice(0);
  };

  const handleRemoveVariant = (index: number) => {
    setPVariants(pVariants.filter((_, i) => i !== index));
  };

  const openAddModal = () => {
    setPCode(Math.floor(100 + Math.random() * 900).toString()); // auto code
    setPName('');
    setPPrice(0);
    setPCategory(categories[0] || 'Pizzas');
    setPGst(5);
    setPImage('https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80');
    setPAvailability(true);
    setPFavorite(false);
    setPVariants([]);
    setPIsCombo(false);
    setPComboComponentIds([]);
    setPComboPrice(0);
    setEditingProduct(null);
    setNewCatInput('');
    setIsAddModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setPCode(product.code);
    setPName(product.name);
    // For combos the sell price is the combo price — never show a stale base.
    setPPrice(product.isCombo ? (product.comboPrice ?? product.price) : product.price);
    setPCategory(product.category);
    setPGst(product.gstPercent);
    setPImage(product.image);
    setPAvailability(product.availability);
    setPFavorite(!!product.favorite);
    setPVariants(product.variants || []);
    setPIsCombo(!!product.isCombo);
    setPComboComponentIds(product.comboComponentIds || []);
    setPComboPrice(product.comboPrice ?? 0);
    setNewCatInput('');
    setIsAddModalOpen(true);
  };

  /**
   * Duplicate an existing (possibly configured) item and open its config
   * editor. Reuses the item's reusable configuration references so variants,
   * customizations and add-ons come along automatically.
   */
  const handleDuplicateProduct = (source: Product) => {
    const newCode = `${source.code}-${Math.floor(100 + Math.random() * 900)}`;
    const newProduct: Product = {
      ...source,
      id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      code: newCode,
      name: `${source.name} (copy)`,
      favorite: false,
      menuConfig: source.menuConfig ? JSON.parse(JSON.stringify(source.menuConfig)) : undefined,
    };
    const next = [newProduct, ...products];
    onUpdateProducts(next);

    api.createProduct({
      name: newProduct.name,
      code: newCode,
      price: newProduct.isCombo ? (newProduct.comboPrice ?? newProduct.price) : newProduct.price,
      category: newProduct.category,
      gstPercent: newProduct.gstPercent,
      image: newProduct.image,
      availability: newProduct.availability,
      favorite: false,
      ...(newProduct.isCombo && newProduct.comboComponentIds?.length ? { isCombo: true, comboComponentIds: newProduct.comboComponentIds, comboPrice: newProduct.comboPrice } : {}),
      ...(newProduct.variants && newProduct.variants.length > 0 ? { variants: newProduct.variants } : {}),
    }).then((created: any) => {
      const serverId = created?._id || created?.id;
      if (serverId) {
        const synced = { ...newProduct, id: serverId };
        onUpdateProducts(next.map((p) => p.id === newProduct.id ? synced : p));
        // Re-attach the reusable configuration references to the new item.
        const cfg = synced.menuConfig;
        if (cfg) {
          const refs: Array<{ type: 'VARIANT_GROUP' | 'MODIFIER_GROUP' | 'ADD_ON_GROUP'; ref: ProductConfigRef }> = [
            ...cfg.variantConfigurations.map((r) => ({ type: 'VARIANT_GROUP' as const, ref: r })),
            ...cfg.modifierConfigurations.map((r) => ({ type: 'MODIFIER_GROUP' as const, ref: r })),
            ...cfg.addOnConfigurations.map((r) => ({ type: 'ADD_ON_GROUP' as const, ref: r })),
          ];
          Promise.all(refs.map(({ type, ref }) =>
            api.attachProductConfig(serverId, {
              type,
              templateId: ref.templateId,
              mode: ref.mode,
              overrides: ref.overrides,
            }).catch((err: any) => debugWarn('ProductManager', 'duplicate: attach config failed', err))
          )).finally(() => refreshConfigSummary());
        }
        setConfigEditorProduct(synced);
        setIsAddChoiceOpen(false);
      }
    }).catch((err: any) => debugWarn('ProductManager', 'duplicate: createProduct failed:', err));
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim() || pPrice < 0) return;

    // Duplicate check
    const dupMsg = findDuplicate(pName.trim(), pCode, editingProduct?.id);
    if (dupMsg) {
      alert(dupMsg);
      return;
    }

    let finalCategory = pCategory;
    if (pCategory === '__NEW_CATEGORY__' || !categories.includes(pCategory)) {
      const val = newCatInput.trim();
      if (val) {
        const cleaned = val.charAt(0).toUpperCase() + val.slice(1);
        if (!categories.includes(cleaned)) {
          onUpdateCategories([...categories, cleaned]);
          ensureCategoryColor(cleaned);
        }
        finalCategory = cleaned;
      } else {
        finalCategory = categories[0] || 'Pizzas';
      }
    }

    // ── Meal combo client-side sanity check (server remains authoritative) ──
    if (pIsCombo) {
      if (pComboComponentIds.length < 2) {
        alert('A meal combo needs at least 2 items. Pick the items that are bundled.');
        return;
      }
      if (!(Number(pComboPrice) > 0)) {
        alert('Enter a combo price greater than zero.');
        return;
      }
      const sum = pComboComponentIds.reduce((s, id) => {
        const comp = products.find(x => x.id === id);
        return s + (comp ? Number(comp.price) || 0 : 0);
      }, 0);
      if (!(Number(pComboPrice) < sum)) {
        alert(`Combo price must be less than the items' total (${currencySymbol}${sum.toFixed(2)}).`);
        return;
      }
    }

    const comboFields = pIsCombo
      ? { isCombo: true, comboComponentIds: pComboComponentIds, comboPrice: Number(pComboPrice) }
      : { isCombo: false };

    if (editingProduct) {
      // Editing Mode
      const updated = products.map(p => {
        if (p.id === editingProduct.id) {
          return {
            ...p,
            code: pCode,
            name: pName.trim(),
            price: pIsCombo ? Number(pComboPrice) : Number(pPrice),
            category: finalCategory,
            gstPercent: Number(pGst),
            image: pImage || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
            availability: pAvailability,
            favorite: pFavorite,
            variants: pVariants.length > 0 ? pVariants : undefined,
            ...comboFields,
          };
        }
        return p;
      });
      onUpdateProducts(updated);
      // BACKEND CALLED — push menu edits to /api/products. Only products that
      // already exist server-side (Mongo id, i.e. created after this wiring)
      // can be updated; seeded/demo items with local-only ids are skipped.
      const pid = editingProduct.id;
      if (/^[a-fA-F0-9]{24}$/.test(pid)) {
        api.updateProduct(pid, {
          name: pName.trim(),
          code: pCode,
          price: pIsCombo ? Number(pComboPrice) : Number(pPrice),
          category: finalCategory,
          gstPercent: Number(pGst),
          image: pImage || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
          availability: pAvailability,
          favorite: pFavorite,
          ...comboFields,
          ...(pVariants.length > 0 ? { variants: pVariants } : {}),
        }).then((updated: any) => {
          if (pIsCombo && !updated && navigator.onLine !== false) {
            // Server-authoritative combo validation (components must exist
            // server-side, same tenant, price < total). The offer sync failed
            // server-side — the combo won't work at billing until it's fixed.
            alert('Combo saved locally, but the server rejected it. Make sure all bundled items are synced to the server, then save again.');
          }
        }).catch((err: any) => debugWarn('ProductManager', 'updateProduct failed:', err));
      }
    } else {
      // Create Mode
      const newProduct: Product = {
        id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        code: pCode,
        name: pName.trim(),
        price: pIsCombo ? Number(pComboPrice) : Number(pPrice),
        category: finalCategory,
        gstPercent: Number(pGst),
        image: pImage || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
        availability: pAvailability,
        favorite: pFavorite,
        variants: pVariants.length > 0 ? pVariants : undefined,
        ...comboFields,
      };
      const next = [newProduct, ...products];
      onUpdateProducts(next);
      setLastCreatedProduct(newProduct);
      // BACKEND CALLED — push the new menu item to /api/products. On success the
      // local temp id is swapped for the server _id so later edits/deletes/merges
      // line up instead of duplicating the product on the next fetch.
      api.createProduct({
        name: newProduct.name,
        code: newProduct.code,
        price: pIsCombo ? Number(pComboPrice) : newProduct.price,
        category: newProduct.category,
        gstPercent: newProduct.gstPercent,
        image: newProduct.image,
        availability: newProduct.availability,
        favorite: newProduct.favorite,
        ...comboFields,
        ...(newProduct.variants && newProduct.variants.length > 0 ? { variants: newProduct.variants } : {}),
      }).then((created: any) => {
        const serverId = created?._id || created?.id;
        if (pIsCombo && !serverId && navigator.onLine !== false) {
          alert('Combo saved locally, but the server rejected it. Make sure all bundled items are synced to the server, then save again.');
        }
        if (serverId) {
          onUpdateProducts(next.map((p) => p.id === newProduct.id ? { ...p, id: serverId } : p));
          setLastCreatedProduct((cur) => cur?.id === newProduct.id ? { ...cur, id: serverId } : cur);
        }
      }).catch((err: any) => debugWarn('ProductManager', 'createProduct failed:', err));
    }
    setNewCatInput('');
    setIsAddModalOpen(false);
  };

  const handleDeleteProduct = (productId: string) => {
    if (deleteConfirmId === productId) {
      const updated = products.filter(p => p.id !== productId);
      onUpdateProducts(updated);
      // BACKEND CALLED — remove the menu item from the cloud too (Owner/Manager).
      if (/^[a-fA-F0-9]{24}$/.test(productId)) {
        api.deleteProduct(productId).catch(err => debugWarn('ProductManager', 'deleteProduct failed:', err));
      }
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(productId);
      // Auto-reset confirmation after 4 seconds
      setTimeout(() => {
        setDeleteConfirmId(current => current === productId ? null : current);
      }, 4000);
    }
  };

  return (
    <div id="product_manager_workspace" className="p-6 h-full flex flex-col font-sans">
      
      {/* Search and Category Nav Row */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-[var(--color-bg-white)] p-4 rounded-xl border border-[var(--color-border-default)] shadow-sm shrink-0">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">Product & Catalog Management</h2>
          <p className="text-xs text-gray-500">Configure item tags, pricing models, specific GST tax rates, and online availability.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Search */}
          <div className="relative shrink-0 w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            />
          </div>

          <button
            onClick={() => setIsAddChoiceOpen(true)}
            className="flex items-center gap-1 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-md cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-sm cursor-pointer shrink-0"
          >
            Manage Categories
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-4 py-2 rounded-lg font-semibold text-xs transition-colors cursor-pointer shrink-0"
          >
            Export CSV
          </button>
          <label className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg font-semibold text-xs transition-colors cursor-pointer shrink-0">
            Import CSV
            <input type="file" accept=".csv" onChange={handleImportCSV} className="hidden" />
          </label>
        </div>
      </div>

      {/* “Added — configure more?” prompt */}
      {lastCreatedProduct && (
        <div className="mb-4 flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 animate-fade-in shrink-0">
          <p className="text-xs font-semibold text-emerald-800 flex items-center gap-2 min-w-0">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="truncate">“{lastCreatedProduct.name}” was added{lastCreatedProduct.menuConfig ? ' with its configuration' : ''}.</span>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { setConfigEditorProduct(lastCreatedProduct); setLastCreatedProduct(null); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
            >
              <SlidersHorizontal className="w-3 h-3" /> Configure more
            </button>
            <button onClick={() => setLastCreatedProduct(null)} className="px-2 py-1.5 text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer">Dismiss</button>
          </div>
        </div>
      )}

      {/* Category Tabs & Quick Add */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-4 select-none border-b border-gray-100 shrink-0">
        {['All', ...categories].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-1.5 rounded-full font-semibold text-xs transition-all whitespace-nowrap cursor-pointer ${
              selectedCategory === cat
                ? 'bg-[var(--brand-color)] text-white shadow-sm'
                : 'bg-[var(--color-bg-white)] text-gray-600 border border-[var(--color-border-default)] hover:bg-[var(--color-primary-light)]'
            }`}
          >
            {cat}
          </button>
        ))}

        {/* Dynamic Category Quick Add */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const input = form.elements.namedItem('newCategory') as HTMLInputElement;
            const val = input.value.trim();
            if (val) {
              const cleaned = val.charAt(0).toUpperCase() + val.slice(1);
              if (!categories.includes(cleaned)) {
                onUpdateCategories([...categories, cleaned]);
                ensureCategoryColor(cleaned);
                setSelectedCategory(cleaned);
              } else {
                setSelectedCategory(cleaned);
              }
              input.value = '';
            }
          }}
          className="flex items-center gap-1.5 border border-dashed border-gray-300 rounded-full pl-3 pr-1 py-0.5 bg-gray-50/50 hover:bg-gray-50 focus-within:border-[var(--brand-color)] focus-within:bg-[var(--color-bg-white)] transition-all shrink-0 ml-1"
        >
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Add Cat:</span>
          <input 
            type="text" 
            name="newCategory" 
            placeholder="e.g. Desserts..." 
            className="bg-transparent border-none text-xs font-semibold text-gray-800 focus:outline-none focus:ring-0 w-24 p-0"
            required
          />
          <button 
            type="submit" 
            className="p-1 rounded-full bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white cursor-pointer transition-colors"
            title="Create Category"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </form>
      </div>

      {/* Grid Layout of products */}
      <div className="flex-1 overflow-y-auto min-h-[400px]">
        {filtered.length === 0 ? (
          <div className="bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] p-12 text-center text-gray-500 flex flex-col items-center justify-center">
            <XCircle className="w-12 h-12 text-gray-300 mb-3" />
            <p className="font-semibold text-md text-[var(--color-text-primary)]">No products match search criteria</p>
            <p className="text-xs text-gray-400 mt-1">Clear filters or register a new product to populate the catalog grid.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
            {filtered.map((product) => (
              <div 
                key={product.id}
                className={`bg-[var(--color-bg-white)] rounded-xl border p-4 shadow-sm relative flex flex-col justify-between transition-all ${
                  product.availability ? 'border-[var(--color-border-default)] hover:shadow-md' : 'border-gray-200 bg-gray-50/50 opacity-75'
                }`}
              >
                {/* Image and Meta row */}
                <div>
                  <div className="relative w-full h-32 rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 mb-3 border border-gray-100 flex items-center justify-center">
                    <img 
                      src={product.image} 
                      alt={product.name}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover gpu"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          parent.classList.add('bg-gradient-to-br', 'from-orange-100', 'to-amber-50');
                          const fallback = document.createElement('span');
                          fallback.className = 'text-4xl font-bold text-orange-300';
                          fallback.textContent = product.name.charAt(0);
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                    
                    {/* Favorite and Availability Buttons on image hover */}
                    <div className="absolute top-2 right-2 flex gap-1.5">
                      <button
                        onClick={() => handleToggleFavorite(product.id)}
                        className={`p-1.5 rounded-full shadow-md transition-all cursor-pointer ${
                          product.favorite ? 'bg-amber-400 text-white' : 'bg-[var(--color-bg-white)] text-gray-400 hover:text-amber-500'
                        }`}
                        title="Toggle Favorite"
                      >
                        <Star className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>

                    <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider">
                      CODE: {product.code}
                    </div>

                    {!product.availability && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold text-xs uppercase tracking-wider">
                        UNAVAILABLE
                      </div>
                    )}
                  </div>

                  {/* Header Title & Cat */}
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-bold text-xs text-[var(--color-text-primary)] line-clamp-1">{product.name}</h3>
                    <span className="text-[9px] font-bold bg-[var(--color-primary-light)] text-[var(--brand-color)] px-2 py-0.5 rounded-full uppercase">
                      {product.category}
                    </span>
                  </div>

                  {/* Meal combo badge */}
                  {product.isCombo && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[9px] font-bold bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Meal Combo
                      </span>
                      <span className="text-[9px] font-semibold text-gray-500">
                        {product.comboComponentIds?.length || 0} items · {currencySymbol}{(product.comboPrice ?? 0).toFixed(2)}
                      </span>
                    </div>
                  )}

                  {/* Pricing and GST */}
                  <div className="flex justify-between items-center text-xs text-gray-500 mb-3">
                    <span className="font-bold text-sm text-[var(--color-text-primary)]">
                      {currencySymbol}{((product.isCombo ? (product.comboPrice ?? product.price) : product.price) || 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded font-mono">
                      GST: {product.gstPercent}%
                    </span>
                  </div>

                  {/* Variant indicators */}
                  {product.variants && product.variants.length > 0 && (
                    <div className="mb-4">
                      <span className="text-[10px] text-gray-400 block font-medium mb-1">Variants / Configured pricing:</span>
                      <div className="flex flex-wrap gap-1">
                        {product.variants.map((v, idx) => (
                          <span key={idx} className="bg-gray-100 text-[9px] text-gray-600 px-2 py-0.5 rounded border border-gray-200 font-mono">
                            {v.name}: {currencySymbol}{v.price}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reusable configuration status (server-resolved counts) */}
                  {summaryLoaded && (() => {
                    const cs = configSummary[product.id];
                    const has = !!cs?.hasConfiguration;
                    const v = cs?.variantCount ?? 0;
                    const m = cs?.modifierCount ?? 0;
                    const a = cs?.addOnCount ?? 0;
                    return (
                      <div className="mb-3 flex items-center gap-1.5">
                        {has ? (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Settings2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        )}
                        <span className={`text-[10px] font-bold ${has ? 'text-emerald-700' : 'text-gray-500'}`}>
                          {has ? 'Configured' : 'Not configured'}
                        </span>
                        {has && (
                          <span className="text-[10px] text-gray-400 truncate">
                            · {v} variant{v === 1 ? '' : 's'} · {m} customization{m === 1 ? '' : 's'}{a ? ` · ${a} add-on${a === 1 ? '' : 's'}` : ''}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Operations footer */}
                <div className="flex items-center gap-2 border-t border-gray-100 pt-3 mt-3">
                  <button
                    onClick={() => handleToggleAvailability(product.id)}
                    className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-[10px] transition-all cursor-pointer text-center ${
                      product.availability 
                        ? 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200' 
                        : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
                    }`}
                  >
                    {product.availability ? 'Active (Ready)' : 'Sold Out (Inact)'}
                  </button>

                  {/* Customer-site visibility toggle — list/unlist on the
                      customer website. Hidden products never appear on the site. */}
                  <button
                    onClick={() => handleToggleSiteVisibility(product)}
                    disabled={siteTogglePending === product.id || !/^[a-fA-F0-9]{24}$/.test(product.id) || !siteVisibilityLoaded}
                    title={!/^[a-fA-F0-9]{24}$/.test(product.id)
                      ? 'Save this product to the cloud first to control website visibility'
                      : availabilityMap[product.id]?.visibleOnSite === false
                        ? 'Hidden from website — click to show on the customer site'
                        : 'Shown on website — click to hide from the customer site'}
                    className={`relative flex-1 py-1.5 px-2 rounded-lg font-bold text-[10px] transition-all cursor-pointer text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                      availabilityMap[product.id]?.visibleOnSite === false
                        ? 'bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-200'
                        : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {siteTogglePending === product.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : availabilityMap[product.id]?.visibleOnSite === false ? (
                        <Globe className="w-3 h-3" />
                      ) : (
                        <Globe2 className="w-3 h-3" />
                      )}
                      {availabilityMap[product.id]?.visibleOnSite === false ? 'Hidden' : 'On Site'}
                    </span>
                  </button>                   <button
                    onClick={() => setConfigEditorProduct(product)}
                    className="p-1.5 text-gray-500 hover:text-[var(--brand-color)] bg-[var(--color-bg-page)] hover:bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg transition-all cursor-pointer"
                    title="Configure variants, customizations & add-ons"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => { setRecipeProduct(product); setShowRecipeMaker(true); }}
                    className="p-1.5 text-gray-500 hover:text-orange-600 bg-[var(--color-bg-page)] hover:bg-orange-50 border border-[var(--color-border-default)] rounded-lg transition-all cursor-pointer"
                    title="Create or edit recipe"
                  >
                    <ChefHat className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDuplicateProduct(product)}
                    className="p-1.5 text-gray-500 hover:text-violet-600 bg-[var(--color-bg-page)] hover:bg-violet-50 border border-[var(--color-border-default)] rounded-lg transition-all cursor-pointer"
                    title="Duplicate item (config comes along)"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => openEditModal(product)}
                    className="p-1.5 text-gray-500 hover:text-[var(--brand-color)] bg-[var(--color-bg-page)] hover:bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg transition-all cursor-pointer"
                    title="Edit Item details"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Branch Prices button (visible when multi-branch is enabled) */}
                  {branches.length > 1 && (
                    <button
                      onClick={() => openPricingModal(product)}
                      className={`p-1.5 rounded-lg transition-all cursor-pointer border ${
                        (branchProductPrices && Object.values(branchProductPrices).some(p => p[product.id] !== undefined)) ||
                        (branchVariantPrices && Object.values(branchVariantPrices).some(b => b[product.id] && Object.keys(b[product.id]).length > 0)) ||
                        (product.isCombo && product.comboBranchPrice && Object.keys(product.comboBranchPrice).length > 0)
                          ? 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200'
                          : 'text-gray-400 hover:text-purple-600 bg-gray-50/50 hover:bg-purple-50 border-gray-200'
                      }`}
                      title="Set branch-specific prices"
                    >
                      <Tag className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDeleteProduct(product.id)}
                    className={`p-1.5 border rounded-lg transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                      deleteConfirmId === product.id
                        ? 'bg-[var(--color-red-600-solid)] border-red-600 text-white animate-pulse'
                        : 'text-gray-400 hover:text-red-600 bg-red-50/50 hover:bg-red-50 border-red-100'
                    }`}
                    title={deleteConfirmId === product.id ? "Click again to confirm delete" : "Delete item"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleteConfirmId === product.id && <span className="text-[10px] font-sans">Confirm?</span>}
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manage Categories Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-sm w-full border border-[var(--color-border-default)]">
            <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
              <h3 className="font-bold text-[var(--color-text-primary)] text-sm">Manage Categories</h3>
              <button 
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={categories.filter(c => c !== 'All')} strategy={verticalListSortingStrategy}>
                  {categories.filter(c => c !== 'All').map(cat => (
                    <SortableCategory 
                      key={cat} 
                      id={cat} 
                      color={categoryColors[cat] || '#e5e7eb'}
                      onColorChange={(newColor) => {
                        onUpdateCategoryColors({ ...categoryColors, [cat]: newColor });
                      }}
                      onRemove={() => {
                        const updatedCategories = categories.filter(c => c !== cat);
                        onUpdateCategories(updatedCategories);
                        const updatedProducts = products.map(p => p.category === cat ? { ...p, category: 'Uncategorized' } : p);
                        onUpdateProducts(updatedProducts);
                      }}
                      onEdit={(val) => {
                        const updatedCategories = categories.map(c => c === cat ? val : c);
                        onUpdateCategories(updatedCategories);
                        const updatedProducts = products.map(p => p.category === cat ? { ...p, category: val } : p);
                        onUpdateProducts(updatedProducts);
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
            <div className="p-6 pt-0 flex justify-end">
                <button
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-4 py-2 bg-[var(--brand-color)] text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  Done
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {/* Add Item choice — start from scratch or use an existing item */}
      {isAddChoiceOpen && (
        <AddItemModal
          products={products}
          currencySymbol={currencySymbol}
          onStartFromScratch={() => { setIsAddChoiceOpen(false); setIsRegistrationOpen(true); }}
          onUseExisting={handleDuplicateProduct}
          onClose={() => setIsAddChoiceOpen(false)}
        />
      )}

      {/* Guided dish registration — Start from scratch */}
      {isRegistrationOpen && (
        <ProductRegistrationWizard
          products={products}
          currencySymbol={currencySymbol}
          categories={categories}
          onUpdateCategories={onUpdateCategories}
          categoryColors={categoryColors}
          onUpdateCategoryColors={onUpdateCategoryColors}
          defaultTaxRate={defaultTaxRate}
          taxRules={taxRules}
          onUpdateProducts={onUpdateProducts}
          onRegistered={(product) => {
            setLastCreatedProduct(product);
            refreshConfigSummary();
            setIsRegistrationOpen(false);
          }}
          onClose={() => setIsRegistrationOpen(false)}
        />
      )}

      {/* Configuration editor (variants / customizations / add-ons) */}
      {configEditorProduct && (
        <ProductConfigEditor
          product={configEditorProduct}
          currencySymbol={currencySymbol}
          onUpdateProduct={(updated) => {
            onUpdateProducts(products.map((p) => p.id === updated.id ? updated : p));
            setConfigEditorProduct(updated);
          }}
          onConfigChanged={refreshConfigSummary}
          onClose={() => setConfigEditorProduct(null)}
        />
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-[var(--color-border-default)]">
            
            {/* Header */}
            <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
              <h3 className="font-bold text-[var(--color-text-primary)] text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--brand-color)]" />
                {editingProduct ? `Edit ${editingProduct.name}` : 'Register New Dish/Combo'}
              </h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 focus:outline-none cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveProduct} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* SKU Code */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">SKU / Code</label>
                  <input
                    type="text"
                    value={pCode}
                    onChange={(e) => setPCode(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                    required
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Category</label>
                  <select
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  >
                    {categories.filter(c => c !== 'All').map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value="__NEW_CATEGORY__">➕ Create New Category...</option>
                  </select>

                  {pCategory === '__NEW_CATEGORY__' && (
                    <div className="mt-2 flex gap-1.5 animate-fade-in">
                      <input
                        type="text"
                        placeholder="New category name..."
                        value={newCatInput}
                        onChange={(e) => setNewCatInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = newCatInput.trim();
                          if (val) {
                            const cleaned = val.charAt(0).toUpperCase() + val.slice(1);
                            if (!categories.includes(cleaned)) {
                              onUpdateCategories([...categories, cleaned]);
                            }
                            setPCategory(cleaned);
                            setNewCatInput('');
                          } else {
                            setPCategory(categories[0] || 'Pizzas');
                          }
                        }}
                        className="px-3 py-1.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Product Name */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Product Name</label>
                <input
                  type="text"
                  placeholder="e.g., Spicy Paneer Tikka Pizza"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Price — for meal combos the combo price IS the sell price */}
                <div>
                  {pIsCombo ? (
                    <>
                      <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Sell Price ({currencySymbol})</label>
                      <div className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] bg-gray-50 text-xs font-bold font-mono flex items-center justify-between">
                        <span>{currencySymbol}{(pComboPrice ? Number(pComboPrice) : 0).toFixed(2)}</span>
                        <span className="text-[8px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">= Combo price</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Base Price ({currencySymbol})</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g., 14.50"
                        value={pPrice || ''}
                        onChange={(e) => setPPrice(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                        required
                      />
                    </>
                  )}
                </div>

                {/* GST */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">GST Tax Rate (%)</label>
                  <select
                    value={pGst}
                    onChange={(e) => setPGst(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  >
                    <option value={0}>0% Tax Exempt</option>
                    <option value={5}>5% Food Services GST</option>
                    <option value={12}>12% Processed Food GST</option>
                    <option value={18}>18% Premium Beverages GST</option>
                  </select>
                </div>
              </div>

              {/* Product image — upload a photo or paste an image link */}
              <ImageInput
                value={pImage}
                onChange={setPImage}
                label="Product Image"
                hint="Upload a photo or paste an image link"
              />

              {/* ── Meal Combo Builder ── */}
              <div className="border border-[var(--color-border-default)] p-3 rounded-lg bg-gray-50 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pIsCombo}
                    onChange={(e) => {
                      setPIsCombo(e.target.checked);
                      if (e.target.checked) {
                        // The combo price becomes the sell price.
                        setPPrice(Number(pComboPrice) || 0);
                      } else {
                        setPComboComponentIds([]); setPComboPrice(0);
                      }
                    }}
                    className="rounded text-[var(--brand-color)] focus:ring-[var(--brand-color)]"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
                    This is a Meal Combo (bundle items at one price)
                  </span>
                </label>

                {pIsCombo && (
                  <div className="space-y-2 animate-fade-in">
                    <p className="text-[9px] text-gray-400">
                      Pick the items this combo bundles. Tapping the combo at billing adds the items and applies the combo discount automatically. The combo is saved server-side as an Offer so analytics and the customer site track it like any other combo.
                    </p>

                    {/* Component chips */}
                    <div className="flex flex-wrap gap-1.5 p-1.5 bg-[var(--color-bg-white)] border border-gray-200 rounded min-h-8">
                      {products
                        .filter(x => x.id !== editingProduct?.id && !x.isCombo)
                        .map((x) => {
                          const selected = pComboComponentIds.includes(x.id);
                          return (
                            <button
                              key={x.id}
                              type="button"
                              onClick={() => {
                                setPComboComponentIds(prev =>
                                  selected ? prev.filter(id => id !== x.id) : [...prev, x.id]
                                );
                              }}
                              className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors cursor-pointer ${
                                selected
                                  ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]'
                                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-[var(--brand-color)]'
                              }`}
                            >
                              {x.name} · {currencySymbol}{(Number(x.price) || 0).toFixed(2)}
                            </button>
                          );
                        })}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] font-semibold uppercase text-gray-500 tracking-wider mb-0.5">Combo Price ({currencySymbol})</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="e.g., 249"
                          value={pComboPrice || ''}
                          onChange={(e) => {
                            setPComboPrice(Number(e.target.value));
                            // Keep the sell price in lockstep with the combo price.
                            setPPrice(Number(e.target.value));
                          }}
                          className="w-full px-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <span className="text-[10px] font-semibold text-gray-600">
                          Items total:{' '}
                          <span className="font-mono font-bold">
                            {currencySymbol}{pComboComponentIds.reduce((s, id) => {
                              const comp = products.find(x => x.id === id);
                              return s + (comp ? Number(comp.price) || 0 : 0);
                            }, 0).toFixed(2)}
                          </span>
                          {pComboComponentIds.length >= 2 && pComboPrice > 0 && (
                            <span className="block mt-0.5 text-emerald-600 font-bold">
                              Customer saves {currencySymbol}{(pComboComponentIds.reduce((s, id) => {
                                const comp = products.find(x => x.id === id);
                                return s + (comp ? Number(comp.price) || 0 : 0);
                              }, 0) - Number(pComboPrice)).toFixed(2)}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Advanced Variants Sub-panel */}
              <div className="border border-[var(--color-border-default)] p-3 rounded-lg bg-gray-50 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-primary)] block">
                  Product Variants (Optional)
                </span>
                <p className="text-[9px] text-gray-400">If variants are declared, they will display as select-buttons during order billing.</p>
                
                {/* Variant list preview */}
                {pVariants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-1 bg-[var(--color-bg-white)] border border-gray-200 rounded min-h-8">
                    {pVariants.map((v, index) => (
                      <span key={index} className="bg-gray-100 text-[10px] text-gray-700 px-2 py-0.5 rounded font-medium border border-gray-200 flex items-center gap-1">
                        {v.name} ({currencySymbol}{v.price})
                        <button type="button" onClick={() => handleRemoveVariant(index)} className="text-red-500 font-bold hover:text-red-700 select-none text-[9px] cursor-pointer">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add dynamic variant */}
                <div className="grid grid-cols-12 gap-2">
                  <input
                    type="text"
                    placeholder="Variant name (e.g., Medium 10-inch)"
                    value={varName}
                    onChange={(e) => setVarName(e.target.value)}
                    className="col-span-6 px-2 py-1 border border-[var(--color-border-input)] rounded text-xs bg-[var(--color-bg-white)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price"
                    value={varPrice || ''}
                    onChange={(e) => setVarPrice(Number(e.target.value))}
                    className="col-span-4 px-2 py-1 border border-[var(--color-border-input)] rounded text-xs font-mono font-bold bg-[var(--color-bg-white)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                  />
                  <button
                    type="button"
                    onClick={handleAddVariant}
                    className="col-span-2 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white rounded font-bold text-xs flex items-center justify-center cursor-pointer"
                  >
                    + Add
                  </button>
                </div>
              </div>

              {/* Toggles */}
              <div className="flex gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pAvailability}
                    onChange={(e) => setPAvailability(e.target.checked)}
                    className="rounded text-[var(--brand-color)] focus:ring-[var(--brand-color)]"
                  />
                  <span className="text-xs text-gray-700 font-semibold">Available for Immediate Billing</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pFavorite}
                    onChange={(e) => setPFavorite(e.target.checked)}
                    className="rounded text-[var(--brand-color)] focus:ring-[var(--brand-color)]"
                  />
                  <span className="text-xs text-gray-700 font-semibold flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    Flag as Favorite Row
                  </span>
                </label>
              </div>

              {/* Save & Cancel Row */}
              <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-xs font-bold shadow-md cursor-pointer"
                >
                  {editingProduct ? 'Update Product Details' : 'Register Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Per-Branch Pricing Modal (with Variant Support) */}
      {pricingModalProduct && branches.length > 1 && (
        <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setPricingModalProduct(null)}>
          <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-lg w-full mx-4 border border-[var(--color-border-default)] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--color-border-default)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-purple-600" />
                <h3 className="font-bold text-sm text-[var(--color-text-primary)]">Branch Prices: {pricingModalProduct.name}</h3>
              </div>
              <button onClick={() => setPricingModalProduct(null)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[10px] text-gray-400 mb-2">
                Set custom prices for this product at each branch. Leave base price empty to use the default ({currencySymbol}{pricingModalProduct.price.toFixed(2)}).
                {pricingModalProduct.isCombo && ` Combo price can also be overridden per branch (default ${currencySymbol}${(pricingModalProduct.comboPrice ?? 0).toFixed(2)}).`}
                {pricingModalProduct.variants && pricingModalProduct.variants.length > 0 && ' Variant prices can also be overridden per branch.'}
              </p>
              {branches.filter(b => b.isActive).map(branch => {
                const currentOverride = pricingForm[branch.id] || '';
                const basePrice = pricingModalProduct.price;
                const overridePrice = currentOverride ? Number(currentOverride) : null;
                const isDifferent = overridePrice !== null && overridePrice !== basePrice;
                const hasVariantOverrides = pricingModalProduct.variants && pricingModalProduct.variants.length > 0 &&
                  pricingModalProduct.variants.some(v => {
                    const vv = variantPricingForm[branch.id]?.[v.name];
                    return vv && !isNaN(Number(vv)) && Number(vv) !== v.price;
                  });
                return (
                  <div key={branch.id} className={`rounded-xl border p-3 transition-all ${isDifferent || hasVariantOverrides ? 'border-purple-200 bg-purple-50/50' : 'border-[var(--color-border-default)]'}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">
                          {branch.name}
                          {branch.isHeadBranch && <span className="text-[9px] text-purple-600 ml-1">(Head)</span>}
                        </p>
                      </div>
                      <div className="relative w-28">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-bold">{currencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={currentOverride}
                          onChange={(e) => setPricingForm(prev => ({ ...prev, [branch.id]: e.target.value }))}
                          className={`w-full pl-6 pr-2 py-1.5 rounded-lg border text-xs font-mono font-bold focus:outline-none focus:ring-1 ${
                            isDifferent
                              ? 'border-purple-300 bg-[var(--color-bg-white)] focus:ring-purple-500 text-purple-800'
                              : 'border-[var(--color-border-input)] focus:ring-[var(--brand-color)]'
                          }`}
                          placeholder={`Base ${basePrice.toFixed(2)}`}
                        />
                        {isDifferent && (
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-purple-500 font-bold">⚡</span>
                        )}
                      </div>
                    </div>

                    {/* Meal-combo per-branch price sub-row */}
                    {pricingModalProduct.isCombo && (
                      <div className="ml-2 pl-3 border-l-2 border-purple-200 mt-1.5 mb-1.5 flex items-center gap-2">
                        <span className="text-[9px] font-bold text-purple-700 w-20 truncate shrink-0">Combo price</span>
                        <span className="text-[9px] text-gray-400 w-16">Default: {currencySymbol}{(pricingModalProduct.comboPrice ?? 0).toFixed(2)}</span>
                        <div className="relative w-24">
                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-400">{currencySymbol}</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={comboPricingForm[branch.id] || ''}
                            onChange={(e) => setComboPricingForm(prev => ({ ...prev, [branch.id]: e.target.value }))}
                            className={`w-full pl-5 pr-1.5 py-1 rounded-lg border text-[10px] font-mono font-bold focus:outline-none focus:ring-1 ${
                              comboPricingForm[branch.id] && !isNaN(Number(comboPricingForm[branch.id])) && Number(comboPricingForm[branch.id]) !== Number(pricingModalProduct.comboPrice ?? 0)
                                ? 'border-purple-300 bg-purple-50/50 focus:ring-purple-500 text-purple-700'
                                : 'border-gray-200 focus:ring-[var(--brand-color)]'
                            }`}
                            placeholder={(pricingModalProduct.comboPrice ?? 0).toFixed(2)}
                          />
                        </div>
                      </div>
                    )}

                    {/* Variant pricing sub-rows */}
                    {pricingModalProduct.variants && pricingModalProduct.variants.length > 0 && (
                      <div className="ml-2 pl-3 border-l-2 border-purple-200 space-y-1.5 mt-1.5">
                        {pricingModalProduct.variants.map(v => {
                          const vOverride = variantPricingForm[branch.id]?.[v.name] || '';
                          const vIsDiff = vOverride && !isNaN(Number(vOverride)) && Number(vOverride) !== v.price;
                          return (
                            <div key={v.name} className="flex items-center gap-2">
                              <span className="text-[9px] font-medium text-gray-500 w-20 truncate shrink-0">{v.name}</span>
                              <span className="text-[9px] text-gray-400 w-16">Default: {currencySymbol}{v.price.toFixed(2)}</span>
                              <div className="relative w-24">
                                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-400">{currencySymbol}</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={vOverride}
                                  onChange={(e) => setVariantPricingForm(prev => ({
                                    ...prev,
                                    [branch.id]: { ...(prev[branch.id] || {}), [v.name]: e.target.value },
                                  }))}
                                  className={`w-full pl-5 pr-1.5 py-1 rounded-lg border text-[10px] font-mono font-bold focus:outline-none focus:ring-1 ${
                                    vIsDiff
                                      ? 'border-pink-300 bg-pink-50/50 focus:ring-pink-500 text-pink-700'
                                      : 'border-gray-200 focus:ring-[var(--brand-color)]'
                                  }`}
                                  placeholder={String(v.price)}
                                />
                                {vIsDiff && (
                                  <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[7px] text-pink-500">✦</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Overrides summary */}
              {(() => {
                const activeBaseOverrides = Object.entries(pricingForm).filter(([id, v]) => v && !isNaN(Number(v)));
                const activeVariantOverrides = Object.entries(variantPricingForm).filter(([branchId, vObj]) =>
                  Object.values(vObj).some(v => v && !isNaN(Number(v)))
                );
                if (activeBaseOverrides.length === 0 && activeVariantOverrides.length === 0) return null;
                return (
                  <div className="bg-purple-50 rounded-xl p-3 text-[10px] text-purple-800 mt-2 space-y-0.5">
                    {activeBaseOverrides.length > 0 && (
                      <p><span className="font-bold">{activeBaseOverrides.length}</span> branch{activeBaseOverrides.length > 1 ? 'es' : ''} with custom base pricing</p>
                    )}
                    {activeVariantOverrides.length > 0 && (
                      <p><span className="font-bold">{activeVariantOverrides.length}</span> branch{activeVariantOverrides.length > 1 ? 'es' : ''} with variant override{activeVariantOverrides.length > 1 ? 's' : ''}</p>
                    )}
                  </div>
                );
              })()}

              <div className="flex gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setPricingModalProduct(null)}
                  className="flex-1 py-2 border border-[var(--color-border-input)] rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveBranchPrices}
                  className="flex-1 py-2 bg-[var(--color-purple-600-solid)] text-white rounded-xl text-xs font-bold hover:bg-[var(--color-purple-700-solid)] transition-colors cursor-pointer flex items-center justify-center gap-1"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Save Prices
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Easy Recipe Maker overlay */}
      {showRecipeMaker && (
        <EasyRecipeMaker
          initialProduct={recipeProduct}
          onClose={() => { setShowRecipeMaker(false); setRecipeProduct(null); }}
          onSaved={() => { setShowRecipeMaker(false); setRecipeProduct(null); }}
        />
      )}

    </div>
  );
}
