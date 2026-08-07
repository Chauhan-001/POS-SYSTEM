/**
 * Runtime Layout Diagnostic Runner
 *
 * Launches the Electron POS app, seeds test data, and captures
 * ALL viewport/layout metrics across every window state.
 *
 * Usage: node electron/diagnostic-runner.mjs
 * Requires: backend + Frontend dev servers running
 */

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_CODE = `
  (() => {
    const s = window.localStorage;
    s.setItem('pos_employees', JSON.stringify([{id:'emp_owner',username:'owner',name:'Rajesh Kumar',role:'Owner',pin:'1111',status:'Active',branchId:'branch_main',lastLogin:'2026-07-20 09:15 AM'}]));
    s.setItem('pos_products', JSON.stringify([{id:'p1',code:'PZA01',name:'Margherita Pizza',category:'Pizzas',price:249,image:'',availability:true,favorite:true,gst:5},{id:'p2',code:'BRG01',name:'Classic Burger',category:'Burgers',price:179,image:'',availability:true,favorite:false,gst:5},{id:'p3',code:'PST01',name:'White Sauce Pasta',category:'Pasta',price:199,image:'',availability:true,favorite:false,gst:5}]));
    s.setItem('pos_categories', JSON.stringify(['Pizzas','Burgers','Pasta','Beverages','Desserts','Appetizers']));
    s.setItem('pos_category_colors', JSON.stringify({'Pizzas':'#ef4444','Burgers':'#f59e0b','Pasta':'#10b981','Beverages':'#0ea5e9','Desserts':'#ec4899','Appetizers':'#f97316'}));
    s.setItem('pos_customers', JSON.stringify([{id:'c1',name:'Amit Sharma',phone:'9876543210',email:'amit@example.com',totalVisits:15,totalSpent:5200,points:350,createdAt:'2026-01-15'}]));
    s.setItem('pos_rewards', JSON.stringify([{id:'r1',type:'percentage',title:'10% Off',value:10,pointsRequired:100,isActive:true}]));
    s.setItem('pos_settings', JSON.stringify({restaurantName:'Test Bistro',currencySymbol:'₹',defaultTaxRate:5,gstRate:5,enableGst:true,printerSize:'80mm',enableKitchenDisplay:true,enableTableService:true,enableDeliveryModule:true,enableOnlineOrders:true,enableLoyalty:true,showImagesInBilling:false}));
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
  })();
`;

async function getMetrics(page) {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const docBody = document.body;
    const rootEl = document.getElementById('root');
    const appRoot = document.querySelector('#root > div');
    const titleBar = document.querySelector('[class*="bg-[#191b23]"]');
    const sidebar = document.querySelector('aside');
    const mainContent = document.querySelector('main');
    const workspaceArea = mainContent?.querySelector('> div');

    const getRect = (el) => el ? {
      tag: el.tagName,
      className: el.className.substring(0, 120),
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      boundingBox: (() => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; })(),
      computedHeight: getComputedStyle(el).height,
      overflow: getComputedStyle(el).overflow,
    } : null;

    const vp = window.visualViewport;

    return {
      timestamp: Date.now(),
      // window dimensions
      window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight },
      // visual viewport
      visualViewport: vp ? { width: vp.width, height: vp.height, offsetTop: vp.offsetTop, offsetLeft: vp.offsetLeft, scale: vp.scale } : null,
      // screen
      screen: { width: window.screen.width, height: window.screen.height, availWidth: window.screen.availWidth, availHeight: window.screen.availHeight },
      // DPR
      devicePixelRatio: window.devicePixelRatio,
      // document
      document: { clientWidth: root.clientWidth, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight, offsetHeight: root.offsetHeight, scrollWidth: root.scrollWidth },
      // body
      body: { clientWidth: docBody?.clientWidth, clientHeight: docBody?.clientHeight, scrollHeight: docBody?.scrollHeight },
      // #root
      root: getRect(rootEl),
      // app root div (first child of #root)
      app: getRect(appRoot),
      // title bar
      titleBar: getRect(titleBar),
      // sidebar
      sidebar: getRect(sidebar),
      // main content
      main: getRect(mainContent),
      // workspace content
      workspace: getRect(workspaceArea),
      // scroll
      bodyOverflow: getComputedStyle(docBody).overflow,
      rootOverflow: getComputedStyle(root).overflow,
      // violations
      exceedsViewport: (() => {
        const issues = [];
        if (appRoot) {
          const ab = appRoot.getBoundingClientRect();
          if (ab.bottom > window.innerHeight + 1) issues.push(`appRoot bottom (${ab.bottom}) exceeds viewport height (${window.innerHeight})`);
          if (ab.right > window.innerWidth + 1) issues.push(`appRoot right (${ab.right}) exceeds viewport width (${window.innerWidth})`);
        }
        if (mainContent) {
          const mb = mainContent.getBoundingClientRect();
          if (mb.bottom > window.innerHeight + 1) issues.push(`main bottom (${mb.bottom}) exceeds viewport height (${window.innerHeight})`);
        }
        if (titleBar) {
          const tb = titleBar.getBoundingClientRect();
          if (tb.top < -1 || tb.top > 2) issues.push(`titleBar top (${tb.top}) not at viewport top`);
        }
        const bodyScrollH = docBody?.scrollHeight;
        if (bodyScrollH && bodyScrollH > window.innerHeight + 2) issues.push(`body.scrollHeight (${bodyScrollH}) > viewport height (${window.innerHeight}) — possible overflow`);
        const rootScrollH = root.scrollHeight;
        if (rootScrollH > window.innerHeight + 2) issues.push(`html.scrollHeight (${rootScrollH}) > viewport height (${window.innerHeight}) — possible overflow`);
        return issues;
      })(),
      hasVisibleScrollbar: (() => {
        const bodyScrollW = docBody ? docBody.scrollWidth - docBody.clientWidth : 0;
        const rootScrollW = root.scrollWidth - root.clientWidth;
        return rootScrollW > 5 || bodyScrollW > 5;
      })(),
    };
  });
}

