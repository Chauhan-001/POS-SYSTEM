/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PublicStorePage — the customer-facing loyalty storefront served at
 * /public/:token (the URL encoded in the POS/dashboard QR codes).
 *
 * Frameless single-file page (inline CSS/JS) so no build step or static asset
 * copy is needed across dev (src/) and production (dist/) layouts. Because the
 * app-level helmet CSP forbids inline scripts, this route overrides the CSP for
 * THIS ONE response — the POS/admin dashboards are unaffected.
 */

import { Request, Response } from 'express';

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function storeScript(): string {
  return `
(function () {
  var root = document.getElementById('store-root');
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  function money(n) { return n.toLocaleString('en-IN'); }
  function offerTag(o) {
    switch (o.type) {
      case 'percentage': return o.value + '% OFF';
      case 'flat': return '\\u20B9' + money(o.value) + ' OFF';
      case 'free_item': return 'FREE ITEM';
      case 'cashback': return 'CASHBACK';
      case 'reward_points': return money(o.value) + ' PTS';
      case 'festival': return 'FESTIVE';
      case 'loyalty_bonus': return 'BONUS';
      default: return 'OFFER';
    }
  }
  function rewardLine(r) {
    switch (r.type) {
      case 'flat': return '\\u20B9' + money(r.value) + ' off your bill';
      case 'percentage': return r.value + '% off your bill';
      case 'item': return r.itemName || r.title;
      default: return r.title;
    }
  }
  fetch('/api/public-store/' + encodeURIComponent(window.__STORE_TOKEN__), { headers: { 'Accept': 'application/json' } })
    .then(function (res) { if (!res.ok) throw new Error('store-offline'); return res.json(); })
    .then(render)
    .catch(function () { root.innerHTML = '<p style="padding:40px;text-align:center;color:#8890a3">This store is taking a short break \\u2014 please try again shortly.</p>'; });

  function render(cfg) {
    var s = cfg.store || {}, l = cfg.loyalty || { enabled: false, earned: { pointsPerCurrency: 1, currencyUnit: 10 }, tiers: [] };
    var rates = l.earnRate || { pointsPerCurrency: 1, currencyUnit: 10 };
    var tiers = l.tiers || [], rewards = cfg.rewards || [], offers = cfg.offers || [];
    var sym = s.currencySymbol || '\\u20B9';
    var earnLine = rates.pointsPerCurrency;
    var html = '';

    html += '<header class="head"><div class="brand">'
      + (s.logoUrl ? '<img class="logo" alt="" src="' + esc(s.logoUrl) + '"/>' : '<span class="logo-fallback">' + esc((s.name || 'R').charAt(0).toUpperCase()) + '</span>')
      + '<div><h1>' + esc(s.name) + '</h1><p class="tagline">' + esc(s.tagline || 'Loyalty rewards program') + '</p></div></div>'
      + (s.location ? '<p class="place">' + esc(s.location) + '</p>' : '')
      + '</header>';

    html += '<section class="hero"><div class="hero-badge">EARN POINTS</div><h2>Scan. Enjoy.<br/>Redeem.</h2><p class="hero-sub">'
      + (l.enabled ? 'Every visit earns points you can turn into rewards at the counter.' : 'Join at the counter and start collecting points today.')
      + '</p>';
    if (l.enabled) html += '<div class="rate-chip">Earn <b> ' + (earnLine === 1 ? '1 point' : earnLine + ' points') + '</b> for every <b>' + sym + (rates.currencyUnit || 10) + '</b> spent</div>';
    html += '</section>';

    html += '<section class="section"><h3>How it works</h3><ol class="steps">'
      + '<li><b>1</b><span>Scan this QR when you visit</span></li>'
      + '<li><b>2</b><span>Give your phone number — points are added</span></li>'
      + '<li><b>3</b><span>Redeem points for rewards</span></li>'
      + '</ol></section>';

    if (rewards.length) {
      html += '<section class="section"><h3>Rewards</h3><div class="grid">';
      rewards.forEach(function (r) {
        html += '<article class="card"><div class="cost-row"><span class="pts"><b>' + money(r.pointsRequired) + '</b> pts</span></div><h4>' + esc(r.title) + '</h4><p>' + esc(rewardLine(r)) + '</p>'
          + (r.stockLeft !== null && r.stockLeft !== undefined ? '<span class="stock' + (r.stockLeft <= 2 ? ' low' : '') + '">' + (r.stockLeft <= 0 ? 'Out of stock' : money(r.stockLeft) + ' left') + '</span>' : '')
          + '</article>';
      });
      html += '</div></section>';
    }

    if (offers.length) {
      html += '<section class="section"><h3>Today&#39;s offers</h3><div class="offers">';
      offers.forEach(function (o) {
        html += '<div class="offer"><div class="offer-tag">' + offerTag(o) + '</div><div class="offer-body"><h5>' + esc(o.title) + '</h5><p>' + esc(o.shortDescription || o.description || '') + '</p>'
          + (o.couponCode ? '<p class="code">Code: <b>' + esc(o.couponCode) + '</b></p>' : '')
          + '</div></div>';
      });
      html += '</div></section>';
    }

    if (tiers.length > 1) {
      html += '<section class="section"><h3>Membership tiers</h3><div class="tiers">';
      tiers.forEach(function (t) {
        html += '<div class="tier"><span class="tier-name">' + esc(t.name) + '</span><span class="tier-threshold">' + sym + money(t.minLifetimeSpend || 0) + '+ spend</span><span class="tier-mult">' + (t.multiplier || 1) + '\\u00D7 points</span></div>';
      });
      html += '</div></section>';
    }

    html += '<footer class="foot">' + esc(s.name) + ' \\u00A9 ' + new Date().getFullYear() + '</footer>';
    root.innerHTML = html;
  }
})();
`;
}

