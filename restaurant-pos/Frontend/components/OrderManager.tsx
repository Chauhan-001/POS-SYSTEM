/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Search, Plus, Clock, Users, User, MapPin, Phone, ArrowRight,
  ShoppingBag, Package, UtensilsCrossed, Bike, Globe,
  RefreshCw, AlertCircle, ChevronRight, MoreHorizontal, Printer,
  CreditCard, Wallet, CheckCircle, XCircle, Edit3, Eye, Receipt,
  Timer, LayoutGrid, List, Layers, Coffee, Trash, Map
} from 'lucide-react';
import { Order, OrderStatus, TableInfo, TakeawayOrder, TableStatus, CartItem, Employee, Floor } from '../src/types';
import { useCurrentTime } from '../src/hooks/useCurrentTime';
import { computeRunningBillTotals } from '../src/utils/runningBill';
import RestaurantFloorPlan from './RestaurantFloorPlan';
import TableCard from './TableCard';
import TakeawayCard from './TakeawayCard';
import OnlineOrderCard from './OnlineOrderCard';

interface OrderManagerProps {
  orders: Order[];
  tables: TableInfo[];
  takeawayOrders: TakeawayOrder[];
  onOpenOrder: (order: Order) => void;
  onCreateOrder: (type: Order['type'], tableId?: string) => void;
  onCreateTakeawayOrder: () => void;
  onUpdateTakeawayOrder: (id: string, updates: Partial<TakeawayOrder>) => void;
  onClearCompletedTakeaways: () => void;
  onOpenBilling: (order: Order) => void;
  onOpenReceiptPreview: (order: Order) => void;
  employees: Employee[];
  settings: any;
  currentEmployee: Employee | null;
  showToast: (message: string, type: 'success' | 'info' | 'warning') => void;
  onAddTable: (table: Omit<TableInfo, 'id'>) => void;
  onUpdateTable: (id: string, updates: Partial<TableInfo>) => void;
  onDeleteTable: (id: string) => void;
  floors?: Floor[];
}

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue-100 text-blue-800 border-blue-200',
  'Accepted': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Preparing': 'bg-amber-100 text-amber-800 border-amber-200',
  'Ready': 'bg-green-100 text-green-800 border-green-200',
  'Served': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Waiting Payment': 'bg-orange-100 text-orange-800 border-orange-200',
  'Paid': 'bg-teal-100 text-teal-800 border-teal-200',
  'Closed': 'bg-gray-100 text-gray-600 border-gray-200',
  'Cancelled': 'bg-red-100 text-red-800 border-red-200',
  'Refunded': 'bg-purple-100 text-purple-800 border-purple-200',
  'Held': 'bg-slate-100 text-slate-700 border-slate-300',
};

