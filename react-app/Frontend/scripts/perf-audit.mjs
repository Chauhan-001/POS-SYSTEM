import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function waitForServer(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      import(url.startsWith('https') ? 'https' : 'http').then((mod) => {
        const req = mod.default.get(url, (res) => { res.resume(); resolve(); });
        req.on('error', () => {
          if (Date.now() - start > timeout) reject(new Error('Server start timeout'));
          else setTimeout(check, 300);
        });
        req.end();
      });
    };
    check();
  });
}

function grade(val, good, average) {
  if (val <= good) return `${val} ✅`;
  if (val <= average) return `${val} ⚠️`;
  return `${val} ❌`;
}

async function runAudit() {
  console.log('🚀 Building project...');
  const build = spawn('npx', ['vite', 'build'], { cwd: projectRoot, stdio: 'pipe', shell: true });
  await new Promise((resolve) => build.on('close', resolve));

  console.log('📦 Starting preview server...');
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '0.0.0.0'], { cwd: projectRoot, stdio: 'pipe', shell: true });
  const URL = 'http://localhost:4173';

  try {
    await waitForServer(URL);
    console.log('✅ Server ready at', URL);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Track console errors
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ================================================================
    // 1. LOAD METRICS (Navigation Timing + Paint)
    // ================================================================
    console.log('\n📊 === LOAD PERFORMANCE ===');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait extra for LCP and font loading
    await page.waitForTimeout(2000);

    const loadMetrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      return {
        domContentLoaded: nav.domContentLoadedEventEnd,
        loadComplete: nav.loadEventEnd,
        domInteractive: nav.domInteractive,
        firstPaint: paints.find(e => e.name === 'first-paint')?.startTime ?? null,
        firstContentfulPaint: paints.find(e => e.name === 'first-contentful-paint')?.startTime ?? null,
      };
    });

    const lcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        let lastLcp = null;
        const obs = new PerformanceObserver((list) => {
          lastLcp = list.getEntries().at(-1)?.startTime ?? null;
        });
        obs.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => { obs.disconnect(); resolve(lastLcp); }, 4000);
      });
    });
    loadMetrics.largestContentfulPaint = lcp;

    console.log(`  DOM Content Loaded:   ${loadMetrics.domContentLoaded?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`  Load Complete:        ${loadMetrics.loadComplete?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`  First Paint:          ${loadMetrics.firstPaint?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`  First Contentful:     ${loadMetrics.firstContentfulPaint?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`  Largest Contentful:   ${loadMetrics.largestContentfulPaint?.toFixed(1) ?? 'N/A'}ms`);

    // ================================================================
    // 2. LAYOUT STABILITY (CLS)
    // ================================================================
    console.log('\n📐 === LAYOUT STABILITY ===');
    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) clsValue += entry.value;
          }
        });
        obs.observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => { obs.disconnect(); resolve(clsValue); }, 4000);
      });
    });
    console.log(`  Cumulative Layout Shift: ${cls.toFixed(4)}`);

    // ================================================================
    // 3. SCROLL FPS
    // ================================================================
    console.log('\n🎬 === SCROLL PERFORMANCE (FPS) ===');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const scrollFps = await page.evaluate(() => {
      return new Promise((resolve) => {
        const frameDurations = [];
        let lastTime = performance.now();
        let rafId;
        const TOTAL_FRAMES = 120;

        const measure = (time) => {
          const delta = time - lastTime;
          if (delta > 0 && delta < 100) { // ignore outliers (>10fps = 100ms)
            frameDurations.push(delta);
          }
          lastTime = time;
          window.scrollBy(0, 150);

          if (frameDurations.length < TOTAL_FRAMES) {
            rafId = requestAnimationFrame(measure);
          } else {
            cancelAnimationFrame(rafId);
            const total = frameDurations.reduce((a, b) => a + b, 0);
            const avgMs = total / frameDurations.length;
            const avgFps = 1000 / avgMs;
            const sorted = [...frameDurations].sort((a, b) => a - b);
            const p95 = sorted[Math.floor(sorted.length * 0.95)];
            const p99 = sorted[Math.floor(sorted.length * 0.99)];
            resolve({
              avgFrameMs: +avgMs.toFixed(2),
              avgFps: +avgFps.toFixed(1),
              minFps: +(1000 / sorted[sorted.length - 1]).toFixed(1),
              maxFps: +(1000 / sorted[0]).toFixed(1),
              p95Fps: +(1000 / p95).toFixed(1),
              p99Fps: +(1000 / p99).toFixed(1),
              framesCaptured: frameDurations.length,
            });
          }
        };
        rafId = requestAnimationFrame(measure);
      });
    });

    console.log(`  Frames captured:  ${scrollFps.framesCaptured}`);
    console.log(`  Avg frame time:   ${scrollFps.avgFrameMs}ms`);
    console.log(`  Avg FPS:          ${scrollFps.avgFps}`);
    console.log(`  Min FPS:          ${scrollFps.minFps}`);
    console.log(`  Max FPS:          ${scrollFps.maxFps}`);
    console.log(`  P95 FPS:          ${scrollFps.p95Fps}`);
    console.log(`  P99 FPS:          ${scrollFps.p99Fps}`);

    // ================================================================
    // 4. SCROLL THROUGHPUT - measure how long scrollTo takes
    // ================================================================
    console.log('\n🔄 === SCROLL-DRIVEN ANIMATION PERFORMANCE ===');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const scrollHeight = await page.evaluate(() =>
      document.documentElement.scrollHeight - window.innerHeight
    );

    const scrollTiming = await page.evaluate((docH) => {
      const steps = 8;
      const segment = docH / steps;
      const timings = [];
      for (let i = 1; i <= steps; i++) {
        const target = Math.round(segment * i);
        const start = performance.now();
        window.scrollTo({ top: target, behavior: 'instant' });
        timings.push({ scrollPos: target, elapsedMs: +(performance.now() - start).toFixed(2) });
      }
      return timings;
    }, scrollHeight);

    const viewports = (scrollHeight / 900).toFixed(1);
    console.log(`  Page scroll height: ${scrollHeight}px (~${viewports} viewports)`);
    scrollTiming.forEach(t => {
      console.log(`  Scroll to ${String(t.scrollPos).padStart(6)}px: ${t.elapsedMs}ms layout`);
    });

    // ================================================================
    // 5. BROWSER METRICS (Post-scroll heap + nodes)
    // ================================================================
    console.log('\n⚙️ === BROWSER METRICS ===');
    let browserMetrics = { JSHeapUsedSize: 0, Nodes: 0, LayoutDuration: 0, RecalcStyleDuration: 0, Tasks: 0, TaskDuration: 0 };
    try {
      const cdp = await context.newCDPSession(page);
      const result = await cdp.send('Performance.getMetrics');
      const metrics = {};
      result.metrics.forEach(m => metrics[m.name] = m.value);
      browserMetrics = {
        JSHeapUsedSize: metrics.JSHeapUsedSize ?? 0,
        Nodes: metrics.Nodes ?? 0,
        LayoutDuration: (metrics.LayoutDuration ?? 0) * 1000,
        RecalcStyleDuration: (metrics.RecalcStyleDuration ?? 0) * 1000,
        Tasks: metrics.Tasks ?? 0,
        TaskDuration: (metrics.TaskDuration ?? 0) * 1000,
      };
    } catch (e) {
      console.log('  (CDP metrics unavailable, using performance.timing estimate)');
      browserMetrics = await page.evaluate(() => ({
        JSHeapUsedSize: (performance?.memory?.usedJSHeapSize ?? 0),
        Nodes: document.querySelectorAll('*').length,
        LayoutDuration: 0,
        RecalcStyleDuration: 0,
        Tasks: 0,
        TaskDuration: 0,
      }));
    }
    console.log(`  JS Heap:         ${(browserMetrics.JSHeapUsedSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  DOM Nodes:       ${browserMetrics.Nodes}`);
    console.log(`  Layout dur:      ${browserMetrics.LayoutDuration.toFixed(1)}ms`);
    console.log(`  Recalc style:    ${browserMetrics.RecalcStyleDuration.toFixed(1)}ms`);
    console.log(`  Task duration:   ${browserMetrics.TaskDuration.toFixed(1)}ms`);

    // ================================================================
    // 6. WILL-CHANGE VERIFICATION
    // ================================================================
    console.log('\n📝 === WILL-CHANGE VERIFICATION ===');
    const animElements = await page.evaluate(() => {
      const selectors = [
        '[data-hero-mask]', '[data-banner-content]',
        '[data-reveal="title"]', '[data-reveal="btn"]',
        '[data-stat-card]', '[data-section-overlay]',
        '[data-reveal-direction]', '[data-burst-img]', '[data-move-img]',
        '[data-move-rings]',
      ];
      const res = {};
      selectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) {
          const s = window.getComputedStyle(el);
          res[sel] = { willChange: s.willChange, opacity: s.opacity, transform: s.transform !== 'none' };
        }
      });
      return res;
    });
    for (const [sel, info] of Object.entries(animElements)) {
      console.log(`  ${sel.padEnd(30)} willChange: ${(info.willChange || 'auto').padEnd(20)} opacity: ${info.opacity}`);
    }

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log('\n══════════════════════════════════════');
    console.log('📋  PERFORMANCE AUDIT SUMMARY');
    console.log('══════════════════════════════════════');
    const fcp = loadMetrics.firstContentfulPaint ?? 9999;
    const lcpV = loadMetrics.largestContentfulPaint ?? 9999;
    const fps = +scrollFps.avgFps;
    console.log(`  FCP     ${grade(fcp, 1800, 3000)}  (target: <1.8s)`);
    console.log(`  LCP     ${grade(lcpV, 2500, 4000)}  (target: <2.5s)`);
    console.log(`  CLS     ${grade(cls, 0.1, 0.25)}  (target: <0.1)`);
    console.log(`  FPS     ${grade(fps, 55, 30)}  (target: >55)`);
    console.log(`  Heap    ${(browserMetrics.JSHeapUsedSize / 1024 / 1024).toFixed(1)} MB  (target: <5 MB)`);
    console.log(`  Nodes   ${browserMetrics.Nodes}  (target: <1500)`);
    console.log(`  Errors  ${consoleErrors.length === 0 ? '✅ None' : `❌ ${consoleErrors.length}`}`);

    // Save report
    const report = {
      timestamp: new Date().toISOString(),
      url: URL,
      viewport: '1440x900',
      loadMetrics, cls, scrollFps, scrollTiming, scrollHeight,
      browserMetrics: {
        jsHeap: browserMetrics.JSHeapUsedSize,
        nodes: browserMetrics.Nodes,
        layoutDuration: browserMetrics.LayoutDuration,
        recalcStyleDuration: browserMetrics.RecalcStyleDuration,
        taskDuration: browserMetrics.TaskDuration,
      },
      animElements,
      consoleErrors,
    };
    const reportPath = path.join(projectRoot, 'scripts', 'perf-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 Full report: ${reportPath}`);

    await browser.close();
    server.kill();

  } catch (err) {
    console.error('❌ Audit failed:', err);
    server.kill();
    process.exit(1);
  }
}

runAudit();
