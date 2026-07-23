/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, Plus, Trash2, Edit2, CheckCircle, XCircle, Star, Sparkles, X, ArrowUpDown, GripVertical } from 'lucide-react';
import { Product, ProductVariant } from '../src/types';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ProductManagerProps {
  products: Product[];
  onUpdateProducts: (updated: Product[]) => void;
  currencySymbol: string;
  categories: string[];
  onUpdateCategories: (updated: string[]) => void;
}

function SortableCategory({ id, onRemove, onEdit, key }: { id: string, onRemove: () => void, onEdit: (val: string) => void, key?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 bg-white p-2 rounded-lg border shadow-sm">
      <div {...attributes} {...listeners} className="cursor-grab text-gray-400">
        <GripVertical className="w-4 h-4" />
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
  onUpdateCategories
}: ProductManagerProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

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

  const filtered = products.filter(p => {
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
    setEditingProduct(null);
    setNewCatInput('');
    setIsAddModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setPCode(product.code);
    setPName(product.name);
    setPPrice(product.price);
    setPCategory(product.category);
    setPGst(product.gstPercent);
    setPImage(product.image);
    setPAvailability(product.availability);
    setPFavorite(!!product.favorite);
    setPVariants(product.variants || []);
    setNewCatInput('');
    setIsAddModalOpen(true);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim() || pPrice < 0) return;

    let finalCategory = pCategory;
    if (pCategory === '__NEW_CATEGORY__' || !categories.includes(pCategory)) {
      const val = newCatInput.trim();
      if (val) {
        const cleaned = val.charAt(0).toUpperCase() + val.slice(1);
        if (!categories.includes(cleaned)) {
          onUpdateCategories([...categories, cleaned]);
        }
        finalCategory = cleaned;
      } else {
        finalCategory = categories[0] || 'Pizzas';
      }
    }

    if (editingProduct) {
      // Editing Mode
      const updated = products.map(p => {
        if (p.id === editingProduct.id) {
          return {
            ...p,
            code: pCode,
            name: pName.trim(),
            price: Number(pPrice),
            category: finalCategory,
            gstPercent: Number(pGst),
            image: pImage || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
            availability: pAvailability,
            favorite: pFavorite,
            variants: pVariants.length > 0 ? pVariants : undefined
          };
        }
        return p;
      });
      onUpdateProducts(updated);
    } else {
      // Create Mode
      const newProduct: Product = {
        id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        code: pCode,
        name: pName.trim(),
        price: Number(pPrice),
        category: finalCategory,
        gstPercent: Number(pGst),
        image: pImage || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
        availability: pAvailability,
        favorite: pFavorite,
        variants: pVariants.length > 0 ? pVariants : undefined
      };
      onUpdateProducts([newProduct, ...products]);
    }
    setNewCatInput('');
    setIsAddModalOpen(false);
  };

  const handleDeleteProduct = (productId: string) => {
    if (deleteConfirmId === productId) {
      const updated = products.filter(p => p.id !== productId);
      onUpdateProducts(updated);
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-white p-4 rounded-xl border border-[#e1e2ed] shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight text-[#191b23]">Product & Catalog Management</h2>
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
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
            />
          </div>

          <button
            onClick={openAddModal}
            className="flex items-center gap-1 bg-[#004ac6] hover:bg-[#003ea8] text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-md cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add New Product
          </button>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-sm cursor-pointer shrink-0"
          >
            Manage Categories
          </button>
        </div>
      </div>

      {/* Category Tabs & Quick Add */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-4 select-none border-b border-gray-100">
        {['All', ...categories].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-1.5 rounded-full font-semibold text-xs transition-all whitespace-nowrap cursor-pointer ${
              selectedCategory === cat
                ? 'bg-[#004ac6] text-white shadow-sm'
                : 'bg-white text-gray-600 border border-[#e1e2ed] hover:bg-[#f3f3fe]'
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
                setSelectedCategory(cleaned);
              } else {
                setSelectedCategory(cleaned);
              }
              input.value = '';
            }
          }}
          className="flex items-center gap-1.5 border border-dashed border-gray-300 rounded-full pl-3 pr-1 py-0.5 bg-gray-50/50 hover:bg-gray-50 focus-within:border-[#004ac6] focus-within:bg-white transition-all shrink-0 ml-1"
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
            className="p-1 rounded-full bg-[#004ac6] hover:bg-[#003ea8] text-white cursor-pointer transition-colors"
            title="Create Category"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </form>
      </div>

      {/* Grid Layout of products */}
      <div className="flex-1 overflow-y-auto min-h-[400px]">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e1e2ed] p-12 text-center text-gray-500 flex flex-col items-center justify-center">
            <XCircle className="w-12 h-12 text-gray-300 mb-3" />
            <p className="font-semibold text-md text-[#191b23]">No products match search criteria</p>
            <p className="text-xs text-gray-400 mt-1">Clear filters or register a new product to populate the catalog grid.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
            {filtered.map((product) => (
              <div 
                key={product.id}
                className={`bg-white rounded-xl border p-4 shadow-sm relative flex flex-col justify-between transition-all ${
                  product.availability ? 'border-[#e1e2ed] hover:shadow-md' : 'border-gray-200 bg-gray-50/50 opacity-75'
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
                          product.favorite ? 'bg-amber-400 text-white' : 'bg-white text-gray-400 hover:text-amber-500'
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
                    <h3 className="font-bold text-xs text-[#191b23] line-clamp-1">{product.name}</h3>
                    <span className="text-[9px] font-bold bg-[#f3f3fe] text-[#004ac6] px-2 py-0.5 rounded-full uppercase">
                      {product.category}
                    </span>
                  </div>

                  {/* Pricing and GST */}
                  <div className="flex justify-between items-center text-xs text-gray-500 mb-3">
                    <span className="font-bold text-sm text-[#191b23]">
                      {currencySymbol}{product.price.toFixed(2)}
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

                  <button
                    onClick={() => openEditModal(product)}
                    className="p-1.5 text-gray-500 hover:text-[#004ac6] bg-[#faf8ff] hover:bg-[#e7e7f3] border border-[#e1e2ed] rounded-lg transition-all cursor-pointer"
                    title="Edit Item details"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDeleteProduct(product.id)}
                    className={`p-1.5 border rounded-lg transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                      deleteConfirmId === product.id
                        ? 'bg-red-600 border-red-600 text-white animate-pulse'
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
        <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed]">
            <div className="bg-[#f3f3fe] px-6 py-4 border-b border-[#e1e2ed] flex justify-between items-center">
              <h3 className="font-bold text-[#191b23] text-sm">Manage Categories</h3>
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
                  className="px-4 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  Done
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-[#e1e2ed]">
            
            {/* Header */}
            <div className="bg-[#f3f3fe] px-6 py-4 border-b border-[#e1e2ed] flex justify-between items-center">
              <h3 className="font-bold text-[#191b23] text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#004ac6]" />
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
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                    required
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Category</label>
                  <select
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
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
                        className="flex-1 px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
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
                        className="px-3 py-1.5 bg-[#004ac6] hover:bg-[#003ea8] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 transition-colors"
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
                  className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Price */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Base Price ({currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g., 14.50"
                    value={pPrice || ''}
                    onChange={(e) => setPPrice(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                    required
                  />
                </div>

                {/* GST */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">GST Tax Rate (%)</label>
                  <select
                    value={pGst}
                    onChange={(e) => setPGst(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                  >
                    <option value={0}>0% Tax Exempt</option>
                    <option value={5}>5% Food Services GST</option>
                    <option value={12}>12% Processed Food GST</option>
                    <option value={18}>18% Premium Beverages GST</option>
                  </select>
                </div>
              </div>

              {/* Image URL */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Product Image URL</label>
                <input
                  type="url"
                  placeholder="Paste Unsplash culinary hotlink..."
                  value={pImage}
                  onChange={(e) => setPImage(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
              </div>

              {/* Advanced Variants Sub-panel */}
              <div className="border border-[#e1e2ed] p-3 rounded-lg bg-gray-50 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#191b23] block">
                  Product Variants (Optional)
                </span>
                <p className="text-[9px] text-gray-400">If variants are declared, they will display as select-buttons during order billing.</p>
                
                {/* Variant list preview */}
                {pVariants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-1 bg-white border border-gray-200 rounded min-h-8">
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
                    className="col-span-6 px-2 py-1 border border-[#c3c6d7] rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price"
                    value={varPrice || ''}
                    onChange={(e) => setVarPrice(Number(e.target.value))}
                    className="col-span-4 px-2 py-1 border border-[#c3c6d7] rounded text-xs font-mono font-bold bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  />
                  <button
                    type="button"
                    onClick={handleAddVariant}
                    className="col-span-2 bg-[#004ac6] hover:bg-[#003ea8] text-white rounded font-bold text-xs flex items-center justify-center cursor-pointer"
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
                    className="rounded text-[#004ac6] focus:ring-[#004ac6]"
                  />
                  <span className="text-xs text-gray-700 font-semibold">Available for Immediate Billing</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pFavorite}
                    onChange={(e) => setPFavorite(e.target.checked)}
                    className="rounded text-[#004ac6] focus:ring-[#004ac6]"
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
                  className="px-5 py-2 bg-[#004ac6] hover:bg-[#003ea8] text-white rounded-lg text-xs font-bold shadow-md cursor-pointer"
                >
                  {editingProduct ? 'Update Product Details' : 'Register Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
