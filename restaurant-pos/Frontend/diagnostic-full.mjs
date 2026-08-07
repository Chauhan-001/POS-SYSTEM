/**
 * Full Layout Verification Script
 * Launches POS in Electron, seeds data, verifies ALL window states.
 *
 * Usage: node diagnostic-full.mjs
 */

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEED = `
  (() => {
    const s = window.localStorage;
    s.setItem('pos_employees', JSON.stringify([{id:'emp_owner',username:'owner',name:'Rajesh Kumar',role:'Owner',pin:'1111',status:'Active',branchId:'branch_main',lastLogin:'2026-07-20 09:15 AM'}]));
    s.setItem('pos_products', JSON.stringify([{id:'p1',code:'PZA01',name:'Margherita Pizza',category:'Pizzas',price:249,image:'',availability:true,favorite:true,gst:5},{id:'p2',code:'BRG01',name:'Classic Burger',category:'Burgers',price:179,image:'',availability:true,favorite:false,gst:5}]));
    s.setItem('pos_categories', JSON.stringify(['Pizzas','Burgers','Pasta','Beverages','Desserts','Appetizers']));
    s.setItem('pos_category_colors', JSON.stringify({'Pizzas':'#ef4444','Burgers':'#f59e0b','Pasta':'#10b981','Beverages':'#0ea5e9','Desserts':'#ec4899','Appetizers':'#f97316'}));
    s.setItem('pos_customers', JSON.stringify([{id:'c1',name:'Amit Sharma',phone:'9876543210',email:'amit@example.com',totalVisits:15,totalSpent:5200,points:350,createdAt:'2026-01-15'}]));
    s.setItem('pos_rewards', JSON.stringify([{id:'r1',type:'percentage',title:'10% Off',value:10,pointsRequired:100,isActive:true}]));
    s.setItem('pos_settings', JSON.stringify({restaurantName:'Test Bistro',currencySymbol:'₹',defaultTaxRate:5,gstRate:5,enableGst:true,printerSize:'80mm',enableKitchenDisplay:true,enableTableService:true,enableDeliveryModule:true,enableOnlineOrders:true,enableLoyalty:true,showImagesInBilling:false,moduleSettings:{enableTableService:true,enableLoyalty:true,enableKitchenDisplay:true,enableDeliveryModule:true,enableOnlineOrders:true,enableQROrdering:false,showImagesInBilling:false,enableOrderNotes:true,enableDiscountOnBilling:true,enableGuestCheckout:true,enableExpenseManagement:true}}));
    s.setItem('pos_bills', JSON.stringify([]));
    s.setItem('pos_orders', JSON.stringify([]));
    s.setItem('pos_held_orders', JSON.stringify([]));
    s.setItem('pos_expenses', JSON.stringify([]));
    s.setItem('pos_tables', JSON.stringify([]));
    s.setItem('pos_takeaway_orders', JSON.stringify([]));
    s.setItem('pos_reservations', JSON.stringify([]));
    s.setItem('pos_branches', JSON.stringify([{id:'branch_main',name:'Main Branch',address:'123 Main St',phone:'+91-22-22004400',isHeadBranch:true,isActive:true,createdAt:'2026-01-01T00:00:00Z'}]));
    s.setItem('pos_current_branch_id', JSON.stringify('branch_main'));
    s.setItem('pos_initialized_clean_v5', 'true');
    s.setItem('pos_onboarding_done', 'true');
    s.setItem('pos_current_employee', JSON.stringify({id:'emp_owner',username:'owner',name:'Rajesh Kumar',role:'Owner',pin:'1111',status:'Active',branchId:'branch_main'}));
    console.log('[Seed] localStorage seeded');
  })();
`;

function section(title) {
  console.log(`\n${'='.repeat(72)}\n  ${title}\n${'='.repeat(72)}`);
}

