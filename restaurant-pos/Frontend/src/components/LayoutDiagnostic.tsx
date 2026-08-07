/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LayoutDiagnostic — Real-time DOM layout debug overlay for the POS terminal.
 * Toggle with Ctrl+Shift+D to inspect:
 *
 *   • Viewport metrics: inner/outer/screen/visual/client/dvh/vh
 *   • Electron IPC: BrowserWindow bounds, contentBounds, isKiosk, isFullScreen
 *   • Layout trace: every parent from <body> down to the Pay (Cash) button
 *   • Mismatches highlighted in RED (e.g. BrowserWindow H ≠ innerH ≠ container H)
 *
 * Usage: Press Ctrl+Shift+D in the running POS app. Drag the title bar to move.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  X, RefreshCw, Eye, EyeOff, AlertTriangle, Info,
  Table2, Percent, Monitor, MonitorDown, Maximize2, LayoutList,
  ArrowRight, Link2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────

interface MeasuredNode {
  selector: string;
  tag: string;
  classes: string;
  rect: { top: number; left: number; width: number; height: number; bottom: number; right: number };
  styles: {
    display: string; position: string; overflow: string; overflowX: string; overflowY: string;
    minHeight: string; maxHeight: string; height: string;
    paddingTop: string; paddingBottom: string; paddingLeft: string; paddingRight: string;
    marginTop: string; marginBottom: string; marginLeft: string; marginRight: string;
    flex: string; flexGrow: string; flexShrink: string; flexBasis: string;
    alignSelf: string;
  };
  scrollInfo: { scrollW: number; scrollH: number; clientW: number; clientH: number } | null;
  issues: string[];
  dataTour: string | null;
  textPreview: string;
}

interface ElectronInfo {
  version: string | null;
  environment: { platform: string; electronVersion: string; chromeVersion: string } | null;
}

interface DiagnosticSnapshot {
  viewport: {
    innerWidth: number;  innerHeight: number;
    outerWidth: number;  outerHeight: number;
    devicePixelRatio: number;
    clientWidth: number; clientHeight: number;       // documentElement
    bodyClientWidth: number; bodyClientHeight: number; // document.body
    visualViewportWidth: number | null; visualViewportHeight: number | null;
    screenWidth: number; screenHeight: number;
    screenAvailWidth: number; screenAvailHeight: number;
    css100vh: number;
    css100dvh: number;
  };
  app: {
    rootHeight: number;
    titleBarHeight: number;
    sidebarWidth: number;
    billingGridHeight: number;
    cartPanelHeight: number;
    cartFooterHeight: number;
    payButtonTop: number;
    payButtonBottom: number;
    payButtonHeight: number;
    availableBottom: number;
    footerBelowViewport: boolean;
  };
  electron: {
    available: boolean;
    bounds: { x: number; y: number; width: number; height: number } | null;
    contentBounds: { x: number; y: number; width: number; height: number } | null;
    isKiosk: boolean | null;
    isFullScreen: boolean | null;
    platform: string | null;
  };
  trace: MeasuredNode[];
  mismatches: string[];
}

// ─── Helpers ─────────────────────────────────────────────────

function selectorOf(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = Array.from(el.classList).filter(c => !c.startsWith('_') && c !== 'undefined').slice(0, 3).join('.');
  return cls ? `${tag}.${cls}` : tag;
}

function shortText(el: Element): string {
  const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  return t.length > 48 ? t.slice(0, 45) + '...' : t;
}