function buildPage(publicToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b1f3a" />
<title>Rewards — Scan &amp; Earn</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; background:#eef1f6; color:#12233f; line-height:1.45; min-height:100vh; }
  #document-root { max-width:520px; margin:0 auto; background:#fff; min-height:100vh; }
  .head { background:linear-gradient(135deg,#0b1f3a 0%,#123a63 60%,#1b5e8e 100%); color:#fff; padding:28px 22px 22px; }
  .brand { display:flex; align-items:center; gap:14px; }
  .logo { width:54px; height:54px; border-radius:14px; object-fit:cover; background:rgba(255,255,255,.12); }
  .logo-fallback { width:54px; height:54px; border-radius:14px; background:rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center; font-size:26px; font-weight:800; }
  .brand h1 { font-size:20px; letter-spacing:.3px; }
  .tagline { font-size:12px; opacity:.8; margin-top:2px; }
  .place { font-size:12px; opacity:.75; margin-top:12px; font-weight:600; }
  .hero { padding:28px 22px 24px; }
  .hero-badge { display:inline-block; font-size:10px; font-weight:800; letter-spacing:1.4px; color:#1b5e8e; background:#e8f1fa; padding:5px 11px; border-radius:999px; }
  .hero h2 { font-size:32px; line-height:1.1; margin:12px 0 8px; font-weight:800; }
  .hero-sub { font-size:14px; color:#4a5a72; }
  .rate-chip { display:inline-flex; margin-top:16px; background:#eef7ff; border:1px solid #cfe6f8; color:#0b3a63; font-size:13px; font-weight:600; padding:10px 14px; border-radius:14px; gap:4px; }
  .rate-chip b { color:#0b1f3a; }
  .section { padding:4px 22px 24px; }
  .section h3 { font-size:13px; letter-spacing:1px; text-transform:uppercase; color:#54657e; margin-bottom:14px; font-weight:800; }
  .steps { list-style:none; display:flex; gap:12px; }
  .steps li { flex:1; background:#f4f6fb; border:1px solid #e4e9f2; border-radius:14px; padding:14px 10px; font-size:11px; color:#3d4d63; font-weight:600; }
  .steps b { display:flex; width:26px; height:26px; background:#1b5e8e; color:#fff; border-radius:50%; align-items:center; justify-content:center; font-size:12px; margin-bottom:8px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .card { background:#fff; border:1px solid #e6eaf2; border-radius:16px; padding:16px; box-shadow:0 2px 8px rgba(20,40,80,.05); }
  .pts { font-weight:800; font-size:20px; color:#0b1f3a; }
  .pts b { color:#1b5e8e; }
  .card h4 { font-size:13px; margin-top:8px; font-weight:800; }
  .card p { font-size:11px; color:#66788f; margin-top:3px; }
  .stock { display:inline-block; margin-top:10px; font-size:10px; font-weight:700; color:#1b8a5a; background:#eafaf1; padding:3px 8px; border-radius:999px; }
  .stock.low { color:#c2410c; background:#fdf0e3; }
  .offers { display:flex; flex-direction:column; gap:10px; }
  .offer { display:flex; gap:12px; align-items:flex-start; background:#fbfcff; border:1px solid #e6e9f2; border-radius:14px; padding:14px; }
  .offer-tag { flex-shrink:0; font-size:10px; font-weight:800; color:#1b5e8e; background:#e8f1fa; padding:6px 9px; border-radius:8px; }
  .offer-body h5 { font-size:13px; font-weight:800; }
  .offer p { font-size:11px; color:#66788f; margin-top:3px; }
  .code b { color:#0b7a3e; }
  .tiers { display:flex; gap:10px; overflow-x:auto; padding-bottom:6px; }
  .tier { flex:0 0 150px; background:#fff; border:1px solid #e6e9f2; border-radius:14px; padding:14px; }
  .tier-name { font-weight:800; font-size:13px; display:block; }
  .tier-threshold, .tier-mult { display:block; font-size:11px; color:#66788f; margin-top:4px; }
  .foot { padding:24px 22px 40px; text-align:center; font-size:11px; color:#8a97ab; }
  #store-root { min-height:240px; }
</style>
</head>
<body>
<div id="document-root">
  <main id="store-root"><p style="padding:40px;text-align:center;color:#94a3b8">Loading…</p></main>
</div>
<script type="text/javascript">window.__STORE_TOKEN__ = ${JSON.stringify(publicToken)};${storeScript()}</script>
</body>
</html>`;
}

/**
 * GET /public/:token — customer-facing store page.
 * Overrides CSP for THIS route only (inline store script), then serves the page.
 */
export function renderPublicStorePage(req: Request, res: Response): void {
  const token = String(req.params.token || '');
  if (!/^pbl_[A-Za-z0-9]{10,64}$/.test(token)) {
    res.status(404).send('Store not found');
    return;
  }
  res.set('Content-Security-Policy', PAGE_CSP);
  res.set('Cache-Control', 'public, max-age=60');
  res.set('X-Robots-Tag', 'noindex');
  res.type('html').send(buildPage(token));
}