async function capture(window) {
  return await window.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootEl = document.getElementById('root');
    const appDiv = rootEl?.querySelector(':scope > div');
    const titleBar = (() => { const app = document.querySelector('#root > div'); if (!app) return null; const first = app.children[0]; return first && first instanceof HTMLElement ? first : null; })();
    const sidebar = document.querySelector('aside');
    const mainEl = document.querySelector('main');
    const workspace = mainEl?.querySelector(':scope > div');
    const loginScreen = document.getElementById('login_screen_container');

    // Find all scrollable containers with overflow
    const allEls = document.querySelectorAll('*');
    const scrollables = [];
    for (const el of allEls) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'auto' || cs.overflowY === 'auto' || cs.overflow === 'scroll' || cs.overflowY === 'scroll') {
        if (el.scrollHeight > el.clientHeight + 2) {
          scrollables.push({ tag: el.tagName, id: el.id || '', class: el.className.substring(0, 60), scrollH: el.scrollHeight, clientH: el.clientHeight, diff: el.scrollHeight - el.clientHeight });
        }
      }
    }

    function rect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    }

    function cs(el) {
      if (!el) return null;
      const c = getComputedStyle(el);
      return { display: c.display, height: c.height, minH: c.minHeight, maxH: c.maxHeight, overflow: c.overflow, overflowY: c.overflowY, pos: c.position, flex: c.flex, flexDir: c.flexDirection };
    }

    const vp = window.innerHeight;
    const issues = [];

    // Check: app root within viewport
    if (appDiv) {
      const r = appDiv.getBoundingClientRect();
      if (r.bottom > vp + 2) issues.push({ type: 'app-bottom-exceeds', actual: Math.round(r.bottom), expected: vp });
      if (r.top < -1) issues.push({ type: 'app-top-negative', actual: Math.round(r.top) });
    }

    // Check: main within viewport
    if (mainEl) {
      const r = mainEl.getBoundingClientRect();
      if (r.bottom > vp + 2) issues.push({ type: 'main-bottom-exceeds', actual: Math.round(r.bottom), expected: vp });
    }

    // Check: sidebar bottom visible
    if (sidebar) {
      const r = sidebar.getBoundingClientRect();
      if (r.bottom > vp + 2) issues.push({ type: 'sidebar-bottom-clipped', actual: Math.round(r.bottom), expected: vp });
    }

    // Check: titlebar at top
    if (titleBar) {
      const r = titleBar.getBoundingClientRect();
      if (r.top < -1 || r.top > 2) issues.push({ type: 'titlebar-not-at-top', actual: Math.round(r.top) });
    }

    // Check: body scroll
    if (body && body.scrollHeight > vp + 2) issues.push({ type: 'body-scrolls', actual: Math.round(body.scrollHeight), expected: vp });
    if (root.scrollHeight > vp + 2) issues.push({ type: 'html-scrolls', actual: Math.round(root.scrollHeight), expected: vp });

    return {
      viewport: { w: window.innerWidth, h: vp, dpr: window.devicePixelRatio, availH: window.screen.availHeight },
      loginScreenVisible: !!loginScreen,
      root: { exists: !!rootEl, html: rootEl ? rootEl.innerHTML.substring(0, 200) : 'N/A', cs: cs(rootEl) },
      app: { rect: rect(appDiv), cs: cs(appDiv) },
      titleBar: { rect: rect(titleBar), cs: cs(titleBar) },
      sidebar: { rect: rect(sidebar), cs: cs(sidebar) },
      main: { rect: rect(mainEl), cs: cs(mainEl) },
      workspace: { rect: rect(workspace), cs: cs(workspace) },
      scrollables: scrollables.length > 0 ? scrollables : [],
      issues: issues,
      bodyCS: body ? { overflow: getComputedStyle(body).overflow, height: getComputedStyle(body).height } : null,
      htmlCS: { overflow: getComputedStyle(root).overflow, height: getComputedStyle(root).height },
    };
  });
}

function format(label, d) {
  console.log(`\n--- ${label} ---`);
  console.log(`  Viewport: ${d.viewport.w}x${d.viewport.h} @${d.viewport.dpr}x DPR`);
  console.log(`  Login screen visible: ${d.loginScreenVisible}`);
  console.log(`  Root exists: ${d.root.exists} | ${d.root.cs ? `cs: ${d.root.cs.display} ${d.root.cs.height} ${d.root.cs.overflow}` : ''}`);
  console.log(`  App: ${d.app.rect ? `[${d.app.rect.l},${d.app.rect.t} → ${d.app.rect.r},${d.app.rect.b}] ${d.app.rect.w}x${d.app.rect.h}` : 'N/A'} | cs: ${d.app.cs ? `${d.app.cs.display} ${d.app.cs.height} ${d.app.cs.overflow}` : 'N/A'}`);
  if (d.titleBar?.rect) console.log(`  TitleBar: [${d.titleBar.rect.l},${d.titleBar.rect.t} → ${d.titleBar.rect.r},${d.titleBar.rect.b}] ${d.titleBar.rect.w}x${d.titleBar.rect.h}`);
  if (d.sidebar?.rect) console.log(`  Sidebar: [${d.sidebar.rect.l},${d.sidebar.rect.t} → ${d.sidebar.rect.r},${d.sidebar.rect.b}] ${d.sidebar.rect.w}x${d.sidebar.rect.h}`);
  console.log(`  Main: ${d.main.rect ? `[${d.main.rect.l},${d.main.rect.t} → ${d.main.rect.r},${d.main.rect.b}] ${d.main.rect.w}x${d.main.rect.h}` : 'N/A'}`);
  console.log(`  Body overflow: ${d.bodyCS?.overflow} ht:${d.bodyCS?.height}`);
  console.log(`  Html overflow: ${d.htmlCS?.overflow} ht:${d.htmlCS?.height}`);
  if (d.scrollables.length > 0) {
    console.log(`  ⚠️ Scrollable overflow containers:`);
    d.scrollables.forEach(s => console.log(`     ${s.tag}#${s.id}.${s.class} scrollH=${s.scrollH} clientH=${s.clientH} diff=+${s.diff}`));
  }
  if (d.issues.length > 0) {
    console.log(`  ❌ ISSUES:`);
    d.issues.forEach(i => console.log(`     ${i.type}: ${i.actual} vs expected ${i.expected}`));
  } else {
    console.log(`  ✅ No viewport violations`);
  }
}

