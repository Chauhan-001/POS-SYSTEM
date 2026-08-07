import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function waitForAppWindow(electronApp, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const windows = electronApp.windows();
    // Find a window that is NOT DevTools
    for (const w of windows) {
      const url = w.url();
      if (!url.startsWith('devtools://') && !url.startsWith('chrome-extension://')) {
        return w;
      }
    }
    // Also check new windows
    const firstNonDevTools = await new Promise((resolve) => {
      const handler = (w) => {
        const url = w.url();
        if (!url.startsWith('devtools://') && !url.startsWith('chrome-extension://')) {
          electronApp.removeListener('window', handler);
          resolve(w);
        }
      };
      electronApp.on('window', handler);
      setTimeout(() => {
        electronApp.removeListener('window', handler);
        resolve(null);
      }, 5000);
    });
    if (firstNonDevTools) return firstNonDevTools;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function run() {
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    env: { ...process.env, NODE_ENV: 'development' },
  });

  // Wait for the app window (skip DevTools)
  const window = await waitForAppWindow(electronApp);
  if (!window) {
    console.error('Could not find app window');
    await electronApp.close();
    return;
  }
  
  console.log(`App window URL: ${window.url()}`);

  // Collect ALL console output
  window.on('console', msg => console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`));
  window.on('pageerror', err => console.log(`[PAGE_ERROR] ${err.message}`));
  window.on('crash', () => console.log('[CRASH] Page crashed'));

  await window.waitForLoadState('networkidle');
  await window.waitForTimeout(5000);

  // Dump full DOM
  const domInfo = await window.evaluate(() => {
    const root = document.getElementById('root');
    const body = document.body;
    return {
      rootExists: !!root,
      rootHTML: root ? root.outerHTML.substring(0, 1000) : 'null',
      bodyChildrenCount: body ? body.children.length : -1,
      bodyChildrenTags: body ? Array.from(body.children).map(c => c.tagName + (c.id ? '#' + c.id : '') + (c.className ? '.' + c.className.substring(0, 40) : '')).join(' | ') : 'null',
      url: window.location.href,
      readyState: document.readyState,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    };
  });

  console.log('\n=== DOM INFO ===');
  console.log(`URL: ${domInfo.url}`);
  console.log(`readyState: ${domInfo.readyState}`);
  console.log(`rootExists: ${domInfo.rootExists}`);
  console.log(`viewport: ${domInfo.innerWidth} x ${domInfo.innerHeight}`);
  console.log(`bodyChildrenCount: ${domInfo.bodyChildrenCount}`);
  console.log(`bodyChildrenTags: ${domInfo.bodyChildrenTags}`);
  if (domInfo.rootExists) {
    console.log(`rootHTML: ${domInfo.rootHTML.substring(0, 500)}`);
  } else {
    console.log(`root NOT FOUND`);
  }

  await electronApp.close();
}

run().catch(err => {
  console.error('DIAGNOSTIC FAILED:', err);
  process.exit(1);
});
