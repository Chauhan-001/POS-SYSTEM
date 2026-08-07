import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Clock, AlertCircle, Eye, Receipt, CheckCircle, Timer,
  UtensilsCrossed, MapPin, Maximize2, Minimize2,
  Pencil, Plus, Trash2, X, Save, Square, Circle, Move,
  Table, Search, Edit3, Palette, Layers, RotateCcw, Magnet
} from 'lucide-react';
import type { TableInfo, Order } from '../src/types';
import { useCurrentTime } from '../src/hooks/useCurrentTime';

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

interface TableLayout {
  x: number;
  y: number;
  shape: 'round' | 'rect';
  /** Legacy uniform scale (1 = default). Still read for backward compatibility. */
  scale?: number;
  /** True width as % of canvas width (replaces scale-based sizing). */
  w?: number;
  /** True height as % of canvas height. Round tables ignore this (kept square). */
  h?: number;
}

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
const ENTRANCE_POS_KEY = 'pos_floor_entrance_pos';

/** Snap increment in % for positions/sizes (2% ≈ 1/50th of the canvas). */
const SNAP = 2;
/** Minimum table size in % so a table never shrinks to nothing. */
const MIN_TABLE_PCT = 3;
/** Maximum table size in % so tables can't cover the whole floor. */
const MAX_TABLE_PCT = 24;

function getElapsedTime(c?: string, now?: Date): string {
  if (!c) return '';
  const current = now ?? new Date();
  const d = Math.floor((current.getTime() - new Date(c).getTime()) / 60000);
  if (d < 1) return 'Just now';
  if (d < 60) return `${d}m`;
  return `${Math.floor(d / 60)}h ${d % 60}m`;
}

/**
 * Default table size in % of the canvas, based on seating capacity.
 * Mirrors the old px-based sizing so existing floors look the same.
 */
function defaultTablePct(cap: number): number {
  if (cap >= 8) return 8;
  if (cap >= 6) return 7;
  return 6;
}

/**
 * Resolve a table layout to concrete pixel size + font size for a canvas.
 * Falls back to the legacy `scale` field when the new w/h sizes are absent.
 */
function getTableSize(
  cap: number,
  lay: TableLayout | undefined,
  canvas: { w: number; h: number },
): { w: number; h: number; fs: string } {
  const cw = Math.max(canvas.w, 1);
  const ch = Math.max(canvas.h, 1);
  const basePct = defaultTablePct(cap);
  const shape = lay?.shape ?? 'round';
  const scale = lay?.scale ?? 1;
  const wPct = lay?.w ?? basePct * scale;
  const hPct = shape === 'rect' ? (lay?.h ?? basePct * 0.72 * scale) : wPct;
  const w = (wPct / 100) * cw;
  const h = shape === 'rect' ? (hPct / 100) * ch : w; // round stays a true circle
  const fs = w >= 72 ? 'text-lg' : w >= 48 ? 'text-base' : 'text-sm';
  return { w: Math.round(w), h: Math.round(h), fs };
}

/** Round a value to the grid snap (multiples of SNAP). */
function snap(v: number, on: boolean): number {
  if (!on) return Math.round(v * 10) / 10;
  return Math.round(v / SNAP) * SNAP;
}