function printSection(title) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(78)}`);
}

function printMetrics(label, metrics) {
  console.log(`\n--- ${label} ---`);
  console.log(`  Timestamp:              ${metrics.timestamp}`);
  console.log(`  DPR:                    ${metrics.devicePixelRatio}`);
  console.log(`  window.inner:           ${metrics.window.innerWidth} x ${metrics.window.innerHeight}`);
  console.log(`  window.outer:           ${metrics.window.outerWidth} x ${metrics.window.outerHeight}`);
  console.log(`  visualViewport:         ${metrics.visualViewport?.width} x ${metrics.visualViewport?.height}`);
  console.log(`  screen:                 ${metrics.screen.width} x ${metrics.screen.height} (avail: ${metrics.screen.availWidth} x ${metrics.screen.availHeight})`);
  console.log(`  document.client:        ${metrics.document.clientWidth} x ${metrics.document.clientHeight}`);
  console.log(`  document.scroll:        ${metrics.document.scrollWidth} x ${metrics.document.scrollHeight}`);

  for (const [name, el] of Object.entries({ root: metrics.root, app: metrics.app, titleBar: metrics.titleBar, sidebar: metrics.sidebar, main: metrics.main, workspace: metrics.workspace })) {
    if (!el) { console.log(`  ${name}:              null`); continue; }
    const b = el.boundingBox;
    console.log(`  ${name}:              ${el.offsetWidth} x ${el.offsetHeight} (scroll: ${el.scrollWidth} x ${el.scrollHeight}), box: [${b.left}, ${b.top}] -> [${b.right}, ${b.bottom}], computedHeight: ${el.computedHeight}, overflow: ${el.overflow}`);
  }

  console.log(`  body.overflow:          ${metrics.bodyOverflow}`);
  console.log(`  html.overflow:          ${metrics.rootOverflow}`);
  console.log(`  hasVisibleScrollbar:    ${metrics.hasVisibleScrollbar}`);

  if (metrics.exceedsViewport.length > 0) {
    console.log(`  ⚠️  EXCEEDS VIEWPORT:`);
    for (const issue of metrics.exceedsViewport) {
      console.log(`      - ${issue}`);
    }
  } else {
    console.log(`  ✅ No viewport violations`);
  }
}

async function run() {
  printSection('LAUNCHING ELECTRON');

  const electronApp = await electron.launch({
    args: [path.join(__dirname, 'main.js'), '--dev'],
    env: { ...process.env, NODE_ENV: 'development' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('networkidle');

  // Seed localStorage
  await window.evaluate(SEED_CODE);
  await window.reload();
  await window.waitForLoadState('networkidle');
  // Wait for React to mount and layout to settle
  await window.waitForTimeout(2000);

  printSection('STATE 1: WINDOWED (DEFAULT AFTER MAXIMIZE)');
  let metrics = await getMetrics(window);
  printMetrics('Windowed', metrics);

  // Log computed CSS for app root
  const computedCSS = await window.evaluate(() => {
    const appRoot = document.querySelector('#root > div');
    if (!appRoot) return 'null';
    const cs = getComputedStyle(appRoot);
    return {
      display: cs.display,
      height: cs.height,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      overflow: cs.overflow,
      flexDirection: cs.flexDirection,
      flex: cs.flex,
    };
  });
  console.log(`\n  App root computed CSS: ${JSON.stringify(computedCSS, null, 4)}`);

  const rootCSS = await window.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return 'null';
    const cs = getComputedStyle(root);
    return {
      display: cs.display,
      height: cs.height,
      minHeight: cs.minHeight,
      overflow: cs.overflow,
      flexDirection: cs.flexDirection,
    };
  });
  console.log(`  #root computed CSS: ${JSON.stringify(rootCSS, null, 4)}`);

  // ── STATE 2: F11 FULLSCREEN ──────────────────────────────────
  printSection('STATE 2: F11 FULLSCREEN (setFullScreen true)');
  await electronApp.evaluate(({ electron }) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (win) win.setFullScreen(true);
  });
  await window.waitForTimeout(1500);
  metrics = await getMetrics(window);
  printMetrics('F11 Fullscreen', metrics);

  // ── STATE 3: EXIT FULLSCREEN (BACK TO MAXIMIZED) ────────────
  printSection('STATE 3: EXIT FULLSCREEN (back to maximized)');
  await electronApp.evaluate(({ electron }) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (win) win.setFullScreen(false);
  });
  await window.waitForTimeout(1500);
  metrics = await getMetrics(window);
  printMetrics('After fullscreen exit', metrics);

  // ── STATE 4: KIOSK MODE ─────────────────────────────────────
  printSection('STATE 4: KIOSK MODE (toggleFrame)');
  await window.evaluate(() => {
    window.electronAPI.toggleFrame();
  });
  await window.waitForTimeout(1500);
  metrics = await getMetrics(window);
  printMetrics('Kiosk mode', metrics);

  // ── STATE 5: EXIT KIOSK ─────────────────────────────────────
  printSection('STATE 5: EXIT KIOSK (toggleFrame)');
  await window.evaluate(() => {
    window.electronAPI.toggleFrame();
  });
  await window.waitForTimeout(1500);
  metrics = await getMetrics(window);
  printMetrics('After kiosk exit', metrics);

  // ── STATE 6: NAVIGATE TO KEY PAGES ──────────────────────────
  printSection('STATE 6: PAGE NAVIGATION (maximized)');
  const pages = ['dashboard', 'orders', 'kitchen', 'billing', 'products', 'customers', 'staff', 'more'];
  for (const pageName of pages) {
    console.log(`\n--- Navigate to ${pageName} ---`);
    await window.evaluate((hash) => { window.location.hash = '#' + hash; }, pageName === 'dashboard' ? '/dashboard' : '/' + pageName);
    await window.waitForTimeout(800);
    // Wait for login screen to disappear
    await window.waitForFunction(() => !document.getElementById('login_screen_container'), { timeout: 5000 }).catch(() => {});
    await window.waitForTimeout(400);
    const m = await getMetrics(window);
    const appRect = m.app ? m.app.boundingBox : null;
    const mainRect = m.main ? m.main.boundingBox : null;
    const issues = [];
    if (appRect && appRect.bottom > m.window.innerHeight + 1) issues.push(`app bottom clipped (${appRect.bottom} > ${m.window.innerHeight})`);
    if (mainRect && mainRect.bottom > m.window.innerHeight + 1) issues.push(`main bottom clipped (${mainRect.bottom} > ${m.window.innerHeight})`);
    console.log(`  viewport: ${m.window.innerWidth}x${m.window.innerHeight}, app: ${appRect ? `${appRect.width}x${appRect.height} [${appRect.top},${appRect.bottom}]` : 'N/A'}, main: ${mainRect ? `${mainRect.width}x${mainRect.height} [${mainRect.top},${mainRect.bottom}]` : 'N/A'}`);
    if (issues.length > 0) { console.log(`  ⚠️  ISSUES: ${issues.join(', ')}`); }
    else { console.log(`  ✅  OK — within viewport`); }
    if (m.exceedsViewport.length > 0) {
      console.log(`  ⚠️  Violations: ${m.exceedsViewport.join('; ')}`);
    }
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