async function waitForAppWindow(electronApp) {
  const maxWait = 15000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    for (const w of electronApp.windows()) {
      const url = w.url();
      if (!url.startsWith('devtools://') && !url.startsWith('chrome-extension://')) return w;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  // Try listening for new windows
  return await new Promise((resolve) => {
    const handler = (w) => { if (!w.url().startsWith('devtools://')) { electronApp.removeListener('window', handler); resolve(w); } };
    electronApp.on('window', handler);
    setTimeout(() => { electronApp.removeListener('window', handler); resolve(null); }, 5000);
  });
}

async function navigate(window, hash) {
  await window.evaluate((h) => { window.location.hash = h; }, hash);
  await window.waitForTimeout(1500);
  // Wait for login screen to disappear if it appears
  await window.waitForFunction(() => !document.getElementById('login_screen_container'), { timeout: 5000 }).catch(() => {});
  await window.waitForTimeout(500);
}

async function run() {
  section('LAUNCHING ELECTRON');
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    env: { ...process.env, NODE_ENV: 'development' },
  });

  const window = await waitForAppWindow(electronApp);
  if (!window) { console.error('No app window'); await electronApp.close(); return; }

  console.log(`App URL: ${window.url()}`);

  // Seed + reload
  await window.waitForLoadState('networkidle');
  await window.evaluate(SEED);
  await window.reload();
  await window.waitForLoadState('networkidle');
  await window.waitForTimeout(3000);

  // Initial capture
  let d = await capture(window);
  format('INITIAL (after seed + reload)', d);

  // ── STATE 2: Maximized (by this point maximize() should have fired) ──
  section('STATE: MAXIMIZED (ready-to-show fired)');
  await window.waitForTimeout(1000);
  d = await capture(window);
  format('Maximized', d);

  // ── STATE 3: F11 Fullscreen ──
  section('STATE: F11 FULLSCREEN');
  await window.keyboard.press('F11');
  await window.waitForTimeout(2000);
  d = await capture(window);
  format('Fullscreen', d);

  // ── STATE 4: Exit Fullscreen ──
  section('STATE: BACK FROM FULLSCREEN');
  await window.keyboard.press('F11');
  await window.waitForTimeout(2000);
  d = await capture(window);
  format('After fullscreen exit', d);

  // ── STATE 5: Kiosk Mode ──
  section('STATE: KIOSK MODE');
  await window.evaluate(() => window.electronAPI?.toggleFrame());
  await window.waitForTimeout(2000);
  d = await capture(window);
  format('Kiosk mode', d);

  // ── STATE 6: Exit Kiosk ──
  section('STATE: BACK FROM KIOSK');
  await window.evaluate(() => window.electronAPI?.toggleFrame());
  await window.waitForTimeout(2000);
  d = await capture(window);
  format('After kiosk exit', d);

  // ── STATE 7: Page Navigation ──
  section('STATE: PAGE NAVIGATION (after full round-trip)');
  const pages = [
    { name: 'Dashboard', hash: '#/dashboard' },
    { name: 'Orders', hash: '#/orders' },
    { name: 'Kitchen', hash: '#/kitchen' },
    { name: 'Billing', hash: '#/billing' },
    { name: 'Products', hash: '#/products' },
    { name: 'Customers', hash: '#/customers' },
    { name: 'Dashboard (final)', hash: '#/dashboard' },
  ];

  for (const p of pages) {
    await navigate(window, p.hash);
    d = await capture(window);
    console.log(`\n--- ${p.name} ---`);
    console.log(`  Viewport: ${d.viewport.w}x${d.viewport.h}`);
    if (d.issues.length > 0) {
      console.log(`  ❌ ISSUES:`);
      d.issues.forEach(i => console.log(`     ${i.type}: ${i.actual} vs expected ${i.expected}`));
    } else {
      console.log(`  ✅ OK`);
    }
  }

  // ── CLEANUP ──
  section('CLEANUP');
  await electronApp.close();
  console.log('Done.');
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