function loadJSON<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function saveJSON(key: string, val: any) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/** Track an element's size via ResizeObserver (used for canvas-consistent math). */
function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

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
  const [tableResizing, setTableResizing] = useState<{ id: string; dir: string } | null>(null);
  const tableResizeStart = useRef<{ x: number; y: number; layout: { x: number; y: number; shape: 'round' | 'rect'; w: number; h: number } } | null>(null);
  const [editingTableNum, setEditingTableNum] = useState<string | null>(null);
  const [editingTableNumVal, setEditingTableNumVal] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<Record<string, boolean>>({});
  const [addForm, setAddForm] = useState({ number: '', capacity: 4, area: '', shape: 'round' as 'round' | 'rect' });
  const [editSearch, setEditSearch] = useState('');
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editAreaLabel, setEditAreaLabel] = useState('');
  const [newAreaLabel, setNewAreaLabel] = useState('');
  const [entrancePos, setEntrancePos] = useState<{ x: number; y: number }>(() => loadJSON(ENTRANCE_POS_KEY, { x: 50, y: 50 }));
  const [draggingEntrance, setDraggingEntrance] = useState(false);
  const [dragEntranceOff, setDragEntranceOff] = useState({ x: 0, y: 0 });
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => loadJSON('pos_floor_snap', true));
  const viewCanvasRef = useRef<HTMLDivElement>(null);
  const editCanvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  // Pending position/shape for a table that's about to be created (quick-add / add form).
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const pendingShapeRef = useRef<'round' | 'rect'>('round');
  // True once a drag has actually moved (so the trailing click doesn't toggle selection).
  const dragMovedRef = useRef(false);

  const viewSize = useElementSize(viewCanvasRef);
  const editSize = useElementSize(editCanvasRef);
  // Live clock — re-renders the canvas each second so occupancy timers tick.
  const now = useCurrentTime();

  useEffect(() => { saveJSON('pos_floor_snap', snapEnabled); }, [snapEnabled]);

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
    for (const id of Object.keys(next)) {
      if (!layouts[id]) {
        if (pendingPosRef.current) {
          next[id] = { ...next[id], x: pendingPosRef.current.x, y: pendingPosRef.current.y, shape: pendingShapeRef.current };
          pendingPosRef.current = null;
        }
        changed = true;
      }
    }
    if (changed) { setLayouts(next); persistLayouts(next); }
  }, [tables, areas]);

  // Save areas on change
  useEffect(() => { saveJSON(AREAS_KEY, areas); }, [areas]);
  // Save entrance position (debounced, like area/table layouts)
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveJSON(ENTRANCE_POS_KEY, entrancePos), 300);
  }, [entrancePos]);

  // Match by the order's tableId OR by the table.orderId (which mirrors the real
  // order id) so the live order is always found after KOT even if the tableId
  // linkage drifts (e.g. server id swap).
  const getOrder = (tbl: TableInfo) => orders.find(o =>
    (o.tableId === tbl.id || (tbl.orderId && o.id === tbl.orderId)) &&
    !['Closed', 'Cancelled', 'Paid'].includes(o.status)
  );
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

  // --- Table Drag (pointer events → works with mouse AND touch) ---
  const handleGrab = (id: string, e: React.PointerEvent) => {
    if (editTab !== 'tables') return;
    e.preventDefault(); e.stopPropagation();
    const rect = editCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const lay = layouts[id] || { x: 50, y: 50, shape: 'round' as const };
    setDragging(id);
    setDragOff({ x: ((e.clientX - rect.left) / rect.width * 100) - lay.x, y: ((e.clientY - rect.top) / rect.height * 100) - lay.y });
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const rect = editCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragMovedRef.current = true;
      const rawX = ((e.clientX - rect.left) / rect.width * 100) - dragOff.x;
      const rawY = ((e.clientY - rect.top) / rect.height * 100) - dragOff.y;
      const x = snap(Math.max(0, Math.min(100, rawX)), snapEnabled);
      const y = snap(Math.max(0, Math.min(100, rawY)), snapEnabled);
      setLayouts(prev => {
        const cur: TableLayout = prev[dragging] || { x: 50, y: 50, shape: 'round' };
        const n = { ...prev, [dragging]: { ...cur, x, y } };
        persistLayouts(n); return n;
      });
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging, dragOff, persistLayouts, snapEnabled]);

  // --- Area Drag ---
  const handleAreaGrab = (id: string, e: React.PointerEvent) => {
    if (editTab !== 'areas') return;
    e.preventDefault(); e.stopPropagation();
    const rect = editCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const saved = areaLayouts[id] || { x: 10, y: 10, width: 40, height: 30 };
    setDraggingArea(id);
    setDragAreaOff({ x: ((e.clientX - rect.left) / rect.width * 100) - saved.x, y: ((e.clientY - rect.top) / rect.height * 100) - saved.y });
  };

  useEffect(() => {
    if (!draggingArea) return;
    const move = (e: PointerEvent) => {
      const rect = editCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rawX = ((e.clientX - rect.left) / rect.width * 100) - dragAreaOff.x;
      const rawY = ((e.clientY - rect.top) / rect.height * 100) - dragAreaOff.y;
      const x = snap(Math.max(-50, Math.min(150, rawX)), snapEnabled);
      const y = snap(Math.max(-50, Math.min(150, rawY)), snapEnabled);
      setAreaLayouts(prev => {
        const cur: AreaLayout = prev[draggingArea] || { x: 10, y: 10, width: 40, height: 30 };
        const n = { ...prev, [draggingArea]: { ...cur, x, y } };
        persistAreaLayouts(n); return n;
      });
    };
    const up = () => setDraggingArea(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [draggingArea, dragAreaOff, persistAreaLayouts, snapEnabled]);

  // --- Entrance Drag ---
  const handleEntranceGrab = (e: React.PointerEvent) => {
    if (editTab !== 'areas') return;
    e.preventDefault(); e.stopPropagation();
    const rect = editCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = entrancePos;
    setDraggingEntrance(true);
    setDragEntranceOff({ x: ((e.clientX - rect.left) / rect.width * 100) - pos.x, y: ((e.clientY - rect.top) / rect.height * 100) - pos.y });
  };

  useEffect(() => {
    if (!draggingEntrance) return;
    const move = (e: PointerEvent) => {
      const rect = editCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rawX = ((e.clientX - rect.left) / rect.width * 100) - dragEntranceOff.x;
      const rawY = ((e.clientY - rect.top) / rect.height * 100) - dragEntranceOff.y;
      const x = snap(Math.max(2, Math.min(98, rawX)), snapEnabled);
      const y = snap(Math.max(5, Math.min(95, rawY)), snapEnabled);
      setEntrancePos({ x, y });
    };
    const up = () => setDraggingEntrance(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [draggingEntrance, dragEntranceOff, snapEnabled]);

  const toggleShape = (id: string) => {
    setLayouts(prev => {
      const cur: TableLayout = prev[id] || { x: 50, y: 50, shape: 'round' };
      const shape = cur.shape === 'round' ? 'rect' as const : 'round' as const;
      // When switching to round, collapse h to match w so it renders as a circle.
      const n = { ...prev, [id]: { ...cur, shape, h: shape === 'round' ? undefined : (cur.h ?? (cur.w ?? defaultTablePct(4)) * 0.72) } };
      persistLayouts(n); return n;
    });
  };

  /** Reset a table to its default size (based on its capacity). */
  const resetTableSize = (id: string) => {
    const cap = tables.find(t => t.id === id)?.capacity ?? 4;
    setLayouts(prev => {
      const cur: TableLayout = prev[id] || { x: 50, y: 50, shape: 'round' };
      const n = { ...prev, [id]: { ...cur, w: defaultTablePct(cap), h: cur.shape === 'rect' ? defaultTablePct(cap) * 0.72 : undefined, scale: 1 } };
      persistLayouts(n); return n;
    });
  };

  const delTable = (id: string) => {
    const table = tables.find(t => t.id === id);
    if (onDeleteTable) onDeleteTable(id);
    showToast?.(`Table ${table ? '#' + table.number + ' ' : ''}deleted — other table numbers unchanged`, 'info');
    setLayouts(prev => { const n = { ...prev }; delete n[id]; persistLayouts(n); return n; });
    setSelectedTableIds(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const addTable = () => {
    if (!addForm.number || isNaN(Number(addForm.number))) { showToast?.('Enter a valid table number', 'warning'); return; }
    if (tables.some(t => t.number === Number(addForm.number))) { showToast?.('Table number already exists', 'warning'); return; }
    const area = addForm.area || areas[0]?.label || 'Main Hall';
    onAddTable?.({ number: Number(addForm.number), capacity: addForm.capacity, section: area, status: 'Available' });
    // The new table's layout will be created by the auto-position effect; capture
    // the chosen shape so it's respected from the start.
    pendingShapeRef.current = addForm.shape;
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
  const handleResizeStart = (id: string, dir: string, e: React.PointerEvent) => {
    if (editTab !== 'areas') return;
    e.preventDefault(); e.stopPropagation();
    const rect = editCanvasRef.current?.getBoundingClientRect();
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

    const move = (e: PointerEvent) => {
      const rect = editCanvasRef.current?.getBoundingClientRect();
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

        x = Math.max(-50, Math.min(150, snap(x, snapEnabled)));
        y = Math.max(-50, Math.min(150, snap(y, snapEnabled)));
        width = snap(Math.max(8, Math.min(200, width)), snapEnabled);
        height = snap(Math.max(10, Math.min(200, height)), snapEnabled);

        const n = { ...prev, [id]: { x, y, width, height } };
        persistAreaLayouts(n); return n;
      });
    };

    const up = () => { setResizing(null); resizeStart.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [resizing, persistAreaLayouts, snapEnabled]);

  // --- Table Resize (true width/height, 8-direction) ---
  const handleTableResizeStart = (id: string, dir: string, e: React.PointerEvent) => {
    if (editTab !== 'tables') return;
    e.preventDefault(); e.stopPropagation();
    const rect = editCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cap = tables.find(t => t.id === id)?.capacity ?? 4;
    const lay = layouts[id] || { x: 50, y: 50, shape: 'round' as const };
    const basePct = defaultTablePct(cap);
    const scale = lay.scale ?? 1;
    const shape = lay.shape ?? 'round';
    const w = lay.w ?? basePct * scale;
    const h = shape === 'rect' ? (lay.h ?? basePct * 0.72 * scale) : w;
    setTableResizing({ id, dir });
    tableResizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      layout: { x: lay.x, y: lay.y, shape, w, h },
    };
  };

  useEffect(() => {
    if (!tableResizing) return;
    const { id, dir } = tableResizing;
    const start = tableResizeStart.current;
    if (!start) return;

    const move = (e: PointerEvent) => {
      const rect = editCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((e.clientX - start.x) / rect.width) * 100;
      const dy = ((e.clientY - start.y) / rect.height) * 100;

      setLayouts(prev => {
        const cur: TableLayout = prev[id] || { x: 50, y: 50, shape: 'round' };
        let { x, y, w, h } = start.layout;

        if (dir.includes('e')) w = start.layout.w + dx;
        if (dir.includes('s')) h = start.layout.h + dy;
        if (dir.includes('w')) { const nw = start.layout.w - dx; x = start.layout.x + (start.layout.w - nw); w = nw; }
        if (dir.includes('n')) { const nh = start.layout.h - dy; y = start.layout.y + (start.layout.h - nh); h = nh; }

        // Round tables stay square.
        if (start.layout.shape === 'round') {
          const m = Math.max(w, h);
          w = m; h = m;
        }

        w = snap(Math.max(MIN_TABLE_PCT, Math.min(MAX_TABLE_PCT, w)), snapEnabled);
        h = start.layout.shape === 'rect' ? snap(Math.max(MIN_TABLE_PCT, Math.min(MAX_TABLE_PCT, h)), snapEnabled) : w;
        x = snap(Math.max(0, Math.min(100, x)), snapEnabled);
        y = snap(Math.max(0, Math.min(100, y)), snapEnabled);

        const n = { ...prev, [id]: { ...cur, x, y, w, h, scale: 1 } };
        persistLayouts(n); return n;
      });
    };

    const up = () => { setTableResizing(null); tableResizeStart.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [tableResizing, persistLayouts, snapEnabled]);

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

  // --- Resize handle placement (shared for table resize) ---
  const resizeHandleStyles: Record<string, string> = {
    n: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize',
    s: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize',
    w: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-w-resize',
    e: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-e-resize',
    nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize',
    ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize',
    sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize',
    se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize',
  };
  const ALL_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

  /** Shared JSX for the 8 table-resize handles (round tables use corners only). */
  const tableResizeHandles = (id: string, showCornersOnly: boolean) => (
    <>
      {(showCornersOnly ? ['nw', 'ne', 'sw', 'se'] : ALL_DIRS).map(dir => (
        <div key={dir}
          onPointerDown={(e) => handleTableResizeStart(id, dir, e)}
          className={`absolute w-3 h-3 bg-white border-2 border-[#004ac6] rounded-sm opacity-0 group-hover:opacity-100 hover:opacity-100 hover:bg-[#004ac6] transition-all z-30 shadow-sm touch-none ${resizeHandleStyles[dir]}`}
          title={`Resize ${dir}`}
        />
      ))}
    </>
  );

  // --- Canvas renderer (view mode) ---
  const renderCanvas = () => (
    <div ref={viewCanvasRef} className={`relative flex-1 min-h-[300px] md:min-h-[400px] overflow-hidden select-none rounded-xl bg-[#f5f3ff]`}>
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
      <div
        className="absolute z-10 pointer-events-none"
        style={{ left: `${entrancePos.x}%`, top: `${entrancePos.y}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className="flex flex-col items-center">
          <div className="w-14 h-0.5 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          <div className="mt-1 text-[7px] text-gray-400 font-bold uppercase tracking-[0.3em]">Entrance</div>
        </div>
      </div>

      {/* Tables */}
      {tables.map(table => {
        const lay = layouts[table.id];
        if (!lay) return null;
        const order = getOrder(table);
        const st = STATUS_STYLES[table.status] || STATUS_STYLES['Available'];
        const avail = table.status === 'Available';
        const sz = getTableSize(table.capacity, lay, viewSize);
        const urgent = table.priority === 'urgent';
        const isRound = lay.shape === 'round';

        return (
          <div key={table.id}
            onClick={() => { if (avail) onCreateOrder('Dine In', table.id); else if (order) onOpenBilling(order); }}
            data-tour={avail ? 'table-card' : undefined}
            className={`absolute group cursor-pointer hover:z-20`}
            style={{
              left: `${lay.x}%`, top: `${lay.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {/* Urgent badge (view) */}
            {urgent && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <span className="flex items-center gap-0.5 bg-red-500 text-white text-[6px] font-bold px-1.5 py-0.5 rounded-full animate-pulse shadow">
                  <AlertCircle className="w-2 h-2" /> URGENT
                </span>
              </div>
            )}

            {/* Table shape */}
            <div className={`relative flex flex-col items-center justify-center bg-white shadow-md transition-all
              ${isRound ? 'rounded-full' : 'rounded-xl'}
              ring-2 ${st.ring}
              ${avail ? 'hover:shadow-xl hover:scale-110 hover:ring-emerald-400' : 'hover:shadow-xl hover:scale-110'}
              ${urgent ? 'ring-red-400 animate-pulse' : ''}
            `} style={{ width: sz.w, height: sz.h }}>
              <span className={`${sz.fs} font-black leading-none ${avail ? 'text-emerald-700' : 'text-gray-800'}`}>{table.number}</span>
              <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white shadow-sm ${st.dot}`} />
            </div>

            {/* View-only overlays */}
            {!avail && (
              <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                <div className="bg-gray-900 text-white text-[7px] rounded-lg px-2 py-1 shadow-lg border border-gray-700 whitespace-nowrap">
                  {table.orderSince && <div className="flex items-center gap-1"><Clock className="w-2 h-2 text-gray-400" /><span>{getElapsedTime(table.orderSince, now)}</span></div>}
                  {order && order.grandTotal > 0 && <div className="font-bold text-emerald-400">{settings.currencySymbol || '₹'}{order.grandTotal.toFixed(2)}</div>}
                  {order?.status && <div className="text-gray-400">{order.status}</div>}
                </div>
              </div>
            )}
            {!avail && order && (
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 z-20 pointer-events-none">
                <button onClick={(e) => { e.stopPropagation(); onOpenReceiptPreview(order); }} className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center hover:scale-110 transition-all cursor-pointer pointer-events-auto"><Eye className="w-2.5 h-2.5 text-blue-600" /></button>
                <button onClick={(e) => { e.stopPropagation(); onOpenBilling(order); }} className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center hover:scale-110 transition-all cursor-pointer pointer-events-auto"><Receipt className="w-2.5 h-2.5 text-orange-600" /></button>
              </div>
            )}
            {avail && (
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[6px] font-bold text-emerald-500">Tap to seat</span>
              </div>
            )}
          </div>
        );
      })}

      {tables.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400">
            <UtensilsCrossed className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="font-bold text-gray-400 text-xs">No tables yet</p>
            <p className="text-[9px] mt-0.5">Edit floor plan → Tables tab to add them</p>
          </div>
        </div>
      )}

      {areas.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400">
            <Layers className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="font-bold text-gray-400 text-xs">No areas defined</p>
            <p className="text-[9px] mt-0.5">Edit floor plan → Areas tab to create zones</p>
          </div>
        </div>
      )}
    </div>
  );

  /** Quick-add a table by double-clicking empty canvas space. */
  const quickAddAt = (e: React.MouseEvent) => {
    if (editTab !== 'tables') return;
    const rect = editCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = snap(Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100)), snapEnabled);
    const y = snap(Math.max(5, Math.min(95, ((e.clientY - rect.top) / rect.height) * 100)), snapEnabled);
    const usedNums = new Set(tables.map(t => t.number));
    let num = 1;
    while (usedNums.has(num)) num++;
    const area = areas[0]?.label || 'Main Hall';
    pendingPosRef.current = { x, y };
    pendingShapeRef.current = 'round';
    onAddTable?.({ number: num, capacity: 4, section: area, status: 'Available' });
    showToast?.(`Table #${num} added at ${Math.round(x)}%, ${Math.round(y)}%`, 'success');
  };

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

        {renderCanvas()}
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
                      <><Layers className="w-3 h-3 text-[#004ac6]" /><span>Drag zones · resize via handles · drag entrance · double-click canvas to add</span></>
                    ) : (
                      <><Move className="w-3 h-3 text-[#004ac6]" /><span>Drag to move · 8 handles to resize · double-click empty space to quick-add</span></>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-auto relative">
                  {/* Canvas inner — ref drives all edit drag/resize math */}
                  <div ref={editCanvasRef}
                    onDoubleClick={quickAddAt}
                    className="relative border-2 border-dashed border-[#004ac6]/20 rounded-xl bg-white select-none touch-none"
                    style={{ minHeight: '600px', height: 'auto' }}
                  >
                    <div className="absolute inset-0 pointer-events-none opacity-[0.1]"
                      style={{ backgroundImage: 'linear-gradient(rgba(0,74,198,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,74,198,0.05) 1px, transparent 1px)', backgroundSize: '48px 48px' }}
                    />
                    {canvasSections.map(s => {
                      const isAreaDrag = draggingArea === s.id;
                      const isResize = resizing?.id === s.id;
                      const handleClass = editTab === 'areas' ? 'absolute z-20 w-3 h-3 bg-white border-2 border-[#004ac6] rounded-sm opacity-0 group-hover:opacity-100 hover:opacity-100 hover:bg-[#004ac6] hover:border-[#004ac6] transition-all cursor-pointer touch-none' : 'hidden';
                      return (
                      <div key={s.id}
                        onPointerDown={(e) => handleAreaGrab(s.id, e)}
                        className={`absolute rounded-xl border-2 ${s.border} ${s.bg} ${editTab === 'areas' ? 'cursor-grab group ring-2 ring-[#004ac6]/10 hover:ring-[#004ac6]/40 touch-none' : 'pointer-events-none'} ${isAreaDrag ? 'cursor-grabbing z-50 shadow-xl ring-[#004ac6]' : ''} ${isResize ? 'z-50 ring-[#004ac6]' : ''}`}
                        style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${Math.max(8, s.width)}%`, height: `${Math.max(10, s.height)}%` }}
                      >
                        {editTab === 'areas' && (
                          <>
                            {/* 8 resize handles */}
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'n', e); }} className={`${handleClass} -top-1.5 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 's', e); }} className={`${handleClass} -bottom-1.5 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'w', e); }} className={`${handleClass} top-1/2 -left-1.5 -translate-x-1/2 -translate-y-1/2 cursor-w-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'e', e); }} className={`${handleClass} top-1/2 -right-1.5 translate-x-1/2 -translate-y-1/2 cursor-e-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'nw', e); }} className={`${handleClass} -top-1.5 -left-1.5 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'ne', e); }} className={`${handleClass} -top-1.5 -right-1.5 translate-x-1/2 -translate-y-1/2 cursor-ne-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'sw', e); }} className={`${handleClass} -bottom-1.5 -left-1.5 -translate-x-1/2 translate-y-1/2 cursor-sw-resize`} />
                            <div onPointerDown={(e) => { e.stopPropagation(); handleResizeStart(s.id, 'se', e); }} className={`${handleClass} -bottom-1.5 -right-1.5 translate-x-1/2 translate-y-1/2 cursor-se-resize`} />

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

                    {/* Tables in edit mode — ALL tables shown, click to select */}
                    {editTab === 'tables' && tables.map(table => {
                      const lay = layouts[table.id];
                      if (!lay) return null;
                      const sz = getTableSize(table.capacity, lay, editSize);
                      const isDrag = dragging === table.id;
                      const isResizing = tableResizing?.id === table.id;
                      const isSelected = !!selectedTableIds[table.id];
                      const avail = table.status === 'Available';
                      const st = STATUS_STYLES[table.status] || STATUS_STYLES['Available'];
                      const isEditingNum = editingTableNum === table.id;
                      const isRound = lay.shape === 'round';
                      return (
                        <div key={table.id}
                          onPointerDown={(e) => handleGrab(table.id, e)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            // Selection toggle on click; ignore the click that trails a drag.
                            if (dragMovedRef.current) { dragMovedRef.current = false; return; }
                            e.stopPropagation();
                            setSelectedTableIds(prev => ({ ...prev, [table.id]: !prev[table.id] }));
                          }}
                          className={`absolute group touch-none ${isDrag ? 'z-50 cursor-grabbing' : 'hover:z-20'} ${isResizing ? 'z-50' : ''} ${isSelected ? 'z-30' : ''}`}
                          style={{ left: `${lay.x}%`, top: `${lay.y}%`, transform: 'translate(-50%, -50%)', transition: isDrag || isResizing ? 'none' : 'left 0.12s, top 0.12s' }}
                        >
                          {isSelected && (
                            <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 z-30 whitespace-nowrap">
                              <button onClick={(e) => { e.stopPropagation(); toggleShape(table.id); }}
                                className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-gray-100 transition-all cursor-pointer border border-gray-200"
                                title="Toggle round/rect"
                              >{isRound ? <Square className="w-2.5 h-2.5 text-purple-600" /> : <Circle className="w-2.5 h-2.5 text-purple-600" />}</button>
                              <button onClick={(e) => { e.stopPropagation(); resetTableSize(table.id); }}
                                className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-gray-100 transition-all cursor-pointer border border-gray-200"
                                title="Reset to default size"
                              ><RotateCcw className="w-2.5 h-2.5 text-blue-600" /></button>
                              <button onClick={(e) => { e.stopPropagation(); delTable(table.id); }}
                                className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-red-500 hover:text-white transition-all cursor-pointer border border-gray-200"
                                title="Delete table"
                              ><Trash2 className="w-2.5 h-2.5 text-red-500" /></button>
                            </div>
                          )}

                          <div className={`relative flex flex-col items-center justify-center bg-white shadow-md transition-all
                            ${isRound ? 'rounded-full' : 'rounded-xl'}
                            ring-2 ${isSelected ? 'ring-[#004ac6]' : st.ring}
                            hover:ring-[#004ac6]
                            ${isDrag ? 'shadow-2xl scale-110 ring-[#004ac6]' : ''}
                            ${isResizing ? 'ring-[#004ac6] shadow-xl' : ''}
                            ${isSelected ? 'shadow-lg' : ''}
                          `} style={{ width: sz.w, height: sz.h }}>
                            <span className={`${sz.fs} font-black leading-none cursor-pointer text-gray-800`}
                              onDoubleClick={(e) => { e.stopPropagation(); setEditingTableNum(table.id); setEditingTableNumVal(String(table.number)); }}
                            >{table.number}</span>
                            <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white shadow-sm ${st.dot}`} />
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[6px] font-bold text-gray-400 whitespace-nowrap">
                              Cap. {table.capacity} · {isRound ? `${Math.round(((lay.w ?? defaultTablePct(table.capacity)) / 100) * 100)}%` : `${Math.round(lay.w ?? defaultTablePct(table.capacity))}×${Math.round(lay.h ?? defaultTablePct(table.capacity) * 0.72)}%`}
                            </div>
                          </div>

                          {/* 8-direction resize handles (corners only for round) */}
                          {isSelected && tableResizeHandles(table.id, isRound)}

                          {isEditingNum && (
                            <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-40" onClick={(e) => e.stopPropagation()}>
                              <input type="number" value={editingTableNumVal}
                                onChange={e => setEditingTableNumVal(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') updateTableNumber(table.id); if (e.key === 'Escape') setEditingTableNum(null); }}
                                onBlur={() => updateTableNumber(table.id)}
                                className="w-16 text-center px-1 py-0.5 rounded-lg border-2 border-[#004ac6] bg-white text-[10px] font-black outline-none shadow-lg"
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {editTab === 'tables' && tables.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center text-gray-400">
                          <Table className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          <p className="font-bold text-gray-400 text-xs">No tables yet</p>
                          <p className="text-[9px] mt-0.5">Add one via the right panel or double-click here</p>
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
                      {tables.length === 0 && <p className="text-center py-6 text-[10px] text-gray-400">No tables. Click "Add Table" or double-click the canvas.</p>}
                    </div>
                    <div className="p-3 border-t border-[#e1e2ed] text-[10px] text-gray-500 text-center">{tables.length} table{tables.length !== 1 ? 's' : ''} · Click to show/hide on canvas · Click number to rename</div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#e1e2ed] bg-gray-50/50 shrink-0">
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <button onClick={() => setSnapEnabled(v => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer border ${
                    snapEnabled ? 'bg-[#004ac6] text-white border-[#004ac6]' : 'bg-white text-gray-500 border-[#e1e2ed] hover:border-[#004ac6]/40'
                  }`}
                ><Magnet className="w-3 h-3" /> Snap {snapEnabled ? 'On' : 'Off'}</button>
                <span className="hidden sm:inline">
                  {editTab === 'areas'
                    ? 'Drag zones · resize via handles · drag entrance · double-click to add'
                    : 'Drag to move · handles to resize · double-click empty space to quick-add'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { saveJSON(LAYOUT_KEY, layouts); saveJSON(AREA_LAYOUT_KEY, areaLayouts); saveJSON(ENTRANCE_POS_KEY, entrancePos); showToast?.('Layout saved', 'success'); }}
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
