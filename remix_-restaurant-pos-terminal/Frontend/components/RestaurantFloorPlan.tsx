import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Clock, AlertCircle, Eye, Receipt, CheckCircle, Timer,
  UtensilsCrossed, MapPin, Maximize2, Minimize2,
  Pencil, Plus, Trash2, X, Save, Square, Circle, Move,
  Table, Search, Edit3, Palette, Layers
} from 'lucide-react';
import type { TableInfo, Order } from '../src/types';

interface RestaurantFloorPlanProps {
  tables: TableInfo[];
  orders: Order[];
  settings: any;
  onCreateOrder: (type: string, tableId?: string) => void;
  onOpenBilling: (order: Order) => void;
  onOpenReceiptPreview: (order: Order) => void;
  onAddTable?: (table: Omit<TableInfo, 'id'>) => void;
  onUpdateTable?: (id: string, updates: Partial<TableInfo>) => void;
  onDeleteTable?: (id: string) => void;
  showToast?: (message: string, type: 'success' | 'info' | 'warning') => void;
}

interface TableLayout { x: number; y: number; shape: 'round' | 'rect'; scale?: number; }

interface AreaLayout { x: number; y: number; width: number; height: number; }

interface FloorArea {
  id: string;
  label: string;
  colorIndex: number;
}

interface CanvasSection {
  id: string;
  label: string;
  x: number; y: number; width: number; height: number;
  text: string; bg: string; border: string;
  tableIds: string[];
}

const STATUS_STYLES: Record<string, { ring: string; bg: string; dot: string; label: string }> = {
  'Available': { ring: 'ring-emerald-400/60', bg: 'bg-emerald-50', dot: 'bg-emerald-500', label: 'text-emerald-700' },
  'Occupied': { ring: 'ring-orange-400/60', bg: 'bg-orange-50', dot: 'bg-orange-500', label: 'text-orange-700' },
  'Reserved': { ring: 'ring-blue-400/60', bg: 'bg-blue-50', dot: 'bg-blue-500', label: 'text-blue-700' },
  'Preparing': { ring: 'ring-amber-400/60', bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'text-amber-700' },
  'Food Ready': { ring: 'ring-green-400/60', bg: 'bg-green-50', dot: 'bg-green-500', label: 'text-green-700' },
  'Served': { ring: 'ring-teal-400/60', bg: 'bg-teal-50', dot: 'bg-teal-500', label: 'text-teal-700' },
  'Waiting Payment': { ring: 'ring-orange-400/60', bg: 'bg-orange-50', dot: 'bg-orange-500', label: 'text-orange-700' },
  'Cleaning': { ring: 'ring-sky-400/60', bg: 'bg-sky-50', dot: 'bg-sky-500', label: 'text-sky-700' },
  'Paid': { ring: 'ring-gray-400/60', bg: 'bg-gray-50', dot: 'bg-gray-500', label: 'text-gray-700' },
  'Cancelled': { ring: 'ring-red-400/60', bg: 'bg-red-50', dot: 'bg-red-500', label: 'text-red-700' },
};

const AREA_COLORS: { text: string; bg: string; border: string; fill: string }[] = [
  { text: 'text-blue-600', bg: 'bg-blue-50/60', border: 'border-blue-200/70', fill: '#bfdbfe' },
  { text: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-200/70', fill: '#a7f3d0' },
  { text: 'text-purple-600', bg: 'bg-purple-50/60', border: 'border-purple-200/70', fill: '#c4b5fd' },
  { text: 'text-amber-600', bg: 'bg-amber-50/60', border: 'border-amber-200/70', fill: '#fde68a' },
  { text: 'text-rose-600', bg: 'bg-rose-50/60', border: 'border-rose-200/70', fill: '#fecdd3' },
  { text: 'text-cyan-600', bg: 'bg-cyan-50/60', border: 'border-cyan-200/70', fill: '#a5f3fc' },
  { text: 'text-indigo-600', bg: 'bg-indigo-50/60', border: 'border-indigo-200/70', fill: '#c7d2fe' },
  { text: 'text-orange-600', bg: 'bg-orange-50/60', border: 'border-orange-200/70', fill: '#fdba74' },
];

const AREAS_KEY = 'pos_floor_areas';
const LAYOUT_KEY = 'pos_table_layouts';
const AREA_LAYOUT_KEY = 'pos_floor_area_layouts';

function getElapsedTime(c?: string): string {
  if (!c) return '';
  const d = Math.floor((Date.now() - new Date(c).getTime()) / 60000);
  if (d < 1) return 'Just now';
  if (d < 60) return `${d}m`;
  return `${Math.floor(d / 60)}h ${d % 60}m`;
}

function getTableSize(cap: number, scale: number = 1): { w: number; h: number; fs: string } {
  const base = cap >= 8 ? { w: 72, h: 72, fs: 'text-lg' } : cap >= 6 ? { w: 64, h: 64, fs: 'text-base' } : { w: 54, h: 54, fs: 'text-sm' };
  return { w: Math.round(base.w * scale), h: Math.round(base.h * scale), fs: scale >= 1.3 ? 'text-lg' : scale <= 0.7 ? 'text-xs' : base.fs };
}

function loadJSON<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function saveJSON(key: string, val: any) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function autoPositionTables(tables: TableInfo[], areas: FloorArea[], existing: Record<string, TableLayout>): Record<string, TableLayout> {
  const next = { ...existing };
  const areaBuckets: Record<string, TableInfo[]> = {};
  tables.forEach(t => {
    const s = t.section || 'Areas';
    if (!areaBuckets[s]) areaBuckets[s] = [];
    areaBuckets[s].push(t);
  });
  const areaIdx: Record<string, number> = {};
  tables.forEach(t => {
    if (next[t.id]) return;
    const s = t.section || 'Areas';
    if (areaIdx[s] === undefined) areaIdx[s] = 0;
    const list = areaBuckets[s] || [];
    const pos = areaIdx[s]++;
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length * 1.5)));
    const gapX = Math.min(20, 65 / (cols + 1));
    const rows = Math.ceil(list.length / cols);
    const gapY = Math.min(16, 55 / (rows + 1));
    next[t.id] = { x: 16 + (pos % cols) * gapX, y: 18 + Math.floor(pos / cols) * gapY, shape: 'round' };
  });
  return next;
}

