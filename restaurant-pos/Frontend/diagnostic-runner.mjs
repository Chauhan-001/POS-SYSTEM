/**
 * Runtime Layout Diagnostic Runner
 *
 * Usage: node diagnostic-runner.mjs
 * Requires: backend + Frontend dev servers running on standard ports
 */

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEED_SCRIPT = `
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

function printSection(title) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(78)}`);
}

async function getDiagnostics(page) {
  // Capture ALL console messages from the page
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.message}`));

  const data = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootEl = document.getElementById('root');
    
    // Dump DOM structure around root
    const rootHTML = rootEl ? rootEl.outerHTML.substring(0, 500) : '#root NOT FOUND';
    const bodyChildren = body ? Array.from(body.children).map(c => c.tagName + (c.id ? '#' + c.id : '')).join(', ') : 'body null';
    
    return {
      rootExists: !!rootEl,
      rootHTML: rootHTML,
      bodyChildren: bodyChildren,
      rootElTag: rootEl ? rootEl.tagName : 'N/A',
      innerHeight: window.innerHeight,
    };
  });

  return { data, logs };
}

async function run() {
  printSection('LAUNCHING ELECTRON');

  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    env: { ...process.env, NODE_ENV: 'development' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('networkidle');

  // Debug: check what the page looks like before seeding
  let diag = await getDiagnostics(window);
  console.log('Before seed:');
  console.log(`  rootExists: ${diag.data.rootExists}`);
  console.log(`  rootHTML: ${diag.data.rootHTML.substring(0, 200)}`);
  console.log(`  bodyChildren: ${diag.data.bodyChildren}`);

  // Seed localStorage
  await window.evaluate(SEED_SCRIPT);
  await window.reload();
  await window.waitForLoadState('networkidle');
  await window.waitForTimeout(3000);

  // Debug: check DOM after seed
  diag = await getDiagnostics(window);
  console.log('After seed:');
  console.log(`  rootExists: ${diag.data.rootExists}`);
  console.log(`  rootHTML: ${diag.data.rootHTML.substring(0, 200)}`);
  console.log(`  bodyChildren: ${diag.data.bodyChildren}`);
  console.log(`  innerHeight: ${diag.data.innerHeight}`);
  
  if (diag.logs.length > 0) {
    console.log('Console logs:');
    diag.logs.forEach(l => console.log(`  ${l}`));
  }

  if (!diag.data.rootExists) {
    console.error('CRITICAL: #root element not found. Aborting.');
    await electronApp.close();
    return;
  }

  // ── STATE 1: MAXIMIZED ──────────────────────────────────────
  printSection('STATE 1: MAXIMIZED');
  await window.waitForTimeout(1000);
  diag = await getDiagnostics(window);
  console.log(`  innerHeight: ${diag.data.innerHeight}`);

  // ── STATE 2: FULLSCREEN via F11 ─────────────────────────────
  printSection('STATE 2: FULLSCREEN (F11)');
  await window.keyboard.press('F11');
  await window.waitForTimeout(1500);
  diag = await getDiagnostics(window);
  console.log(`  innerHeight: ${diag.data.innerHeight}`);

  // ── STATE 3: EXIT FULLSCREEN ────────────────────────────────
  printSection('STATE 3: EXIT FULLSCREEN (F11)');
  await window.keyboard.press('F11');
  await window.waitForTimeout(1500);
  diag = await getDiagnostics(window);
  console.log(`  innerHeight: ${diag.data.innerHeight}`);

  // ── STATE 4: KIOSK MODE ─────────────────────────────────────
  printSection('STATE 4: KIOSK MODE');
  await window.evaluate(() => { window.electronAPI?.toggleFrame(); });
  await window.waitForTimeout(1500);
  diag = await getDiagnostics(window);
  console.log(`  innerHeight: ${diag.data.innerHeight}`);

  // ── STATE 5: EXIT KIOSK ─────────────────────────────────────
  printSection('STATE 5: EXIT KIOSK');
  await window.evaluate(() => { window.electronAPI?.toggleFrame(); });
  await window.waitForTimeout(1500);
  diag = await getDiagnostics(window);
  console.log(`  innerHeight: ${diag.data.innerHeight}`);

  // ── STATE 6: KEY PAGES ──────────────────────────────────────
  printSection('STATE 6: KEY PAGES');
  const pages = [{ name: 'Dashboard', hash: '#/dashboard' }, { name: 'Orders', hash: '#/orders' }, { name: 'Kitchen', hash: '#/kitchen' }, { name: 'Billing', hash: '#/billing' }, { name: 'Products', hash: '#/products' }, { name: 'Customers', hash: '#/customers' }];
  for (const p of pages) {
    await window.evaluate((h) => { window.location.hash = h; }, p.hash);
    await window.waitForTimeout(1000);
    diag = await getDiagnostics(window);
    console.log(`  ${p.name}: innerHeight=${diag.data.innerHeight}, rootExists=${diag.data.rootExists}`);
  }

  // ── CLEANUP ──────────────────────────────────────────────────
  printSection('CLEANUP');
  await electronApp.close();
  console.log('Done.');
}

run().catch(err => {
  console.error('DIAGNOSTIC FAILED:', err);
  process.exit(1);
});