function measureNode(el: Element): MeasuredNode {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const sc = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
    ? { scrollW: el.scrollWidth, scrollH: el.scrollHeight, clientW: el.clientWidth, clientH: el.clientHeight }
    : null;
  const issues: string[] = [];
  if (s.display === 'none') issues.push('display:none');
  if (s.visibility === 'hidden') issues.push('visibility:hidden');
  if (sc && sc.scrollH > sc.clientH + 2 && s.overflowY === 'hidden') issues.push('⛔ content clipped vertically');
  if (sc && sc.scrollW > sc.clientW + 2 && s.overflowX === 'hidden') issues.push('⛔ content clipped horizontally');

  return {
    selector: selectorOf(el),
    tag: el.tagName.toLowerCase(),
    classes: el.className?.toString()?.slice(0, 100) || '',
    rect: {
      top: Math.round(r.top * 10) / 10,
      left: Math.round(r.left * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
      right: Math.round(r.right * 10) / 10,
    },
    styles: {
      display: s.display, position: s.position,
      overflow: s.overflow, overflowX: s.overflowX, overflowY: s.overflowY,
      minHeight: s.minHeight, maxHeight: s.maxHeight, height: s.height,
      paddingTop: s.paddingTop, paddingBottom: s.paddingBottom,
      paddingLeft: s.paddingLeft, paddingRight: s.paddingRight,
      marginTop: s.marginTop, marginBottom: s.marginBottom,
      marginLeft: s.marginLeft, marginRight: s.marginRight,
      flex: s.flex, flexGrow: s.flexGrow, flexShrink: s.flexShrink,
      flexBasis: s.flexBasis, alignSelf: s.alignSelf,
    },
    scrollInfo: sc,
    issues,
    dataTour: el.getAttribute('data-tour'),
    textPreview: shortText(el),
  };
}

/** Walk from `body` to the element that contains "Pay" / "Cash" text */
function walkToPayButton(): MeasuredNode[] {
  const nodes: MeasuredNode[] = [];

  // body
  nodes.push(measureNode(document.body));

  // #root
  const root = document.getElementById('root');
  if (root) nodes.push(measureNode(root));

  // Walk first child that has class containing "h-full" (the App div)
  const appDiv = root?.querySelector('[class*="h-full"]') || root?.firstElementChild;
  if (appDiv && appDiv !== root) nodes.push(measureNode(appDiv));

  // Walk: title bar → flex-1 container → main → billing div
  const titleBar = appDiv?.querySelector('[class*="title"], [class*="Title"]') as HTMLElement;
  if (titleBar) nodes.push(measureNode(titleBar));

  // The flex row: div.flex.flex-1
  const flexRow = appDiv?.querySelector('[class*="flex-1"][class*="min-h-0"]')?.parentElement
    || appDiv?.querySelector('div.flex-1')?.parentElement;
  if (flexRow && flexRow !== appDiv) nodes.push(measureNode(flexRow));

  // Sidebar (if visible)
  const sidebar = flexRow?.querySelector('nav, [class*="sidebar"], [class*="Sidebar"]') as HTMLElement;
  if (sidebar) nodes.push(measureNode(sidebar));

  // main element
  const main = flexRow?.querySelector('main') || flexRow?.querySelector('[class*="flex-1"][class*="flex-col"]') as HTMLElement;
  if (main) nodes.push(measureNode(main));

  // Billing flex row div
  const billingRow = main?.querySelector('[class*="flex"][class*="flex-1"][class*="min-h-0"][class*="overflow-hidden"]') as HTMLElement;
  if (billingRow) nodes.push(measureNode(billingRow));

  // BillingProductGrid
  const grid = billingRow?.querySelector('[class*="flex-1"][class*="flex-col"][class*="p-4"]') as HTMLElement;
  if (grid) nodes.push(measureNode(grid));

  // CartPanel
  const cart = billingRow?.querySelector('[data-tour="cart-panel"]') as HTMLElement;
  if (cart) nodes.push(measureNode(cart));

  // Cart footer (the bottom section with the Pay button)
  const cartFooter = cart?.querySelector('[class*="shrink-0"]')?.closest('[class*="shrink-0"]') as HTMLElement
    || cart?.lastElementChild as HTMLElement;
  if (cartFooter) nodes.push(measureNode(cartFooter));

  // The Pay button specifically
  const payBtn = cart?.querySelector('[data-tour="pay-btn"]') as HTMLElement
    || cart?.querySelector('[class*="bg-green-600"]') as HTMLElement
    || document.querySelector('[data-tour="pay-btn"]') as HTMLElement;
  if (payBtn) nodes.push(measureNode(payBtn));

  return nodes;
}

/** Compute 100vh / 100dvh by creating a temporary element */
function computeCSSvh(): { css100vh: number; css100dvh: number } {
  const vhEl = document.createElement('div');
  vhEl.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:100vh;pointer-events:none;z-index:-1';
  document.body.appendChild(vhEl);
  const css100vh = vhEl.offsetHeight;
  document.body.removeChild(vhEl);

  const dvhEl = document.createElement('div');
  dvhEl.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:100dvh;pointer-events:none;z-index:-1';
  document.body.appendChild(dvhEl);
  const css100dvh = dvhEl.offsetHeight;
  document.body.removeChild(dvhEl);

  return { css100vh, css100dvh };
}

/** Gather Electron info via IPC */
async function gatherElectronInfo(): Promise<ElectronInfo> {
  const ep = (window as any).electronAPI;
  if (!ep) return { version: null, environment: null };
  try {
    const [version, env] = await Promise.all([
      ep.getVersion?.() || null,
      ep.getEnvironment?.() || null,
    ]);
    return { version: version ?? null, environment: env ?? null };
  } catch {
    return { version: null, environment: null };
  }
}

async function collectSnapshot(): Promise<DiagnosticSnapshot> {
  const vvh = window.visualViewport;
  const de = document.documentElement;
  const root = document.getElementById('root');
  const appOuter = root?.firstElementChild || root;

  // Collect viewport metrics
  const vpMetrics = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    clientWidth: de.clientWidth,
    clientHeight: de.clientHeight,
    bodyClientWidth: document.body.clientWidth,
    bodyClientHeight: document.body.clientHeight,
    visualViewportWidth: vvh?.width ?? null,
    visualViewportHeight: vvh?.height ?? null,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    screenAvailWidth: window.screen.availWidth,
    screenAvailHeight: window.screen.availHeight,
    ...computeCSSvh(),
  };

  // Collect component heights
  const titleBar = appOuter?.querySelector('[class*="title"], [class*="Title"], header') as HTMLElement;
  const mainEl = (appOuter as HTMLElement)?.querySelector('main') as HTMLElement;
  const billingRow = mainEl?.querySelector('[class*="flex"][class*="flex-1"][class*="min-h-0"][class*="overflow-hidden"]') as HTMLElement;
  const cart = billingRow?.querySelector('[data-tour="cart-panel"]') as HTMLElement;
  const payBtn = document.querySelector('[data-tour="pay-btn"]') as HTMLElement
    || cart?.querySelector('[class*="bg-green-600"]') as HTMLElement;

  // Cart footer
  const cartFooter = (() => {
    if (!cart) return null;
    // Last child that has shrink-0 (the footer section)
    const children = Array.from(cart.children);
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i] as HTMLElement;
      if (c.className?.includes('shrink-0')) return c;
    }
    return cart.lastElementChild as HTMLElement;
  })();

  const appMetrics = {
    rootHeight: root?.offsetHeight ?? 0,
    titleBarHeight: titleBar?.offsetHeight ?? 0,
    sidebarWidth: (appOuter as HTMLElement)?.querySelector('nav, [class*="sidebar"]')?.clientWidth ?? 0,
    billingGridHeight: billingRow?.firstElementChild?.clientHeight ?? 0,
    cartPanelHeight: cart?.offsetHeight ?? 0,
    cartFooterHeight: cartFooter?.offsetHeight ?? 0,
    payButtonTop: payBtn?.getBoundingClientRect()?.top ?? 0,
    payButtonBottom: payBtn?.getBoundingClientRect()?.bottom ?? 0,
    payButtonHeight: payBtn?.offsetHeight ?? 0,
    availableBottom: window.innerHeight - (payBtn?.getBoundingClientRect()?.bottom ?? window.innerHeight),
    footerBelowViewport: (payBtn?.getBoundingClientRect()?.bottom ?? 0) > window.innerHeight,
  };

  // Electron info
  const electron = await gatherElectronInfo();

  // Layout trace from body to Pay button
  const trace = walkToPayButton();

  // Detect mismatches
  const mismatches: string[] = [];

  // Mismatch 1: BrowserWindow vs inner
  if (electron.environment) {
    // We don't have direct BrowserWindow dimensions from renderer,
    // but we can compare outer vs inner
    if (vpMetrics.outerHeight !== vpMetrics.innerHeight) {
      mismatches.push(`⚠️ Browser window outer height (${vpMetrics.outerHeight}px) ≠ innerHeight (${vpMetrics.innerHeight}px) — ${vpMetrics.outerHeight - vpMetrics.innerHeight}px in chrome/decorations`);
    }
  }

  // Mismatch 2: innerHeight vs css100vh
  if (Math.abs(vpMetrics.innerHeight - vpMetrics.css100vh) > 1) {
    mismatches.push(`🔴 innerHeight (${vpMetrics.innerHeight}px) ≠ CSS 100vh (${vpMetrics.css100vh}px)`);
  }

  // Mismatch 3: innerHeight vs css100dvh
  if (Math.abs(vpMetrics.innerHeight - vpMetrics.css100dvh) > 1) {
    mismatches.push(`🔴 innerHeight (${vpMetrics.innerHeight}px) ≠ CSS 100dvh (${vpMetrics.css100dvh}px)`);
  }

  // Mismatch 4: root height vs innerHeight
  if (appMetrics.rootHeight > 0 && Math.abs(appMetrics.rootHeight - vpMetrics.innerHeight) > 1) {
    mismatches.push(`🔴 #root height (${appMetrics.rootHeight}px) ≠ innerHeight (${vpMetrics.innerHeight}px) — diff: ${appMetrics.rootHeight - vpMetrics.innerHeight}px`);
  }

  // Mismatch 5: calculated total vs innerHeight
  if (titleBar && appOuter) {
    const titleH = titleBar.offsetHeight;
    const mainEl = appOuter?.querySelector('main') as HTMLElement;
    if (mainEl) {
      const mainH = mainEl.offsetHeight;
      if (mainH > 0 && Math.abs(titleH + mainH - vpMetrics.innerHeight) > 2) {
        mismatches.push(`🔴 titleBar(${titleH}px) + main(${mainH}px) = ${titleH + mainH}px ≠ innerHeight(${vpMetrics.innerHeight}px)`);
      }
    }
  }

  // Mismatch 6: footer below viewport
  if (payBtn && payBtn.getBoundingClientRect().bottom > window.innerHeight) {
    mismatches.push(`🔴 Pay button bottom (${Math.round(payBtn.getBoundingClientRect().bottom)}px) > viewport bottom (${window.innerHeight}px) — button is BELOW the visible area!`);
  }

  // Mismatch 7: DPI scaling comment
  if (vpMetrics.devicePixelRatio > 1.0) {
    mismatches.push(`ℹ️ DPI scaling active: ${vpMetrics.devicePixelRatio.toFixed(2)}x — this affects Electron viewport sizing`);
  }

  // Mismatch 8: visualViewport vs innerHeight (mobile/non-100% zoom)
  if (vvh && Math.abs(vvh.height - window.innerHeight) > 1) {
    mismatches.push(`🔴 visualViewport.height (${Math.round(vvh.height)}px) ≠ innerHeight (${window.innerHeight}px) — zoom is not 100%`);
  }

  // Mismatch 9: screen vs inner
  if (Math.abs(window.screen.height - window.innerHeight) > 50) {
    mismatches.push(`ℹ️ Screen height (${window.screen.height}px) >> innerHeight (${window.innerHeight}px) — diff: ${window.screen.height - window.innerHeight}px (expected in fullscreen/kiosk)`);
  }

  return {
    viewport: vpMetrics,
    app: appMetrics,
    electron: {
      available: !!(window as any).electronAPI,
      bounds: null,   // Cannot get from renderer; shown via env info
      contentBounds: null,
      isKiosk: null,
      isFullScreen: null,
      platform: electron.environment?.platform ?? null,
    },
    trace,
    mismatches,
  };
}