export default function RestaurantFloorPlan({
  tables, orders, settings,
  onCreateOrder, onOpenBilling, onOpenReceiptPreview,
  onAddTable, onUpdateTable, onDeleteTable, showToast,
}: RestaurantFloorPlanProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTab, setEditTab] = useState<'areas' | 'tables'>('areas');
  const [areas, setAreas] = useState<FloorArea[]>(() => loadJSON(AREAS_KEY, [
    { id: 'area_1', label: 'Main Hall', colorIndex: 0 },
    { id: 'area_2', label: 'Terrace', colorIndex: 1 },
    { id: 'area_3', label: 'VIP Room', colorIndex: 2 },
    { id: 'area_4', label: 'Garden', colorIndex: 3 },
  ]));
  const [layouts, setLayouts] = useState<Record<string, TableLayout>>(() => loadJSON(LAYOUT_KEY, {}));
  const [areaLayouts, setAreaLayouts] = useState<Record<string, AreaLayout>>(() => loadJSON(AREA_LAYOUT_KEY, {}));
  const [dragging, setDragging] = useState<string | null>(null);
  const [draggingArea, setDraggingArea] = useState<string | null>(null);
  const [dragOff, setDragOff] = useState({ x: 0, y: 0 });
  const [dragAreaOff, setDragAreaOff] = useState({ x: 0, y: 0 });
  const [resizing, setResizing] = useState<{ id: string; dir: string } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; layout: AreaLayout } | null>(null);
  const [tableResizing, setTableResizing] = useState<string | null>(null);
  const tableResizeStart = useRef<{ x: number; y: number; cap: number } | null>(null);
  const [editingTableNum, setEditingTableNum] = useState<string | null>(null);
  const [editingTableNumVal, setEditingTableNumVal] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<Record<string, boolean>>({});
  const [addForm, setAddForm] = useState({ number: '', capacity: 4, area: '', shape: 'round' as 'round' | 'rect' });
  const [editSearch, setEditSearch] = useState('');
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editAreaLabel, setEditAreaLabel] = useState('');
  const [newAreaLabel, setNewAreaLabel] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);

  const persistLayouts = useCallback((l: Record<string, TableLayout>) => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveJSON(LAYOUT_KEY, l), 300);
  }, []);

  const persistAreaLayouts = useCallback((l: Record<string, AreaLayout>) => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveJSON(AREA_LAYOUT_KEY, l), 300);
  }, []);

  // Auto-position new tables
  useEffect(() => {
    const next = autoPositionTables(tables, areas, layouts);
    let changed = false;
    for (const id of Object.keys(next)) { if (!layouts[id]) { changed = true; break; } }
    if (changed) { setLayouts(next); persistLayouts(next); }
  }, [tables, areas]);

  // Save areas on change
  useEffect(() => { saveJSON(AREAS_KEY, areas); }, [areas]);

  const getOrder = (tbl: TableInfo) => orders.find(o => o.tableId === tbl.id && !['Closed', 'Cancelled', 'Paid'].includes(o.status));
  const occupied = tables.filter(t => t.status !== 'Available').length;

  // Auto-position new areas (no saved layout yet) — spreads across the scrollable canvas
  useEffect(() => {
    const cols = Math.min(areas.length, Math.ceil(Math.sqrt(areas.length * 1.2)));
    const totalRows = Math.ceil(areas.length / cols);
    const cellW = 90 / cols;
    const cellH = Math.min(80, 120 / totalRows);
    let changed = false;
    const next = { ...areaLayouts };
    areas.forEach((area, i) => {
      if (next[area.id]) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      next[area.id] = { x: 5 + col * cellW, y: 10 + row * cellH, width: cellW - 2, height: cellH - 4 };
      changed = true;
    });
    if (changed) { setAreaLayouts(next); persistAreaLayouts(next); }
  }, [areas]);

  // Build canvas sections from saved area layouts (no auto-expansion — full control)
  const canvasSections = useMemo((): CanvasSection[] => {
    if (areas.length === 0) return [];
    return areas.map(area => {
      const pal = AREA_COLORS[area.colorIndex % AREA_COLORS.length];
      const tIds = tables.filter(t => (t.section || 'Main Hall') === area.label).map(t => t.id);
      const saved = areaLayouts[area.id] || { x: 10, y: 10, width: 40, height: 30 };
      return { id: area.id, label: area.label, x: saved.x, y: saved.y, width: saved.width, height: saved.height, tableIds: tIds, ...pal };
    });
  }, [areas, tables, layouts, areaLayouts]);

  // --- Table Drag ---
  const handleGrab = (id: string, e: React.MouseEvent) => {
    if (editTab !== 'tables') return;
    e.preventDefault(); e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const lay = layouts[id] || { x: 50, y: 50, shape: 'round' };
    setDragging(id);
    setDragOff({ x: ((e.clientX - rect.left) / rect.width * 100) - lay.x, y: ((e.clientY - rect.top) / rect.height * 100) - lay.y });
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width * 100) - dragOff.x));
      const y = Math.max(5, Math.min(95, ((e.clientY - rect.top) / rect.height * 100) - dragOff.y));
      setLayouts(prev => {
        const cur: TableLayout = prev[dragging] || { x: 50, y: 50, shape: 'round' };
        const n = { ...prev, [dragging]: { ...cur, x, y } };
        persistLayouts(n); return n;
      });
    };
    const up = () => setDragging(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging, dragOff, persistLayouts]);

  // --- Area Drag ---
  const handleAreaGrab = (id: string, e: React.MouseEvent) => {
    if (editTab !== 'areas') return;
    e.preventDefault(); e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const saved = areaLayouts[id] || { x: 10, y: 10, width: 40, height: 30 };
    setDraggingArea(id);
    setDragAreaOff({ x: ((e.clientX - rect.left) / rect.width * 100) - saved.x, y: ((e.clientY - rect.top) / rect.height * 100) - saved.y });
  };

  useEffect(() => {
    if (!draggingArea) return;
    const move = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(-50, Math.min(150, ((e.clientX - rect.left) / rect.width * 100) - dragAreaOff.x));
      const y = Math.max(-50, Math.min(150, ((e.clientY - rect.top) / rect.height * 100) - dragAreaOff.y));
      setAreaLayouts(prev => {
        const cur: AreaLayout = prev[draggingArea] || { x: 10, y: 10, width: 40, height: 30 };
        const n = { ...prev, [draggingArea]: { ...cur, x, y } };
        persistAreaLayouts(n); return n;
      });
    };
    const up = () => setDraggingArea(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [draggingArea, dragAreaOff, persistAreaLayouts]);

  const toggleShape = (id: string) => {
    setLayouts(prev => {
      const cur: TableLayout = prev[id] || { x: 50, y: 50, shape: 'round' };
      const n = { ...prev, [id]: { ...cur, shape: cur.shape === 'round' ? 'rect' as const : 'round' as const } };
      persistLayouts(n); return n;
    });
  };

  const delTable = (id: string) => {
    const idx = tables.findIndex(t => t.id === id);
    if (onDeleteTable) onDeleteTable(id);
    showToast?.('Table deleted', 'info');
    setLayouts(prev => { const n = { ...prev }; delete n[id]; persistLayouts(n); return n; });
    setSelectedTableIds(prev => { const n = { ...prev }; delete n[id]; return n; });
    // Renumber all remaining tables sequentially
    const remaining = tables.filter(t => t.id !== id).sort((a, b) => a.number - b.number);
    remaining.forEach((t, i) => {
      const newNum = i + 1;
      if (t.number !== newNum && onUpdateTable) onUpdateTable(t.id, { number: newNum });
    });
  };

  const addTable = () => {
    if (!addForm.number || isNaN(Number(addForm.number))) { showToast?.('Enter a valid table number', 'warning'); return; }
    if (tables.some(t => t.number === Number(addForm.number))) { showToast?.('Table number already exists', 'warning'); return; }
    const area = addForm.area || areas[0]?.label || 'Main Hall';
    onAddTable?.({ number: Number(addForm.number), capacity: addForm.capacity, section: area, status: 'Available' });
    showToast?.(`Table ${addForm.number} added to ${area}`, 'success');
    setShowAddForm(false);
    setAddForm({ number: '', capacity: 4, area: areas[0]?.label || '', shape: 'round' });
  };

  const addArea = () => {
    if (!newAreaLabel.trim()) { showToast?.('Enter an area name', 'warning'); return; }
    if (areas.some(a => a.label.toLowerCase() === newAreaLabel.trim().toLowerCase())) { showToast?.('Area already exists', 'warning'); return; }
    setAreas(prev => [...prev, { id: `area_${Date.now()}`, label: newAreaLabel.trim(), colorIndex: prev.length % AREA_COLORS.length }]);
    setNewAreaLabel('');
    showToast?.(`Area "${newAreaLabel.trim()}" created`, 'success');
  };

  const deleteArea = (id: string) => {
    const area = areas.find(a => a.id === id);
    if (!area) return;
    if (tables.some(t => (t.section || 'Main Hall') === area.label)) {
      showToast?.('Remove all tables from this area first', 'warning'); return;
    }
    setAreas(prev => prev.filter(a => a.id !== id));
    showToast?.(`Area "${area.label}" deleted`, 'info');
  };

  const renameArea = (id: string) => {
    if (!editAreaLabel.trim()) { showToast?.('Enter a name', 'warning'); return; }
    setAreas(prev => prev.map(a => a.id === id ? { ...a, label: editAreaLabel.trim() } : a));
    setEditingAreaId(null);
    showToast?.('Area renamed', 'success');
  };

  const cycleColor = (id: string) => {
    setAreas(prev => prev.map(a => a.id === id ? { ...a, colorIndex: (a.colorIndex + 1) % AREA_COLORS.length } : a));
  };

  // --- Area Resize ---
  const handleResizeStart = (id: string, dir: string, e: React.MouseEvent) => {
    if (editTab !== 'areas') return;
    e.preventDefault(); e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cur = areaLayouts[id] || { x: 10, y: 10, width: 40, height: 30 };
    setResizing({ id, dir });
    resizeStart.current = { x: e.clientX, y: e.clientY, layout: { ...cur } };
  };

  useEffect(() => {
    if (!resizing) return;
    const { id, dir } = resizing;
    const start = resizeStart.current;
    if (!start) return;

    const move = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((e.clientX - start.x) / rect.width) * 100;
      const dy = ((e.clientY - start.y) / rect.height) * 100;

      setAreaLayouts(prev => {
        const cur: AreaLayout = prev[id] || { x: 10, y: 10, width: 40, height: 30 };
        let { x, y, width, height } = start.layout;

        if (dir.includes('e')) { width = Math.max(8, start.layout.width + dx); }
        if (dir.includes('w')) { const nw = Math.max(8, start.layout.width - dx); x = start.layout.x + (start.layout.width - nw); width = nw; }
        if (dir.includes('s')) { height = Math.max(10, start.layout.height + dy); }
        if (dir.includes('n')) { const nh = Math.max(10, start.layout.height - dy); y = start.layout.y + (start.layout.height - nh); height = nh; }

        x = Math.max(-50, Math.min(150, x));
        y = Math.max(-50, Math.min(150, y));

        const n = { ...prev, [id]: { x, y, width, height } };
        persistAreaLayouts(n); return n;
      });
    };

    const up = () => { setResizing(null); resizeStart.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [resizing, persistAreaLayouts]);

  // --- Table Resize (scale, not capacity) ---
  const handleTableResizeStart = (id: string, e: React.MouseEvent) => {
    if (editTab !== 'tables') return;
    e.preventDefault(); e.stopPropagation();
    const lay = layouts[id];
    if (!lay) return;
    setTableResizing(id);
    tableResizeStart.current = { x: e.clientX, y: e.clientY, cap: lay.scale || 1 };
  };

  useEffect(() => {
    if (!tableResizing) return;
    const id = tableResizing;
    const start = tableResizeStart.current;
    if (!start) return;

    const move = (e: MouseEvent) => {
      const dy = (e.clientY - start.y) / 40;
      const newScale = Math.max(0.4, Math.min(2.5, Math.round((start.cap + dy) * 10) / 10));
      setLayouts(prev => {
        const cur: TableLayout = prev[id] || { x: 50, y: 50, shape: 'round' };
        const n = { ...prev, [id]: { ...cur, scale: newScale } };
        persistLayouts(n); return n;
      });
    };

    const up = () => { setTableResizing(null); tableResizeStart.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [tableResizing, persistLayouts]);

  const updateTableNumber = (id: string) => {
    if (!editingTableNumVal || isNaN(Number(editingTableNumVal))) { showToast?.('Enter a valid number', 'warning'); return; }
    const num = Number(editingTableNumVal);
    if (tables.some(t => t.number === num && t.id !== id)) { showToast?.('Table number already exists', 'warning'); return; }
    if (onUpdateTable) onUpdateTable(id, { number: num });
    setEditingTableNum(null);
    showToast?.(`Table updated to #${num}`, 'success');
  };

  // Set default area for add form
  useEffect(() => { if (!addForm.area && areas.length > 0) setAddForm(f => ({ ...f, area: areas[0].label })); }, [areas]);

  // --- Canvas renderer ---
  const renderCanvas = (editable: boolean, mode?: 'areas' | 'tables') => (
    <div ref={canvasRef} className={`relative flex-1 min-h-[300px] md:min-h-[400px] overflow-hidden select-none rounded-xl ${editable ? 'border-2 border-dashed border-[#004ac6]/30 bg-white' : 'bg-[#f5f3ff]'}`}>
      {/* Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.12]"
        style={{ backgroundImage: 'linear-gradient(rgba(0,74,198,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,74,198,0.05) 1px, transparent 1px)', backgroundSize: '48px 48px' }}
      />

      {/* Section zones (colored zones only, no labels) */}
      {canvasSections.map(s => (
        <div key={s.id}
          className={`absolute rounded-xl border-2 ${s.border} ${s.bg} pointer-events-none transition-opacity opacity-40`}
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${Math.max(8, s.width)}%`, height: `${Math.max(10, s.height)}%` }}
        />
      ))}

      {/* Entrance */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <div className="flex flex-col items-center">
          <div className="w-14 h-0.5 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          <div className="mt-1 text-[7px] text-gray-400 font-bold uppercase tracking-[0.3em]">Entrance</div>
        </div>
      </div>

      {/* Tables (only in view mode or tables tab) */}
      {mode !== 'areas' && tables.map(table => {
        const lay = layouts[table.id];
        if (!lay) return null;
        const order = getOrder(table);
        const st = STATUS_STYLES[table.status] || STATUS_STYLES['Available'];
        const avail = table.status === 'Available';
        const sz = getTableSize(table.capacity, lay.scale || 1);
        const isDrag = dragging === table.id;
        const urgent = table.priority === 'urgent';
        const inEdit = editable && mode === 'tables';

        return (
          <div key={table.id}
            onClick={() => { if (editable) return; if (avail) onCreateOrder('Dine In', table.id); else if (order) onOpenBilling(order); }}
            onMouseDown={(e) => inEdit && handleGrab(table.id, e)}
            className={`absolute group ${inEdit ? 'cursor-grab' : 'cursor-pointer'} ${isDrag ? 'z-50 cursor-grabbing' : 'hover:z-20'}`}
            style={{
              left: `${lay.x}%`, top: `${lay.y}%`,
              transform: 'translate(-50%, -50%)',
              transition: isDrag ? 'none' : 'left 0.15s, top 0.15s',
            }}
          >
            {/* Edit controls (tables tab) */}
            {inEdit && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); toggleShape(table.id); }}
                  className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-gray-100 transition-all cursor-pointer border border-gray-200"
                  title="Toggle round/rect"
                >{lay.shape === 'round' ? <Square className="w-2.5 h-2.5 text-purple-600" /> : <Circle className="w-2.5 h-2.5 text-purple-600" />}</button>
                <button onClick={(e) => { e.stopPropagation(); delTable(table.id); }}
                  className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-red-500 hover:text-white transition-all cursor-pointer border border-gray-200"
                  title="Delete table"
                ><Trash2 className="w-2.5 h-2.5 text-red-500" /></button>
              </div>
            )}

            {/* Urgent badge (view) */}
            {urgent && !editable && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <span className="flex items-center gap-0.5 bg-red-500 text-white text-[6px] font-bold px-1.5 py-0.5 rounded-full animate-pulse shadow">
                  <AlertCircle className="w-2 h-2" /> URGENT
                </span>
              </div>
            )}

            {/* Table circle */}
            <div className={`relative flex flex-col items-center justify-center bg-white shadow-md transition-all
              ${lay.shape === 'rect' ? 'rounded-xl' : 'rounded-full'}
              ring-2 ${st.ring}
              ${avail && !editable ? 'hover:shadow-xl hover:scale-110 hover:ring-emerald-400' : ''}
              ${!avail && !editable ? 'hover:shadow-xl hover:scale-110' : ''}
              ${isDrag ? 'shadow-2xl scale-110 ring-[#004ac6]' : ''}
              ${urgent && !editable ? 'ring-red-400 animate-pulse' : ''}
              ${inEdit ? 'hover:ring-[#004ac6]' : ''}
            `} style={{ width: sz.w, height: sz.h }}>
              <span className={`${sz.fs} font-black leading-none ${avail ? 'text-emerald-700' : 'text-gray-800'}`}>{table.number}</span>
              <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white shadow-sm ${st.dot}`} />
            </div>

            {/* View-only overlays */}
            {!editable && !avail && (
              <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                <div className="bg-gray-900 text-white text-[7px] rounded-lg px-2 py-1 shadow-lg border border-gray-700 whitespace-nowrap">
                  {table.orderSince && <div className="flex items-center gap-1"><Clock className="w-2 h-2 text-gray-400" /><span>{getElapsedTime(table.orderSince)}</span></div>}
                  {order && order.grandTotal > 0 && <div className="font-bold text-emerald-400">{settings.currencySymbol || '₹'}{order.grandTotal.toFixed(2)}</div>}
                  {order?.status && <div className="text-gray-400">{order.status}</div>}
                </div>
              </div>
            )}
            {!editable && !avail && order && (
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 z-20 pointer-events-none">
                <button onClick={(e) => { e.stopPropagation(); onOpenReceiptPreview(order); }} className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center hover:scale-110 transition-all cursor-pointer pointer-events-auto"><Eye className="w-2.5 h-2.5 text-blue-600" /></button>
                <button onClick={(e) => { e.stopPropagation(); onOpenBilling(order); }} className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center hover:scale-110 transition-all cursor-pointer pointer-events-auto"><Receipt className="w-2.5 h-2.5 text-orange-600" /></button>
              </div>
            )}
            {!editable && avail && (
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[6px] font-bold text-emerald-500">Tap to seat</span>
              </div>
            )}
          </div>
        );
      })}

      {tables.length === 0 && mode !== 'areas' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400">
            <UtensilsCrossed className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="font-bold text-gray-400 text-xs">No tables yet</p>
            <p className="text-[9px] mt-0.5">Go to Tables tab to add them</p>
          </div>
        </div>
      )}

      {areas.length === 0 && mode === 'areas' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400">
            <Layers className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="font-bold text-gray-400 text-xs">No areas defined</p>
            <p className="text-[9px] mt-0.5">Add your first area below</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {isFullscreen && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setIsFullscreen(false)} />}

      {/* ========= VIEW MODE ========= */}
      <div className={`flex flex-col bg-white rounded-2xl overflow-hidden border border-[#e1e2ed] shadow-sm ${isFullscreen ? 'fixed inset-4 z-50' : ''}`}>
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-[#e1e2ed] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#004ac6]/10 flex items-center justify-center"><MapPin className="w-3.5 h-3.5 text-[#004ac6]" /></div>
            <h3 className="text-sm font-bold text-[#191b23]">Restaurant Floor Plan</h3>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1 text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{tables.length - occupied} Free</span>
              <span className="flex items-center gap-1 text-orange-600"><span className="w-2 h-2 rounded-full bg-orange-500" />{occupied} Occupied</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setEditOpen(true); setEditTab('areas'); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#004ac6] text-white rounded-lg text-[10px] font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm"
            ><Pencil className="w-3 h-3" /> Edit Floor Plan</button>
            <button onClick={() => setIsFullscreen(v => !v)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#191b23] hover:bg-gray-100 transition-all cursor-pointer">{isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
          </div>
        </div>

        {renderCanvas(false)}
      </div>

      {/* ========= EDIT MODAL ========= */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[95vw] max-w-6xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#e1e2ed] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#004ac6] flex items-center justify-center"><Pencil className="w-4 h-4 text-white" /></div>
                <div>
                  <h3 className="text-sm font-bold text-[#191b23]">Edit Floor Plan</h3>
                  <p className="text-[10px] text-gray-500">Step 1: Set up areas · Step 2: Place tables</p>
                </div>
              </div>
              <button onClick={() => setEditOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-[#e1e2ed] shrink-0">
              <button onClick={() => setEditTab('areas')}
                className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${editTab === 'areas' ? 'border-[#004ac6] text-[#004ac6]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              ><Layers className="w-4 h-4" /> 1. Areas</button>
              <button onClick={() => { if (areas.length === 0) { showToast?.('Create at least one area first', 'warning'); return; } setEditTab('tables'); }}
                className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${editTab === 'tables' ? 'border-[#004ac6] text-[#004ac6]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              ><Table className="w-4 h-4" /> 2. Tables</button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Left: Canvas */}
              <div className="flex-1 p-4 bg-[#faf8ff] flex flex-col min-w-0">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    {editTab === 'areas' ? (
                      <><Layers className="w-3 h-3 text-[#004ac6]" /><span>Drag to move · Drag edge/corner handles to resize</span></>
                    ) : (
                      <><Move className="w-3 h-3 text-[#004ac6]" /><span>Select a table from right panel to edit · Drag to move · SE handle to scale</span></>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-auto relative">
                  {/* Canvas inner */}
                  <div className="border-2 border-dashed border-[#004ac6]/20 rounded-xl bg-white select-none"
                    style={{ minHeight: '1200px', height: 'auto' }}
                  >
                    <div className="absolute inset-0 pointer-events-none opacity-[0.1]"
                      style={{ backgroundImage: 'linear-gradient(rgba(0,74,198,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,74,198,0.05) 1px, transparent 1px)', backgroundSize: '48px 48px' }}
                    />
                    {canvasSections.map(s => {
                      const isAreaDrag = draggingArea === s.id;
                      const isResize = resizing?.id === s.id;
                      const handleClass = editTab === 'areas' ? 'absolute z-20 w-3 h-3 bg-white border-2 border-[#004ac6] rounded-sm opacity-0 group-hover:opacity-100 hover:opacity-100 hover:bg-[#004ac6] hover:border-[#004ac6] transition-all cursor-pointer' : 'hidden';
                      return (
                      <div key={s.id}
                        onMouseDown={(e) => handleAreaGrab(s.id, e)}
                        className={`absolute rounded-xl border-2 ${s.border} ${s.bg} ${editTab === 'areas' ? 'cursor-grab group ring-2 ring-[#004ac6]/10 hover:ring-[#004ac6]/40' : 'pointer-events-none'} ${isAreaDrag ? 'cursor-grabbing z-50 shadow-xl ring-[#004ac6]' : ''} ${isResize ? 'z-50 ring-[#004ac6]' : ''}`}
                        style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${Math.max(8, s.width)}%`, height: `${Math.max(10, s.height)}%` }}
                      >
                        {editTab === 'areas' && (
                          <>
                            {/* 8 resize handles */}
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'n', e); }} className={`${handleClass} -top-1.5 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 's', e); }} className={`${handleClass} -bottom-1.5 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'w', e); }} className={`${handleClass} top-1/2 -left-1.5 -translate-x-1/2 -translate-y-1/2 cursor-w-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'e', e); }} className={`${handleClass} top-1/2 -right-1.5 translate-x-1/2 -translate-y-1/2 cursor-e-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'nw', e); }} className={`${handleClass} -top-1.5 -left-1.5 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'ne', e); }} className={`${handleClass} -top-1.5 -right-1.5 translate-x-1/2 -translate-y-1/2 cursor-ne-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'sw', e); }} className={`${handleClass} -bottom-1.5 -left-1.5 -translate-x-1/2 translate-y-1/2 cursor-sw-resize`} />
                            <div onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'se', e); }} className={`${handleClass} -bottom-1.5 -right-1.5 translate-x-1/2 translate-y-1/2 cursor-se-resize`} />

                            {/* Move icon on hover */}
                            <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
                              <div className={`w-5 h-5 rounded-full bg-white/90 shadow-sm flex items-center justify-center ${isAreaDrag ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                <Move className="w-2.5 h-2.5 text-gray-500" />
                              </div>
                            </div>
                          </>
                        )}
                        <div className={`absolute top-1 left-2 text-[8px] font-bold uppercase tracking-wider ${editTab === 'areas' ? '' : 'pointer-events-none'} ${s.text}`}>
                          {s.label} <span className="text-gray-400 font-normal normal-case">({s.tableIds.length})</span>
                          {editTab === 'areas' && (
                            <span className="text-gray-300 font-normal normal-case ml-1">[{Math.round(s.width)}×{Math.round(s.height)}]</span>
                          )}
                        </div>
                      </div>
                      );
                    })}

                    {/* Tables in edit mode (only selected ones) */}
                    {editTab === 'tables' && tables.filter(t => selectedTableIds[t.id]).map(table => {
                      const lay = layouts[table.id];
                      if (!lay) return null;
                      const sz = getTableSize(table.capacity, lay.scale || 1);
                      const isDrag = dragging === table.id;
                      const isResizing = tableResizing === table.id;
                      const avail = table.status === 'Available';
                      const st = STATUS_STYLES[table.status] || STATUS_STYLES['Available'];
                      const isEditingNum = editingTableNum === table.id;
                      return (
                        <div key={table.id}
                          onMouseDown={(e) => handleGrab(table.id, e)}
                          className={`absolute group ${isDrag ? 'z-50 cursor-grabbing' : 'hover:z-20'} ${isResizing ? 'z-50' : ''}`}
                          style={{ left: `${lay.x}%`, top: `${lay.y}%`, transform: 'translate(-50%, -50%)', transition: isDrag || isResizing ? 'none' : 'left 0.12s, top 0.12s' }}
                        >
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            <button onClick={(e) => { e.stopPropagation(); toggleShape(table.id); }}
                              className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-gray-100 transition-all cursor-pointer border border-gray-200"
                              title="Toggle round/rect"
                            >{lay.shape === 'round' ? <Square className="w-2.5 h-2.5 text-purple-600" /> : <Circle className="w-2.5 h-2.5 text-purple-600" />}</button>
                            <button onClick={(e) => { e.stopPropagation(); delTable(table.id); }}
                              className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-red-500 hover:text-white transition-all cursor-pointer border border-gray-200"
                              title="Delete table"
                            ><Trash2 className="w-2.5 h-2.5 text-red-500" /></button>
                          </div>
                          <div className={`relative flex flex-col items-center justify-center bg-white shadow-md transition-all
                            ${lay.shape === 'rect' ? 'rounded-xl' : 'rounded-full'}
                            ring-2 ${st.ring} hover:ring-[#004ac6]
                            ${isDrag ? 'shadow-2xl scale-110 ring-[#004ac6]' : ''}
                            ${isResizing ? 'ring-[#004ac6] shadow-xl' : ''}
                          `} style={{ width: sz.w, height: sz.h }}>
                            <span className={`${sz.fs} font-black leading-none cursor-pointer text-gray-800`}
                              onDoubleClick={() => { setEditingTableNum(table.id); setEditingTableNumVal(String(table.number)); }}
                            >{table.number}</span>
                            <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white shadow-sm ${st.dot}`} />
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[6px] font-bold text-gray-400 whitespace-nowrap">
                              Cap. {table.capacity} · {((lay.scale || 1) * 100).toFixed(0)}%
                            </div>
                          </div>
                          <div onMouseDown={(e) => handleTableResizeStart(table.id, e)}
                            className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-[#004ac6] rounded-sm opacity-0 group-hover:opacity-100 hover:opacity-100 hover:bg-[#004ac6] transition-all cursor-se-resize z-30 shadow-sm"
                            title="Drag to scale table size"
                          />
                        </div>
                      );
                    })}
                    {editTab === 'tables' && Object.keys(selectedTableIds).length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center text-gray-400">
                          <Table className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          <p className="font-bold text-gray-400 text-xs">No tables selected</p>
                          <p className="text-[9px] mt-0.5">Click a table in the right panel to show it here</p>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>

              {/* Right panel */}
              <div className="w-72 border-l border-[#e1e2ed] flex flex-col bg-gray-50/50">
                {editTab === 'areas' ? (
                  <>
                    <div className="p-3 border-b border-[#e1e2ed]">
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Areas / Zones</p>
                      <div className="flex gap-1.5">
                        <input type="text" placeholder="New area name..." value={newAreaLabel} onChange={e => setNewAreaLabel(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addArea()}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#e1e2ed] text-[10px] font-medium focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 bg-white" />
                        <button onClick={addArea} className="px-2.5 py-1.5 bg-[#004ac6] text-white rounded-lg text-[10px] font-bold hover:bg-[#003ea8] transition-all cursor-pointer"><Plus className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                      {areas.map(area => {
                        const pal = AREA_COLORS[area.colorIndex % AREA_COLORS.length];
                        const isEditing = editingAreaId === area.id;
                        const tableCount = tables.filter(t => (t.section || 'Main Hall') === area.label).length;
                        return (
                          <div key={area.id} className="bg-white rounded-lg border border-[#e1e2ed] p-2.5 hover:border-[#004ac6]/30 transition-all">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input type="text" value={editAreaLabel} onChange={e => setEditAreaLabel(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') renameArea(area.id); if (e.key === 'Escape') setEditingAreaId(null); }}
                                  className="flex-1 px-2 py-1 rounded border border-[#004ac6] text-[10px] font-semibold focus:outline-none" autoFocus />
                                <button onClick={() => renameArea(area.id)} className="text-emerald-600 hover:text-emerald-700 cursor-pointer"><CheckCircle className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setEditingAreaId(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`w-3 h-3 rounded ${pal.bg} border ${pal.border} shrink-0`} />
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-bold text-[#191b23] truncate">{area.label}</p>
                                    <p className="text-[8px] text-gray-400">{tableCount} table{tableCount !== 1 ? 's' : ''}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => { setEditingAreaId(area.id); setEditAreaLabel(area.label); }}
                                    className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 transition-all cursor-pointer"
                                  ><Edit3 className="w-3 h-3" /></button>
                                  <button onClick={() => cycleColor(area.id)}
                                    className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-all cursor-pointer"
                                    title="Change color"
                                  ><Palette className="w-3 h-3" /></button>
                                  <button onClick={() => deleteArea(area.id)}
                                    className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                                  ><Trash2 className="w-3 h-3" /></button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {areas.length === 0 && <p className="text-center py-6 text-[10px] text-gray-400">No areas yet. Add one above.</p>}
                    </div>
                    <div className="p-3 border-t border-[#e1e2ed] text-[10px] text-gray-500 text-center">{areas.length} area{areas.length !== 1 ? 's' : ''} · Drag zone body to move, handles to resize</div>
                  </>
                ) : (
                  <>
                    <div className="p-3 border-b border-[#e1e2ed]">
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <input type="text" placeholder="Search tables..." value={editSearch} onChange={e => setEditSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#e1e2ed] text-[10px] font-medium focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 bg-white" />
                      </div>
                      <button onClick={() => { if (areas.length === 0) { showToast?.('Create areas first', 'warning'); return; } setShowAddForm(true); }}
                        className="w-full py-2 bg-[#004ac6] text-white rounded-lg text-[10px] font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
                      ><Plus className="w-3 h-3" /> Add Table</button>
                    </div>

                    {showAddForm && (
                      <div className="p-3 border-b border-[#e1e2ed] bg-white">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] font-bold text-[#191b23]">New Table</p>
                          <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[7px] font-bold text-gray-500 uppercase block mb-0.5">Number</label>
                            <input type="number" value={addForm.number} onChange={e => setAddForm({ ...addForm, number: e.target.value })}
                              className="w-full px-2 py-1.5 rounded-lg border border-[#e1e2ed] text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30" placeholder="e.g. 25" />
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="text-[7px] font-bold text-gray-500 uppercase block mb-0.5">Capacity</label>
                              <input type="number" value={addForm.capacity} onChange={e => setAddForm({ ...addForm, capacity: Math.max(1, Number(e.target.value)) })}
                                className="w-full px-2 py-1.5 rounded-lg border border-[#e1e2ed] text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30" />
                            </div>
                            <div className="flex-1">
                              <label className="text-[7px] font-bold text-gray-500 uppercase block mb-0.5">Shape</label>
                              <div className="flex gap-1">
                                <button onClick={() => setAddForm({ ...addForm, shape: 'round' })}
                                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${addForm.shape === 'round' ? 'bg-[#004ac6] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                ><Circle className="w-2.5 h-2.5" />R</button>
                                <button onClick={() => setAddForm({ ...addForm, shape: 'rect' })}
                                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${addForm.shape === 'rect' ? 'bg-[#004ac6] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                ><Square className="w-2.5 h-2.5" />D</button>
                              </div>
                            </div>
                          </div>
                          <div>
                            <label className="text-[7px] font-bold text-gray-500 uppercase block mb-0.5">Place in Area</label>
                            <select value={addForm.area} onChange={e => setAddForm({ ...addForm, area: e.target.value })}
                              className="w-full px-2 py-1.5 rounded-lg border border-[#e1e2ed] text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 bg-white">
                              {areas.map(a => <option key={a.id}>{a.label}</option>)}
                            </select>
                          </div>
                          <button onClick={addTable} className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-sm">+ Add Table</button>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                      {areas.map(area => {
                        const pal = AREA_COLORS[area.colorIndex % AREA_COLORS.length];
                        const areaTables = tables.filter(t => (t.section || 'Main Hall') === area.label)
                          .filter(t => !editSearch || String(t.number).includes(editSearch));
                        if (areaTables.length === 0 && editSearch) return null;
                        return (
                          <div key={area.id}>
                            <div className="flex items-center gap-1.5 mb-1 px-0.5">
                              <span className={`w-2 h-2 rounded ${pal.bg} border ${pal.border}`} />
                              <span className={`text-[9px] font-bold ${pal.text}`}>{area.label}</span>
                              <span className="text-[8px] text-gray-400">({tables.filter(t => (t.section || 'Main Hall') === area.label).length})</span>
                            </div>
                            {areaTables.map(table => {
                              const lay = layouts[table.id];
                              const isEditingNum = editingTableNum === table.id;
                              const isSelected = !!selectedTableIds[table.id];
                              return (
                                <div key={table.id}
                                  onClick={() => setSelectedTableIds(prev => ({ ...prev, [table.id]: !prev[table.id] }))}
                                  className={`flex items-center justify-between bg-white rounded-lg border p-2 mb-1 transition-all cursor-pointer
                                    ${isSelected ? 'border-[#004ac6] ring-1 ring-[#004ac6]/20 bg-blue-50/30' : 'border-[#e1e2ed] hover:border-[#004ac6]/30'}`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0
                                      ${isSelected ? 'bg-[#004ac6] text-white' : table.status === 'Available' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                                      {isEditingNum ? (
                                        <input type="number" value={editingTableNumVal}
                                          onChange={e => setEditingTableNumVal(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') updateTableNumber(table.id); if (e.key === 'Escape') setEditingTableNum(null); }}
                                          onBlur={() => updateTableNumber(table.id)}
                                          className="w-7 text-center font-black bg-transparent border-b border-white outline-none text-[10px] text-white" autoFocus
                                          onClick={e => e.stopPropagation()}
                                        />
                                      ) : (
                                        <span onClick={(e) => { e.stopPropagation(); setEditingTableNum(table.id); setEditingTableNumVal(String(table.number)); }}
                                          className="cursor-pointer"
                                        >T{table.number}</span>
                                      )}
                                    </div>
                                    <div className="min-w-0" onClick={e => e.stopPropagation()}>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-bold text-[#191b23]">{table.capacity}</span>
                                        <button onClick={(e) => { e.stopPropagation(); if (onUpdateTable) onUpdateTable(table.id, { capacity: Math.max(1, table.capacity - 1) }); }}
                                          className="w-4 h-4 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                                        ><span className="text-[10px] font-bold leading-none">−</span></button>
                                        <button onClick={(e) => { e.stopPropagation(); if (onUpdateTable) onUpdateTable(table.id, { capacity: Math.min(12, table.capacity + 1) }); }}
                                          className="w-4 h-4 rounded flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all cursor-pointer"
                                        ><span className="text-[10px] font-bold leading-none">+</span></button>
                                      </div>
                                      <p className="text-[7px] text-gray-400">{lay?.shape === 'rect' ? 'Rectangle' : 'Round'}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                                    <button onClick={() => toggleShape(table.id)}
                                      className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-all cursor-pointer"
                                      title="Toggle shape"
                                    >{lay?.shape === 'round' ? <Square className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}</button>
                                    <button onClick={() => delTable(table.id)}
                                      className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                                      title="Delete"
                                    ><Trash2 className="w-2.5 h-2.5" /></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {tables.length === 0 && <p className="text-center py-6 text-[10px] text-gray-400">No tables. Click "Add Table".</p>}
                    </div>
                    <div className="p-3 border-t border-[#e1e2ed] text-[10px] text-gray-500 text-center">{tables.length} table{tables.length !== 1 ? 's' : ''} · Click to show/hide on canvas · Click number to rename</div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#e1e2ed] bg-gray-50/50 shrink-0">
              <span className="text-[10px] text-gray-400">
                {editTab === 'areas' ? 'Move zones by dragging their body · Resize by dragging edge/corner handles' : 'Click table in right panel to show on canvas · Drag to reposition · SE handle to scale'}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => { saveJSON(LAYOUT_KEY, layouts); showToast?.('Layout saved', 'success'); }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
                ><Save className="w-3.5 h-3.5" /> Save</button>
                <button onClick={() => setEditOpen(false)}
                  className="px-4 py-2 border border-[#e1e2ed] rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
                >Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