const TABLE_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Available': { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'Occupied': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  'Reserved': { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  'Preparing': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  'Food Ready': { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  'Served': { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  'Waiting Payment': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  'Cleaning': { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  'Paid': { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
  'Cancelled': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  'Disabled': { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' },
  'Merged': { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
};

export default function OrderManager({
  orders, tables, takeawayOrders,
  onOpenOrder, onCreateOrder, onCreateTakeawayOrder,
  onUpdateTakeawayOrder, onClearCompletedTakeaways,
  onOpenBilling, onOpenReceiptPreview, employees, settings, currentEmployee, showToast,
  onAddTable, onUpdateTable, onDeleteTable, floors = []
}: OrderManagerProps) {
  // Section filter for grid view
  const [activeSection, setActiveSection] = useState<string>('All');
  // Floor filter (multi-floor layout) — 'All' when floors exist, else null
  const [activeFloorId, setActiveFloorId] = useState<string>('All');
  const getUniqueSections = (): string[] => {
    const sections = new Set(tables.map(t => t.section).filter(Boolean));
    return ['All', ...Array.from(sections)];
  };

  // Apply the active floor filter to the table set (backward compatible: when
  // no floors exist, activeFloorId stays 'All' and nothing is filtered).
  const floorFilteredTables = useMemo(() => {
    if (activeFloorId === 'All' || floors.length === 0) return tables;
    return tables.filter(t => !t.floorId || t.floorId === activeFloorId);
  }, [tables, activeFloorId, floors.length]);

  const [activeTab, setActiveTab] = useState<'tables' | 'takeaway' | 'online' | 'all'>('tables');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'floorplan'>('grid');
  const moduleSettings = settings?.moduleSettings || {};
  const isTableServiceEnabled = moduleSettings.enableTableService !== false;

  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [editingTable, setEditingTable] = useState<TableInfo | null>(null);
  const [tableForm, setTableForm] = useState({ number: '', capacity: 4, section: 'Main Hall', status: 'Available' as TableStatus });

  const filteredTableList = useMemo(() => {
    const base = floorFilteredTables;
    if (!tableSearch) return base;
    const q = tableSearch.toLowerCase();
    return base.filter(t =>
      String(t.number).includes(q) ||
      t.status.toLowerCase().includes(q) ||
      (t.section || '').toLowerCase().includes(q)
    );
  }, [floorFilteredTables, tableSearch]);

  // Filter available waiters
  const availableWaiters = employees.filter(e => e.status === 'Active' && e.role !== 'Owner');

  // Get active orders for each table — match by the order's tableId OR by the
  // table.orderId (which mirrors the real order id) so the live order is always
  // found after KOT even if the tableId linkage drifts (e.g. server id swap).
  const getOrderForTable = (tableId: string): Order | undefined => {
    const table = tables.find(t => t.id === tableId);
    return orders.find(o =>
      (o.tableId === tableId || (table?.orderId && o.id === table.orderId)) &&
      !['Closed', 'Cancelled', 'Paid'].includes(o.status)
    );
  };

  // Auto-remove completed/collected takeaway orders older than 5 minutes
  React.useEffect(() => {
    const cleanup = () => {
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;
      const hasOldCompleted = takeawayOrders.some(
        to => (to.status === 'Completed' || to.status === 'Collected') && new Date(to.createdAt).getTime() < fiveMinAgo
      );
      if (hasOldCompleted) {
        onClearCompletedTakeaways();
      }
    };
    cleanup();
    const interval = setInterval(cleanup, 60000);
    return () => clearInterval(interval);
  }, [takeawayOrders, onClearCompletedTakeaways]);

  // Filter orders based on search
  const filteredOrders = useMemo(() => {
    if (!searchQuery) return orders;
    const q = searchQuery.toLowerCase();
    return orders.filter(o =>
      o.orderNumber.toString().includes(q) ||
      o.customerName?.toLowerCase().includes(q) ||
      o.type.toLowerCase().includes(q) ||
      o.status.toLowerCase().includes(q)
    );
  }, [orders, searchQuery]);

  // Compute elapsed time — wrapped in useCallback so memoized card components
  // can do reference-equality checks and skip re-renders. The optional `now`
  // lets live table cards pass their ticking clock so the occupancy timer
  // updates every second without re-rendering the whole OrderManager.
  // Live ticking clock so the elapsed timers on takeaway/online/all cards update
  // every second instead of freezing between parent re-renders.
  const now = useCurrentTime();

  const getElapsedTime = useCallback((createdAt: string, now?: Date): string => {
    const created = new Date(createdAt);
    const current = now ?? new Date();
    const diff = Math.floor((current.getTime() - created.getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}h ${mins}m`;
  }, []);

  // Get running bill for a table — computed LIVE from the order's current items
  // (order.grandTotal is only finalized at checkout, so it's 0 while occupied).
  const getRunningBill = (tableId: string): number => {
    const order = getOrderForTable(tableId);
    if (!order) return 0;
    return computeRunningBillTotals(order.items || []).grandTotal;
  };

  const openAddTableModal = () => {
    setEditingTable(null);
    setTableForm({ number: '', capacity: 4, section: 'Main Hall', status: 'Available' });
    setIsFormOpen(true);
  };

  const openEditTableModal = (table: TableInfo) => {
    setEditingTable(table);
    setTableForm({ number: String(table.number), capacity: table.capacity, section: table.section || 'Main Hall', status: table.status });
    setIsFormOpen(true);
  };

  const handleTableSubmit = () => {
    if (!tableForm.number || isNaN(Number(tableForm.number))) {
      showToast('Enter a valid table number.', 'warning');
      return;
    }
    if (editingTable) {
      onUpdateTable(editingTable.id, {
        number: Number(tableForm.number),
        capacity: tableForm.capacity,
        section: tableForm.section,
        status: tableForm.status,
      });
      showToast('Table updated successfully', 'success');
    } else {
      onAddTable({
        number: Number(tableForm.number),
        capacity: tableForm.capacity,
        section: tableForm.section,
        status: tableForm.status,
      });
      showToast('Table added successfully', 'success');
    }
    setIsFormOpen(false);
  };

  const handleDeleteTable = (id: string) => {
    if (window.confirm('Are you sure you want to delete this table?')) {
      onDeleteTable(id);
      showToast('Table deleted', 'info');
    }
  };

  // High-level order counts
  const activeOrdersCount = orders.filter(o => 
    !['Closed', 'Cancelled', 'Paid'].includes(o.status)).length;
  const preparingCount = orders.filter(o => o.status === 'Preparing').length;
  const waitingPaymentCount = orders.filter(o => o.status === 'Waiting Payment').length;
  const occupiedTablesCount = tables.filter(t => t.status !== 'Available').length;

  // Filter tables by active section + active floor (grid view)
  const filteredTables = useMemo(() => {
    const base = activeSection === 'All' ? floorFilteredTables : floorFilteredTables.filter(t => t.section === activeSection);
    return base;
  }, [floorFilteredTables, activeSection]);

  // Section color mapping
  const sectionColors: Record<string, string> = {
    'Main Hall': 'bg-blue-100 text-blue-800 border-blue-200',
    'Terrace': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'VIP Room': 'bg-purple-100 text-purple-800 border-purple-200',
    'Garden': 'bg-amber-100 text-amber-800 border-amber-200',
  };

  // ============ INLINE TOKEN COMPUTATION HELPERS ============
  // These are passed as callbacks to memoized card components.
  const currencySymbol = settings.currencySymbol || '₹';

  // Group online orders by platform
  const onlineOrdersByPlatform = useMemo(() => {
    const platforms = ['Swiggy', 'Zomato', 'Uber Eats', 'Website', 'Phone Orders'] as const;
    const grouped: Record<string, Order[]> = {};
    platforms.forEach(p => { grouped[p] = []; });
    
    orders.filter(o => 
      ['Swiggy', 'Zomato', 'Uber Eats', 'Website', 'Phone Orders'].includes(o.type) &&
      !['Closed', 'Cancelled'].includes(o.status)
    ).forEach(o => {
      if (!grouped[o.type]) grouped[o.type] = [];
      grouped[o.type].push(o);
    });
    
    return grouped;
  }, [orders]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#f8f6f3] overflow-hidden">
      {/* Header section */}
      <div className="bg-white border-b border-gray-200 px-5 py-3.5 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-extrabold text-gray-900 tracking-tight">Order Management</h1>
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-1 rounded-full border border-emerald-200">
              {activeOrdersCount} Active
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTableModalOpen(true)}
              className="flex items-center gap-1.5 bg-white border border-gray-200 hover:border-gray-400 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Manage Tables
            </button>
            {/* View mode toggle buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-gray-900 text-white' : 'hover:bg-gray-100 text-gray-500'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>

              <button
                onClick={() => setViewMode('floorplan')}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'floorplan' ? 'bg-emerald-700 text-white' : 'hover:bg-gray-100 text-gray-500'
                }`}
                title="Floor plan view"
              >
                <Map className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex gap-3 mb-3">
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <Timer className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[10px] font-bold text-amber-800">{preparingCount} Preparing</span>
          </div>
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
            <CreditCard className="w-3.5 h-3.5 text-orange-600" />
            <span className="text-[10px] font-bold text-orange-800">{waitingPaymentCount} Waiting Payment</span>
          </div>
          {isTableServiceEnabled && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
              <Users className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] font-bold text-blue-800">{occupiedTablesCount}/{tables.length} Tables</span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
            <ShoppingBag className="w-3.5 h-3.5 text-green-600" />
            <span className="text-[10px] font-bold text-green-800">{takeawayOrders.length} Takeaway</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-gray-100 pb-0">
          {isTableServiceEnabled && (
            <button
              onClick={() => setActiveTab('tables')}
              className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'tables'
                  ? 'bg-[#f8f6f3] text-gray-900 border-t border-l border-r border-gray-200 -mb-px'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Tables
              {occupiedTablesCount > 0 && (
                <span className="bg-gray-900 text-white text-[8px] px-1.5 py-0.5 rounded-full">{occupiedTablesCount}</span>
              )}
            </button>
          )}
          <button
            onClick={() => setActiveTab('takeaway')}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'takeaway'
                ? 'bg-[#f8f6f3] text-gray-900 border-t border-l border-r border-gray-200 -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Takeaway
            {takeawayOrders.length > 0 && (
              <span className="bg-gray-900 text-white text-[8px] px-1.5 py-0.5 rounded-full">{takeawayOrders.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('online')}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'online'
                ? 'bg-[#f8f6f3] text-gray-900 border-t border-l border-r border-gray-200 -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Online Orders
            {Object.values(onlineOrdersByPlatform).flat().length > 0 && (
              <span className="bg-gray-900 text-white text-[8px] px-1.5 py-0.5 rounded-full">
                {Object.values(onlineOrdersByPlatform).flat().length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-[#f8f6f3] text-gray-900 border-t border-l border-r border-gray-200 -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            All Orders
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        {/* TABLES VIEW */}
        {activeTab === 'tables' && isTableServiceEnabled && (
          <div>
            {/* Floor Filter Tabs (multi-floor layouts) */}
            {floors.length > 0 && (
              <div className="flex gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 self-center">
                  <Layers className="w-3 h-3" /> Floor
                </span>
                <button
                  onClick={() => setActiveFloorId('All')}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                    activeFloorId === 'All'
                      ? 'bg-[#004ac6] text-white shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  All
                </button>
                {floors.filter(f => f.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder).map((floor) => (
                  <button
                    key={floor.id}
                    onClick={() => setActiveFloorId(floor.id)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                      activeFloorId === floor.id
                        ? 'bg-[#004ac6] text-white shadow-sm'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {floor.name}
                  </button>
                ))}
              </div>
            )}

            {/* Section Filter Tabs (grid view only) */}
            {viewMode !== 'floorplan' && (
              <div className="flex gap-2 mb-4 flex-wrap">
                {getUniqueSections().map((section) => (
                  <button
                    key={section}
                    onClick={() => setActiveSection(section)}
                    className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeSection === section
                        ? 'bg-gray-900 text-white shadow-sm'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:text-gray-800'
                    }`}
                  >
                    {section === 'All' ? (
                      <LayoutGrid className="w-3 h-3" />
                    ) : (
                      <Layers className="w-3 h-3" />
                    )}
                    {section}
                    {section !== 'All' && (
                      <span className={`text-[8px] ml-0.5 ${
                        activeSection === section ? 'text-white/70' : 'text-gray-400'
                      }`}>
                        ({tables.filter(t => t.section === section).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Floor Plan View */}
            {viewMode === 'floorplan' ? (
              <RestaurantFloorPlan
                tables={tables}
                orders={orders}
                settings={settings}
                onCreateOrder={onCreateOrder}
                onOpenBilling={onOpenBilling}
                onOpenReceiptPreview={onOpenReceiptPreview}
                onAddTable={onAddTable}
                onUpdateTable={onUpdateTable}
                onDeleteTable={onDeleteTable}
                showToast={showToast}
              />
            ) : (
              /* Table Grid / List View */
              <div className={viewMode === 'grid'
                ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'
                : 'grid grid-cols-1 gap-2'
              }>
                {filteredTables.length === 0 ? (
                  <div className="col-span-full text-center py-16 text-gray-400">
                    <LayoutGrid className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-semibold text-gray-500">No tables in this section</p>
                    <p className="text-xs mt-1">Switch sections or create a new order to get started</p>
                  </div>
                ) : (
                  filteredTables.map(table => (
                    <TableCard
                      key={table.id}
                      table={table}
                      order={getOrderForTable(table.id)}
                      bill={getRunningBill(table.id)}
                      currencySymbol={currencySymbol}
                      sectionColors={sectionColors}
                      TABLE_STATUS_COLORS={TABLE_STATUS_COLORS}
                      onOpenReceiptPreview={onOpenReceiptPreview}
                      onOpenBilling={onOpenBilling}
                      onCreateOrder={onCreateOrder}
                      getElapsedTime={getElapsedTime}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* TAKEAWAY VIEW */}
        {activeTab === 'takeaway' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-sm text-gray-800">
                Takeaway Orders
                {takeawayOrders.filter(t => t.status === 'Completed' || t.status === 'Collected').length > 0 && (
                  <span className="ml-2 bg-gray-100 text-gray-500 text-[9px] font-bold px-2 py-0.5 rounded-full">
                    {takeawayOrders.filter(t => t.status === 'Completed' || t.status === 'Collected').length} completed
                  </span>
                )}
              </h2>
              <div className="flex gap-2">
                {takeawayOrders.filter(t => t.status === 'Completed' || t.status === 'Collected').length > 0 && (
                  <button
                    onClick={onClearCompletedTakeaways}
                    className="flex items-center gap-1.5 bg-white border border-gray-200 hover:border-red-300 hover:text-red-600 text-gray-500 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                  >
                    <Trash className="w-3 h-3" />
                    Clear Completed
                  </button>
                )}
                <button
                  onClick={onCreateTakeawayOrder}
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Takeaway
                </button>
              </div>
            </div>

            {takeawayOrders.length === 0 ? (
              <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-200">
                <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-semibold text-gray-500">No takeaway orders</p>
                <p className="text-xs mt-1">Create a new takeaway order to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {takeawayOrders.map(order => (
                    <TakeawayCard
                      key={order.id}
                      order={order}
                      orders={orders}
                      currencySymbol={currencySymbol}
                      onOpenBilling={onOpenBilling}
                      onUpdateTakeawayOrder={onUpdateTakeawayOrder}
                      showToast={showToast}
                      getElapsedTime={getElapsedTime}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {/* ONLINE ORDERS VIEW */}
        {activeTab === 'online' && (
          <div className="space-y-6">
            {(['Swiggy', 'Zomato', 'Uber Eats', 'Website', 'Phone Orders'] as const).map(platform => {
              const platformOrders = onlineOrdersByPlatform[platform] || [];
              const platformIcon = platform === 'Swiggy' ? '🟠'
                : platform === 'Zomato' ? '🔴'
                : platform === 'Uber Eats' ? '🔵'
                : platform === 'Website' ? '🟣'
                : '⚪';

              if (platformOrders.length === 0) return null;

              return (
                <div key={platform}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">{platformIcon}</span>
                    <h3 className="font-bold text-sm text-gray-800">{platform}</h3>
                    <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-full">
                      {platformOrders.length} active
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {platformOrders.map(order => (
                      <OnlineOrderCard
                        key={order.id}
                        order={order}
                        currencySymbol={currencySymbol}
                        STATUS_COLORS={STATUS_COLORS}
                        onOpenBilling={onOpenBilling}
                        getElapsedTime={getElapsedTime}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {Object.values(onlineOrdersByPlatform).flat().length === 0 && (
              <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-200">
                <Globe className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-semibold text-gray-500">No online orders</p>
                <p className="text-xs mt-1">Incoming orders from platforms will appear here</p>
              </div>
            )}
          </div>
        )}

        {/* ALL ORDERS VIEW */}
        {activeTab === 'all' && (
          <div>
            <div className="mb-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by order #, customer, type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-400/20 focus:border-gray-400 bg-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              {filteredOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-200">
                  <List className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-semibold text-gray-500">No orders found</p>
                  <p className="text-xs mt-1">Create a new order to get started</p>
                </div>
              ) : (
                filteredOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(order => (
                  <div
                    key={order.id}
                    onClick={() => onOpenBilling(order)}
                    className="bg-white rounded-xl border border-gray-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-center">
                        <span className="font-black text-sm text-gray-900">#{order.orderNumber}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold mt-1 ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                          {order.status}
                        </span>
                      </div>
                      <div className="border-l border-gray-200 pl-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-gray-800">{order.type}</span>
                          {order.tableNumber && (
                            <span className="bg-gray-100 text-gray-600 text-[9px] px-1.5 py-0.5 rounded font-bold">T{order.tableNumber}</span>
                          )}
                          {order.platform && (
                            <span className="bg-orange-50 text-orange-700 text-[8px] px-1.5 py-0.5 rounded font-bold">{order.platform}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                          {order.customerName && <span>{order.customerName}</span>}
                          <span>{order.items.length} items</span>
                          <span>{getElapsedTime(order.createdAt, now)}</span>
                          {order.waiterName && <span>👤 {order.waiterName}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const running = computeRunningBillTotals(order.items || []).grandTotal;
                        const isRunning = running > 0;
                        return (
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-bold text-sm">{settings.currencySymbol || '₹'}{(isRunning ? running : order.grandTotal).toFixed(2)}</span>
                            {isRunning && (
                              <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-bold">RUNNING</span>
                            )}
                          </div>
                        );
                      })()}
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Table Management Modal */}
      {isTableModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-200 overflow-hidden will-change-transform">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-gray-700" />
                <h3 className="font-bold text-sm text-gray-900">Table Management</h3>
                <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-full">
                  {tables.length} tables
                </span>
              </div>
              <button onClick={() => setIsTableModalOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Toolbar */}
            <div className="px-6 py-3 border-b border-gray-100 flex justify-between items-center shrink-0 bg-gray-50/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tables..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-400/20 focus:border-gray-400 bg-white"
                />
              </div>
              <button
                onClick={openAddTableModal}
                className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Table
              </button>
            </div>

            {/* Table List */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {filteredTableList.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <LayoutGrid className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="font-semibold text-gray-500">No tables found</p>
                  </div>
                ) : (
                  filteredTableList.map((table) => (
                    <div
                      key={table.id}
                      className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                        table.status === 'Available'
                          ? 'bg-white border-gray-200 hover:border-emerald-300'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg ${
                          table.status === 'Available' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-700'
                        }`}>
                          T{table.number}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm text-gray-900">{table.capacity} Seats</span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${TABLE_STATUS_COLORS[table.status]?.text} ${TABLE_STATUS_COLORS[table.status]?.bg} border ${TABLE_STATUS_COLORS[table.status]?.dot.replace('bg-', 'border-')}/30`}>
                              {table.status}
                            </span>
                            {table.section && (
                              <span className="bg-gray-100 text-gray-600 text-[9px] px-2 py-0.5 rounded-full font-medium">
                                {table.section}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-gray-500">
                            <span>Capacity: {table.capacity}</span>
                            {table.waiterName && <span>• Waiter: {table.waiterName}</span>}
                            {table.reservationName && <span>• Reservation: {table.reservationName}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditTableModal(table)}
                          className="w-9 h-9 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center cursor-pointer transition-colors border border-blue-200"
                          title="Edit table"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTable(table.id)}
                          className="w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center cursor-pointer transition-colors border border-red-200"
                          title="Delete table"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex justify-between items-center shrink-0">
              <span className="text-[10px] text-gray-500">
                Showing {filteredTableList.length} of {tables.length} tables
              </span>
              <button
                onClick={() => setIsTableModalOpen(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

          {/* Inline add/edit form overlay inside modal */}
          {isFormOpen && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
                  <h3 className="font-bold text-sm text-gray-900">
                    {editingTable ? 'Edit Table' : 'Add New Table'}
                  </h3>
                  <button onClick={() => setIsFormOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Table Number</label>
                    <input
                      type="number"
                      value={tableForm.number}
                      onChange={(e) => setTableForm({ ...tableForm, number: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-gray-400"
                      placeholder="e.g. 1"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Capacity</label>
                    <input
                      type="number"
                      value={tableForm.capacity}
                      onChange={(e) => setTableForm({ ...tableForm, capacity: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-gray-400"
                      placeholder="e.g. 4"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Section</label>
                    <select
                      value={tableForm.section}
                      onChange={(e) => setTableForm({ ...tableForm, section: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                    >
                      <option value="Main Hall">Main Hall</option>
                      <option value="Terrace">Terrace</option>
                      <option value="VIP Room">VIP Room</option>
                      <option value="Garden">Garden</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Status</label>
                    <select
                      value={tableForm.status}
                      onChange={(e) => setTableForm({ ...tableForm, status: e.target.value as TableStatus })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                    >
                      <option value="Available">Available</option>
                      <option value="Occupied">Occupied</option>
                      <option value="Reserved">Reserved</option>
                      <option value="Preparing">Preparing</option>
                      <option value="Food Ready">Food Ready</option>
                      <option value="Served">Served</option>
                      <option value="Waiting Payment">Waiting Payment</option>
                      <option value="Cleaning">Cleaning</option>
                      <option value="Paid">Paid</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
                  <button
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTableSubmit}
                    className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    {editingTable ? 'Update Table' : 'Add Table'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