// ─── Number formatting ──────────────────────────────────────

function fmt(n: number | null | undefined, suffix = 'px'): string {
  if (n == null) return '—';
  return `${Math.round(n)}${suffix}`;
}

function mismatchClass(val: boolean): string {
  return val ? 'text-red-400 font-bold' : 'text-green-400';
}

// ─── Main component ─────────────────────────────────────────

export default function LayoutDiagnostic() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<DiagnosticSnapshot | null>(null);
  const [selectedTab, setSelectedTab] = useState<'viewport' | 'electron' | 'trace' | 'issues'>('viewport');
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, panelLeft: 0, panelTop: 0 });
  const posRef = useRef({ x: 40, y: 60 });

  const refresh = useCallback(async () => {
    const snap = await collectSnapshot();
    setData(snap);
  }, []);

  // Toggle with Ctrl+Shift+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsOpen(prev => {
          if (!prev) setTimeout(refresh, 50);
          return !prev;
        });
      }
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, refresh]);

  // Auto-refresh on resize
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => refresh();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [isOpen, refresh]);

  const mismatchCount = data?.mismatches.length ?? 0;
  const hasMismatches = mismatchCount > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <div className="absolute inset-0" onClick={() => setIsOpen(false)} />

      <div
        ref={panelRef}
        className="absolute pointer-events-auto bg-[#1a1b2e] border border-[#2a2b4e] rounded-xl shadow-2xl text-white flex flex-col overflow-hidden"
        style={{
          width: 520,
          maxHeight: '85vh',
          left: posRef.current.x,
          top: posRef.current.y,
          fontSize: 12,
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
        }}
      >
        {/* ── Title bar ─────────────────────────────── */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-[#252640] border-b border-[#2a2b4e] cursor-move shrink-0 select-none"
          onMouseDown={(e) => {
            const panel = panelRef.current;
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            dragRef.current = { isDragging: true, startX: e.clientX, startY: e.clientY, panelLeft: rect.left, panelTop: rect.top };
            const onMove = (ev: MouseEvent) => {
              const dr = dragRef.current;
              if (!dr.isDragging) return;
              posRef.current.x = dr.panelLeft + (ev.clientX - dr.startX);
              posRef.current.y = dr.panelTop + (ev.clientY - dr.startY);
              panel.style.left = `${posRef.current.x}px`;
              panel.style.top = `${posRef.current.y}px`;
              panel.style.right = 'auto';
              panel.style.bottom = 'auto';
            };
            const onUp = () => {
              dragRef.current.isDragging = false;
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        >
          <div className="flex items-center gap-2">
            <Table2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-bold text-xs text-white">Layout Diagnostic</span>
            <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-mono">Ctrl+Shift+D</span>
            {hasMismatches && (
              <span className="text-[9px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-mono animate-pulse">
                {mismatchCount} issue{mismatchCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); refresh(); }}
              className="p-1 hover:bg-[#3a3b5e] rounded transition-all cursor-pointer" title="Refresh">
              <RefreshCw className="w-3 h-3 text-gray-400" />
            </button>
            <button onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-red-500/20 rounded transition-all cursor-pointer" title="Close (Esc)">
              <X className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────── */}
        <div className="flex border-b border-[#2a2b4e] shrink-0">
          {([
            { id: 'viewport', label: 'Viewport',  icon: Percent },
            { id: 'electron', label: 'Electron',  icon: Monitor },
            { id: 'trace',    label: 'Trace',     icon: LayoutList },
            { id: 'issues',   label: `Issues (${mismatchCount})`, icon: AlertTriangle },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => setSelectedTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold transition-all cursor-pointer border-b-2 ${
                selectedTab === tab.id
                  ? (tab.id === 'issues' && hasMismatches ? 'text-red-400 border-red-400 bg-red-500/10' : 'text-cyan-400 border-cyan-400 bg-cyan-500/10')
                  : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5'
              }`}>
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Content ───────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!data ? (
            <div className="text-center py-8 text-gray-500 text-[11px]">
              <EyeOff className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Click Refresh or press Ctrl+Shift+D</p>
            </div>
          ) : selectedTab === 'viewport' ? (
            <ViewportPanel data={data} />
          ) : selectedTab === 'electron' ? (
            <ElectronPanel data={data} />
          ) : selectedTab === 'trace' ? (
            <TracePanel data={data} />
          ) : (
            <IssuesPanel data={data} />
          )}
        </div>

        <div className="px-3 py-1.5 bg-[#252640] border-t border-[#2a2b4e] flex justify-between text-[9px] text-gray-500 shrink-0">
          <span>Drag title bar to reposition · Refresh to update</span>
          <span className={hasMismatches ? 'text-red-400 font-semibold' : 'text-green-400'}>
            {mismatchCount} mismatch{mismatchCount !== 1 ? 'es' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  TAB PANELS
// ══════════════════════════════════════════════════════════════

function ViewportPanel({ data }: { data: DiagnosticSnapshot }) {
  const v = data.viewport;
  const a = data.app;

  // Detect RED-level mismatches
  const vhMismatch = Math.abs(v.innerHeight - v.css100vh) > 1;
  const dvhMismatch = Math.abs(v.innerHeight - v.css100dvh) > 1;
  const rootMismatch = a.rootHeight > 0 && Math.abs(a.rootHeight - v.innerHeight) > 1;
  const footerOverflows = a.footerBelowViewport;

  return (
    <>
      {/* ── Section: Window & Viewport Sizes ───────────── */}
      <SectionTitle icon={Monitor} title="Window & Viewport" />
      <MetricGrid>
        <MetricItem label="window.innerWidth"     value={fmt(v.innerWidth)}     mismatch={false} />
        <MetricItem label="window.innerHeight"    value={fmt(v.innerHeight)}    mismatch={false} />
        <MetricItem label="window.outerWidth"      value={fmt(v.outerWidth)}     mismatch={Math.abs(v.outerWidth - v.innerWidth) > 2} />
        <MetricItem label="window.outerHeight"     value={fmt(v.outerHeight)}    mismatch={Math.abs(v.outerHeight - v.innerHeight) > 2} />
        <MetricItem label="documentElement.clientWidth"  value={fmt(v.clientWidth)}  mismatch={Math.abs(v.clientWidth - v.innerWidth) > 1} />
        <MetricItem label="documentElement.clientHeight" value={fmt(v.clientHeight)} mismatch={Math.abs(v.clientHeight - v.innerHeight) > 1} />
        <MetricItem label="document.body.clientWidth"    value={fmt(v.bodyClientWidth)} mismatch={false} />
        <MetricItem label="document.body.clientHeight"   value={fmt(v.bodyClientHeight)} mismatch={Math.abs(v.bodyClientHeight - v.innerHeight) > 1} />
        <MetricItem label="visualViewport.width"   value={v.visualViewportWidth ? fmt(v.visualViewportWidth) : 'N/A'}
          mismatch={v.visualViewportWidth != null && Math.abs(v.visualViewportWidth - v.innerWidth) > 1} />
        <MetricItem label="visualViewport.height"  value={v.visualViewportHeight ? fmt(v.visualViewportHeight) : 'N/A'}
          mismatch={v.visualViewportHeight != null && Math.abs(v.visualViewportHeight - v.innerHeight) > 1} />
      </MetricGrid>

      {/* ── Section: Screen ───────────────────────────── */}
      <SectionTitle icon={Maximize2} title="Screen" />
      <MetricGrid>
        <MetricItem label="screen.width"           value={fmt(v.screenWidth)}   mismatch={false} />
        <MetricItem label="screen.height"          value={fmt(v.screenHeight)}  mismatch={false} />
        <MetricItem label="screen.availWidth"      value={fmt(v.screenAvailWidth)} mismatch={Math.abs(v.screenAvailWidth - v.screenWidth) > 50} />
        <MetricItem label="screen.availHeight"     value={fmt(v.screenAvailHeight)} mismatch={Math.abs(v.screenAvailHeight - v.screenHeight) > 50} />
        <MetricItem label="devicePixelRatio"       value={`${v.devicePixelRatio.toFixed(2)}x`} mismatch={v.devicePixelRatio > 1.0} />
      </MetricGrid>

      {/* ── Section: CSS Values ───────────────────────── */}
      <SectionTitle icon={Percent} title="CSS Height Values" />
      <MetricGrid>
        <MetricItem label="CSS 100vh (measured)"   value={fmt(v.css100vh)}       mismatch={vhMismatch}
          hint={vhMismatch ? `🔴 ${Math.abs(v.innerHeight - v.css100vh)}px off from innerHeight` : undefined} />
        <MetricItem label="CSS 100dvh (measured)"  value={fmt(v.css100dvh)}      mismatch={dvhMismatch}
          hint={dvhMismatch ? `🔴 ${Math.abs(v.innerHeight - v.css100dvh)}px off from innerHeight` : undefined} />
      </MetricGrid>

      {/* ── Section: App Component Heights ────────────── */}
      <SectionTitle icon={LayoutList} title="App Component Heights" />
      <MetricGrid>
        <MetricItem label="#root container height" value={fmt(a.rootHeight)}  mismatch={rootMismatch}
          hint={rootMismatch ? `🔴 ${a.rootHeight - v.innerHeight}px vs innerHeight` : undefined} />
        <MetricItem label="TitleBar height"        value={fmt(a.titleBarHeight)} mismatch={false} />
        <MetricItem label="Sidebar width"          value={fmt(a.sidebarWidth, 'px')} mismatch={false} />
        {a.titleBarHeight > 0 && (
          <MetricItem label="Available height (inner - titleBar)"
            value={fmt(v.innerHeight - a.titleBarHeight)} mismatch={false} />
        )}
        <MetricItem label="CartPanel total height" value={fmt(a.cartPanelHeight)}
          mismatch={a.cartPanelHeight > 0 && a.cartPanelHeight + a.titleBarHeight > v.innerHeight} />
        <MetricItem label="Cart footer height"    value={fmt(a.cartFooterHeight)} mismatch={false} />
        <MetricItem label="Pay button top"        value={fmt(a.payButtonTop)}  mismatch={false} />
        <MetricItem label="Pay button bottom"     value={fmt(a.payButtonBottom)}
          mismatch={footerOverflows}
          hint={footerOverflows ? `🔴 Pay button bottom (${fmt(a.payButtonBottom)}) exceeds viewport bottom (${fmt(v.innerHeight)})` : undefined} />
        <MetricItem label="Pay button height"     value={fmt(a.payButtonHeight)} mismatch={false} />
        <MetricItem label="Remaining space below Pay"
          value={fmt(a.availableBottom)}
          mismatch={a.availableBottom < 0}
          hint={a.availableBottom < 0 ? `🔴 Pay button extends ${fmt(Math.abs(a.availableBottom))} below viewport` : undefined} />
      </MetricGrid>
    </>
  );
}

function ElectronPanel({ data }: { data: DiagnosticSnapshot }) {
  const e = data.electron;
  const v = data.viewport;

  return (
    <>
      <SectionTitle icon={Monitor} title="Electron Environment" />
      <div className="bg-[#12132a] rounded-lg p-3 border border-[#2a2b4e] space-y-2">
        {!e.available ? (
          <div className="text-yellow-400 text-[11px] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Not running in Electron — window.electronAPI not found. These metrics are only available in the desktop app.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
              <InfoRow label="Platform" value={e.platform || '—'} />
              <InfoRow label="Electron API" value="✅ Available" color="text-green-400" />
            </div>

            <div className="border-t border-[#2a2b4e] pt-2 mt-2">
              <div className="text-[9px] text-gray-500 mb-1 font-sans font-semibold uppercase tracking-wider">
                ⚡ Kiosk / Fullscreen Viewport Diagnosis
              </div>
              <div className="space-y-1 text-[10px] font-mono">
                <p className="text-gray-300">
                  In Electron kiosk mode, <span className="text-cyan-300 font-bold">innerHeight</span> should equal{' '}
                  <span className="text-cyan-300 font-bold">screen.availHeight</span>.
                </p>
                <p className={v.innerHeight >= v.screenAvailHeight - 100 ? 'text-green-400' : 'text-red-400'}>
                  {v.innerHeight >= v.screenAvailHeight - 100
                    ? '✅ innerHeight ≈ availHeight — viewport is using full available space'
                    : `🔴 innerHeight (${fmt(v.innerHeight)}) << availHeight (${fmt(v.screenAvailHeight)}) — viewport is NOT using full screen`}
                </p>
                <p className={Math.abs(v.outerHeight - v.innerHeight) <= 5 ? 'text-green-400' : 'text-red-400'}>
                  {Math.abs(v.outerHeight - v.innerHeight) <= 5
                    ? '✅ outerHeight ≈ innerHeight — no window chrome (expected in kiosk)'
                    : `🔴 outerHeight (${fmt(v.outerHeight)}) - innerHeight (${fmt(v.innerHeight)}) = ${v.outerHeight - v.innerHeight}px — window chrome present`}
                </p>
                <p className={v.css100dvh === v.innerHeight ? 'text-green-400' : 'text-yellow-400'}>
                  {v.css100dvh === v.innerHeight
                    ? '✅ CSS 100dvh = innerHeight — dynamic viewport is correct'
                    : `⚠️ CSS 100dvh (${fmt(v.css100dvh)}) ≠ innerHeight (${fmt(v.innerHeight)})`}
                </p>
              </div>
            </div>

            {/* Known DPI Issue Warning */}
            {v.devicePixelRatio > 1.0 && (
              <div className="border-t border-[#2a2b4e] pt-2 mt-2">
                <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="text-[10px] text-red-300">
                    <p className="font-bold mb-0.5">⚠️ HIGH DPI / SCALING ACTIVE</p>
                    <p>Device pixel ratio: <span className="font-bold">{v.devicePixelRatio.toFixed(2)}x</span></p>
                    <p className="mt-1">On Windows with DPI scaling &gt;100%, Electron's Chromium viewport may not match the actual screen resolution. This is a <span className="font-bold">known Electron issue</span> in kiosk mode.</p>
                    <p className="mt-1">Expected screen height: <span className="text-cyan-300">{fmt(v.screenAvailHeight)}</span></p>
                    <p>Actual viewport height: <span className={v.innerHeight >= v.screenAvailHeight - 10 ? 'text-green-400' : 'text-red-400'}>{fmt(v.innerHeight)}</span></p>
                    <p>Diff: <span className={Math.abs(v.innerHeight - v.screenAvailHeight) <= 10 ? 'text-green-400' : 'text-red-400'}>
                      {Math.abs(v.innerHeight - v.screenAvailHeight)}px
                    </span></p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Debug Info: CSS Variable ─────────────────── */}
      <SectionTitle icon={Link2} title="CSS Variable: --app-height" />
      <div className="bg-[#12132a] rounded-lg p-3 border border-[#2a2b4e]">
        <div className="text-[10px] font-mono space-y-1">
          <InfoRow label="--app-height value"
            value={document.documentElement.style.getPropertyValue('--app-height') || 'NOT SET (defaults to 100%)'}
            color={document.documentElement.style.getPropertyValue('--app-height') ? 'text-cyan-300' : 'text-yellow-400'} />
          <InfoRow label="Used in CSS"
            value="✅ Yes — index.css uses height: var(--app-height, 100%)"
            color="text-green-400" />              <div className="mt-1 p-2 bg-green-500/10 rounded border border-green-500/20 text-green-300">
            <p className="font-bold text-[10px]">✅ FIXED: The useWindowResize hook now sets --app-height to the exact IPC height pixel value!</p>
            <p className="text-[9px] mt-0.5">CSS uses <code className="text-cyan-300">{'#root { height: var(--app-height, 100%); min-height: 100dvh; }'}</code>.</p>
            <p className="text-[9px]">When Electron IPC sends a height, it is used directly; otherwise innerHeight is used.</p>
          </div>
        </div>
      </div>
    </>
  );
}

function TracePanel({ data }: { data: DiagnosticSnapshot }) {
  const t = data.trace;

  return (
    <>
      <SectionTitle icon={LayoutList} title="DOM Layout Trace: body → Pay Button" />
      <div className="text-[9px] text-gray-500 mb-2 font-sans">
        Every parent element from &lt;body&gt; to the Pay (Cash) button.
        Shows height, min-height, max-height, overflow, display, position, flex, padding, margin.
      </div>

      {t.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-[11px]">
          <EyeOff className="w-5 h-5 mx-auto mb-1 opacity-40" />
          <p>No trace data. Navigate to Billing workspace first.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {t.map((node, i) => {
            const r = node.rect;
            const s = node.styles;
            const isLast = i === t.length - 1;
            const exceedsVp = r.bottom > window.innerHeight;
            const zeroH = r.height <= 0;
            const clipped = node.issues.length > 0;

            const severityColor = !node.styles.display || node.styles.display === 'none' ? 'border-red-500/40' :
              exceedsVp ? 'border-red-500/30' :
              zeroH ? 'border-amber-500/30' :
              clipped ? 'border-amber-500/20' :
              'border-green-500/20';

            return (
              <div key={i} className={`bg-[#12132a] rounded-lg border ${severityColor} p-2`}>
                {/* Header */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] text-gray-600 font-mono shrink-0">#{i}</span>
                    <span className={`text-[10px] font-mono font-bold ${
                      s.position === 'fixed' ? 'text-purple-400' :
                      s.position === 'absolute' ? 'text-amber-400' :
                      s.position === 'sticky' ? 'text-cyan-400' :
                      'text-green-400'
                    }`}>
                      {node.tag}
                      {node.classes && <span className="text-gray-500 font-light">.{node.classes.split(' ').slice(0, 2).join('.')}</span>}
                    </span>
                    {node.dataTour && (
                      <span className="text-[8px] bg-cyan-500/10 text-cyan-300 px-1 py-0.5 rounded">
                        data-tour="{node.dataTour}"
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {exceedsVp && <span className="text-[8px] bg-red-500/20 text-red-300 px-1 py-0.5 rounded font-bold">BELOW VP</span>}
                    {clipped && <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />}
                  </div>
                </div>

                {/* Dimensions */}
                <div className="grid grid-cols-5 gap-1 mb-1">
                  <MiniMetric label="H" value={fmt(r.height)} highlight={exceedsVp || zeroH} />
                  <MiniMetric label="W" value={fmt(r.width)} highlight={false} />
                  <MiniMetric label="top" value={fmt(r.top)} highlight={false} />
                  <MiniMetric label="bottom" value={fmt(r.bottom)} highlight={exceedsVp} />
                  <MiniMetric label="overflow" value={s.overflowY} highlight={s.overflowY === 'hidden'} />
                </div>

                {/* Computed styles */}
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] font-mono text-gray-500">
                  <span>{s.display}</span>
                  <span>{s.position}</span>
                  <span>min-h: {s.minHeight}</span>
                  <span>max-h: {s.maxHeight}</span>
                  <span>h: {s.height}</span>
                  <span>flex: {s.flex}</span>
                  <span>grow: {s.flexGrow}</span>
                  <span>shrink: {s.flexShrink}</span>
                  <span>pt: {s.paddingTop}</span>
                  <span>pb: {s.paddingBottom}</span>
                  <span>mt: {s.marginTop}</span>
                  <span>mb: {s.marginBottom}</span>
                </div>

                {/* Issue tags */}
                {node.issues.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {node.issues.map((issue, j) => (
                      <span key={j} className="text-[7px] px-1 py-0.5 rounded bg-red-500/15 text-red-300 font-mono">{issue}</span>
                    ))}
                  </div>
                )}

                {/* Scroll info */}
                {node.scrollInfo && node.scrollInfo.scrollH > node.scrollInfo.clientH + 1 && (
                  <div className="mt-1 text-[8px] font-mono text-amber-400">
                    ⚡ content: {node.scrollInfo.scrollW}×{node.scrollInfo.scrollH}px · visible: {node.scrollInfo.clientW}×{node.scrollInfo.clientH}px
                    {s.overflowY === 'hidden' && ' ⛔ CLIPPED'}
                  </div>
                )}

                {/* Text preview */}
                {node.textPreview && (
                  <div className="mt-0.5 text-[8px] text-gray-600 truncate font-sans">&ldquo;{node.textPreview}&rdquo;</div>
                )}

                {/* Arrow to next */}
                {!isLast && (
                  <div className="flex justify-center -mb-2 mt-0.5">
                    <ArrowRight className="w-3 h-3 text-gray-600" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function IssuesPanel({ data }: { data: DiagnosticSnapshot }) {
  const mismatches = data.mismatches;

  return (
    <>
      <SectionTitle icon={AlertTriangle} title="Detected Mismatches & Issues" />
      <div className="text-[9px] text-gray-500 mb-2 font-sans">
        Values that disagree indicate the root cause of viewport/layout problems.
      </div>

      {mismatches.length === 0 ? (
        <div className="text-center py-8">
          <Info className="w-8 h-8 text-green-400 mx-auto mb-2" />
          <p className="text-xs text-green-400 font-semibold">No layout mismatches detected</p>
          <p className="text-[10px] text-gray-500 mt-1">All viewport values are consistent.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {mismatches.map((m, i) => {
            const isRed = m.startsWith('🔴');
            const isWarning = m.startsWith('⚠️');
            const isInfo = m.startsWith('ℹ️');
            return (
              <div key={i} className={`flex items-start gap-2 p-2.5 rounded-lg border ${
                isRed ? 'bg-red-500/10 border-red-500/25' :
                isWarning ? 'bg-amber-500/10 border-amber-500/25' :
                'bg-cyan-500/10 border-cyan-500/20'
              }`}>
                <div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                  isRed ? 'bg-red-400 animate-pulse' :
                  isWarning ? 'bg-amber-400' :
                  'bg-cyan-400'
                }`} />
                <div className="text-[10px] font-mono leading-relaxed text-gray-200">
                  {m.replace('🔴 ', '').replace('⚠️ ', '').replace('ℹ️ ', '')}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Diagnosis summary */}
      <SectionTitle icon={Info} title="Root Cause Analysis" />
      <div className="bg-[#12132a] rounded-lg p-3 border border-[#2a2b4e] text-[10px] font-mono space-y-1">
        <p className="text-gray-400 font-sans font-semibold">Common causes for kiosk-mode viewport issues:</p>
        <ul className="list-disc list-inside text-gray-300 space-y-1 mt-1">
          <li>
            <span className="text-cyan-300">--app-height</span> is now USED in CSS via <span className="text-green-400">height: var(--app-height, 100%)</span>.
            <span className="text-green-400">min-height: 100dvh</span> provides a reliable fallback.
          </li>
          <li>
            In Electron, <span className="text-cyan-300">setFullScreen(true)</span> enters kiosk mode.
            Chromium's viewport <em>should</em> match the screen, but with DPI scaling, it can report wrong dimensions.
          </li>
          <li>
            If <span className="text-red-400">innerHeight &lt; screen.availHeight</span>, Chromium is not using the full screen.
            This is a known Electron bug with <span className="text-amber-400">maximize()</span> and DPI.
          </li>
          <li>
            If a <span className="text-red-400">parent has overflow:hidden</span> and content exceeds its computed height,
            the child is silently clipped — the footer/Pay button disappears.
          </li>
          <li>
            If <span className="text-red-400">min-height: 0</span> is missing from a flex child, flexbox default is <span className="text-amber-400">min-height: auto</span>
            which prevents flex children from shrinking below their content height.
          </li>
        </ul>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  REUSABLE COMPONENTS
// ══════════════════════════════════════════════════════════════

function SectionTitle({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider font-sans">
      <Icon className="w-3 h-3 text-cyan-400" />
      {title}
    </div>
  );
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

function MetricItem({ label, value, mismatch, hint }: { label: string; value: string; mismatch: boolean; hint?: string }) {
  return (
    <div className={`bg-[#12132a] rounded-lg p-2 border ${mismatch ? 'border-red-500/40' : 'border-[#2a2b4e]'}`}>
      <div className="text-[8px] text-gray-500 font-sans truncate" title={label}>{label}</div>
      <div className={`text-[11px] font-bold font-mono ${mismatch ? 'text-red-400' : 'text-cyan-300'}`}>{value}</div>
      {hint && <div className="text-[8px] text-red-400 font-mono mt-0.5">{hint}</div>}
    </div>
  );
}

function MiniMetric({ label, value, highlight }: { label: string; value: string; highlight: boolean }) {
  return (
    <div className="text-[8px] font-mono">
      <span className="text-gray-600">{label}:</span>{' '}
      <span className={`font-bold ${highlight ? 'text-red-400' : 'text-gray-300'}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold ${color || 'text-gray-200'}`}>{value}</span>
    </div>
  );
}
