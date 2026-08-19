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
 *
 * Phase: Campaign Studio → Website integration.
 * Now fetches active promotions and renders campaign placements:
 *   - Homepage Banner (hero area)
 *   - Offer Cards (offers section)
 *   - Popup (overlay on page load)
 *   - Floating Offer (persistent widget)
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
  var TOKEN = window.__STORE_TOKEN__;
  var API = '/api/public-store/' + encodeURIComponent(TOKEN);
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { var map = { '&':'&amp;','<':'&lt;','>':'&gt;',"\"":'&quot;',"'":'&#39;' }; return map[c] || c; }); }
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

  // Fetch store config + promotions in parallel
  Promise.all([
    fetch(API, { headers: { 'Accept': 'application/json' } }).then(function(r) { if (!r.ok) throw new Error('store-offline'); return r.json(); }),
    fetch(API + '/promotions', { headers: { 'Accept': 'application/json' } }).then(function(r) { if (!r.ok) return { promotions: [] }; return r.json(); }).catch(function() { return { promotions: [] }; })
  ]).then(function(results) {
    render(results[0], results[1]);
  }).catch(function() {
    root.innerHTML = '<p style="padding:40px;text-align:center;color:#8890a3">This store is taking a short break \\u2014 please try again shortly.</p>';
  });

  function render(cfg, promoData) {
    var s = cfg.store || {}, l = cfg.loyalty || { enabled: false, earned: { pointsPerCurrency: 1, currencyUnit: 10 }, tiers: [] };
    var rates = l.earnRate || { pointsPerCurrency: 1, currencyUnit: 10 };
    var tiers = l.tiers || [], rewards = cfg.rewards || [], offers = cfg.offers || [];
    var promos = (promoData && promoData.promotions) || [];
    var sym = s.currencySymbol || '\\u20B9';
    var earnLine = rates.pointsPerCurrency;
    var html = '';

    // ─── HEADER ───────────────────────────────────────────────────
    html += '<header class="head"><div class="brand">'
      + (s.logoUrl ? '<img class="logo" alt="" src="' + esc(s.logoUrl) + '"/>' : '<span class="logo-fallback">' + esc((s.name || 'R').charAt(0).toUpperCase()) + '</span>')
      + '<div><h1>' + esc(s.name) + '</h1><p class="tagline">' + esc(s.tagline || 'Loyalty rewards program') + '</p></div></div>'
      + (s.location ? '<p class="place">' + esc(s.location) + '</p>' : '')
      + '</header>';

    // ─── CAMPAIGN BANNER (from promotions with hero-banner template) ──
    var bannerPromos = promos.filter(function(p) {
      return p.templateId === 'hero-banner' && p.creative;
    });
    if (bannerPromos.length > 0) {
      var bp = bannerPromos[0];
      var cr = bp.creative || {};
      var bgColor = (cr.colors && cr.colors.background) || '#0b2a5b';
      var txtColor = (cr.colors && cr.colors.text) || '#ffffff';
      var accentColor = (cr.colors && cr.colors.accent) || '#f59e0b';
      html += '<section class="campaign-banner" style="background:' + esc(bgColor) + ';color:' + esc(txtColor) + '">';
      if (cr.imageKey || cr.imageSource) {
        var imgSrc = cr.imageSource || ('/api/media/' + encodeURIComponent(cr.imageKey));
        html += '<img class="campaign-banner-img" src="' + esc(imgSrc) + '" alt="' + esc(cr.title || '') + '" />';
      }
      html += '<div class="campaign-banner-content">';
      if (cr.subtitle) html += '<span class="campaign-badge" style="background:' + esc(accentColor) + ';color:' + esc(bgColor) + '">' + esc(cr.subtitle) + '</span>';
      html += '<h2>' + esc(cr.title || bp.name || 'Special Offer') + '</h2>';
      if (cr.description) html += '<p>' + esc(cr.description) + '</p>';
      html += '<button class="campaign-cta" style="background:' + esc(accentColor) + ';color:' + esc(bgColor) + '">' + esc(cr.cta || 'Order Now') + '</button>';
      html += '</div></section>';
    }

    // ─── EXISTING HERO (shown only when no campaign banner) ────────
    if (bannerPromos.length === 0) {
      html += '<section class="hero"><div class="hero-badge">EARN POINTS</div><h2>Scan. Enjoy.<br/>Redeem.</h2><p class="hero-sub">'
        + (l.enabled ? 'Every visit earns points you can turn into rewards at the counter.' : 'Join at the counter and start collecting points today.')
        + '</p>';
      if (l.enabled) html += '<div class="rate-chip">Earn <b> ' + (earnLine === 1 ? '1 point' : earnLine + ' points') + '</b> for every <b>' + sym + (rates.currencyUnit || 10) + '</b> spent</div>';
      html += '</section>';
    }

    html += '<section class="section"><h3>How it works</h3><ol class="steps">'
      + '<li><b>1</b><span>Scan this QR when you visit</span></li>'
      + '<li><b>2</b><span>Give your phone number \\u2014 points are added</span></li>'
      + '<li><b>3</b><span>Redeem points for rewards</span></li>'
      + '</ol></section>';

    // ─── CAMPAIGN OFFER CARDS (from promotions with offer-card template) ──
    var cardPromos = promos.filter(function(p) {
      return p.templateId === 'offer-card' && p.creative;
    });
    if (cardPromos.length > 0) {
      html += '<section class="section"><h3>Special Offers</h3><div class="campaign-cards">';
      cardPromos.forEach(function(cp) {
        var cr = cp.creative || {};
        var bgColor = (cr.colors && cr.colors.background) || '#ffffff';
        var txtColor = (cr.colors && cr.colors.text) || '#12233f';
        var accentColor = (cr.colors && cr.colors.accent) || '#1b5e8e';
        html += '<div class="campaign-card" style="border-color:' + esc(accentColor) + '20">';
        if (cr.imageKey || cr.imageSource) {
          var imgSrc = cr.imageSource || ('/api/media/' + encodeURIComponent(cr.imageKey));
          html += '<img class="campaign-card-img" src="' + esc(imgSrc) + '" alt="' + esc(cr.title || '') + '" />';
        }
        html += '<div class="campaign-card-body">';
        if (cr.subtitle) html += '<span class="campaign-card-tag" style="background:' + esc(accentColor) + '15;color:' + esc(accentColor) + '">' + esc(cr.subtitle) + '</span>';
        html += '<h4>' + esc(cr.title || cp.name || 'Offer') + '</h4>';
        if (cr.description) html += '<p>' + esc(cr.description) + '</p>';
        html += '<button class="campaign-card-cta" style="background:' + esc(accentColor) + ';color:#fff">' + esc(cr.cta || 'Order Now') + '</button>';
        html += '</div></div>';
      });
      html += '</div></section>';
    }

    // ─── MENU HIGHLIGHT (from promotions with square-creative template) ──
    var highlightPromos = promos.filter(function(p) {
      return p.templateId === 'square-creative' && p.creative;
    });
    if (highlightPromos.length > 0) {
      var hp = highlightPromos[0];
      var hcr = hp.creative || {};
      var hAccent = (hcr.colors && hcr.colors.accent) || '#f59e0b';
      html += '<section class="section campaign-highlight" style="border-left:4px solid ' + esc(hAccent) + '">';
      html += '<div class="highlight-inner">';
      if (hcr.imageKey || hcr.imageSource) {
        var hImg = hcr.imageSource || ('/api/media/' + encodeURIComponent(hcr.imageKey));
        html += '<img class="highlight-img" src="' + esc(hImg) + '" alt="" />';
      }
      html += '<div>';
      html += '<span class="highlight-badge" style="background:' + esc(hAccent) + '20;color:' + esc(hAccent) + '">\\u2B50 WEEKEND SPECIAL</span>';
      html += '<h4>' + esc(hcr.title || hp.name || 'Special') + '</h4>';
      if (hcr.description) html += '<p>' + esc(hcr.description) + '</p>';
      html += '<button class="highlight-cta" style="background:' + esc(hAccent) + ';color:#fff">' + esc(hcr.cta || 'Order Now') + '</button>';
      html += '</div></div></section>';
    }

    // ─── EXISTING REWARDS ──────────────────────────────────────────
    if (rewards.length) {
      html += '<section class="section"><h3>Rewards</h3><div class="grid">';
      rewards.forEach(function (r) {
        html += '<article class="card"><div class="cost-row"><span class="pts"><b>' + money(r.pointsRequired) + '</b> pts</span></div><h4>' + esc(r.title) + '</h4><p>' + esc(rewardLine(r)) + '</p>'
          + (r.stockLeft !== null && r.stockLeft !== undefined ? '<span class="stock' + (r.stockLeft <= 2 ? ' low' : '') + '">' + (r.stockLeft <= 0 ? 'Out of stock' : money(r.stockLeft) + ' left') + '</span>' : '')
          + '</article>';
      });
      html += '</div></section>';
    }

    // ─── EXISTING OFFERS ───────────────────────────────────────────
    if (offers.length) {
      html += '<section class="section"><h3>Today&#39;s offers</h3><div class="offers">';
      offers.forEach(function (o) {
        html += '<div class="offer"><div class="offer-tag">' + offerTag(o) + '</div><div class="offer-body"><h5>' + esc(o.title) + '</h5><p>' + esc(o.shortDescription || o.description || '') + '</p>'
          + (o.couponCode ? '<p class="code">Code: <b>' + esc(o.couponCode) + '</b></p>' : '')
          + '</div></div>';
      });
      html += '</div></section>';
    }

    // ─── TIERS ──────────────────────────────────────────────────────
    if (tiers.length > 1) {
      html += '<section class="section"><h3>Membership tiers</h3><div class="tiers">';
      tiers.forEach(function (t) {
        html += '<div class="tier"><span class="tier-name">' + esc(t.name) + '</span><span class="tier-threshold">' + sym + money(t.minLifetimeSpend || 0) + '+ spend</span><span class="tier-mult">' + (t.multiplier || 1) + '\\u00D7 points</span></div>';
      });
      html += '</div></section>';
    }

    html += '<footer class="foot">' + esc(s.name) + ' \\u00A9 ' + new Date().getFullYear() + '</footer>';
    root.innerHTML = html;

    // ─── POPUP (from promotions with mobile-banner template used as popup) ──
    var popupPromos = promos.filter(function(p) {
      return p.templateId === 'mobile-banner' && p.creative;
    });
    if (popupPromos.length > 0 && !sessionStorage.getItem('campaign_popup_dismissed')) {
      var pp = popupPromos[0];
      var pcr = pp.creative || {};
      var pBg = (pcr.colors && pcr.colors.background) || '#0b2a5b';
      var pTxt = (pcr.colors && pcr.colors.text) || '#ffffff';
      var pAcc = (pcr.colors && pcr.colors.accent) || '#f59e0b';
      var popupHtml = '<div class="campaign-popup-overlay" id="campaign-popup">'
        + '<div class="campaign-popup" style="background:' + esc(pBg) + ';color:' + esc(pTxt) + '">'
        + '<button class="campaign-popup-close" onclick="document.getElementById(\'campaign-popup\').style.display=\'none\';sessionStorage.setItem(\'campaign_popup_dismissed\',\'1\')">&times;</button>'
        + '<div class="campaign-popup-content">';
      if (pcr.imageKey || pcr.imageSource) {
        var popImg = pcr.imageSource || ('/api/media/' + encodeURIComponent(pcr.imageKey));
        popupHtml += '<img src="' + esc(popImg) + '" alt="" class="campaign-popup-img" />';
      }
      popupHtml += '<h3>' + esc(pcr.title || pp.name || 'Special Offer') + '</h3>';
      if (pcr.subtitle) popupHtml += '<span class="campaign-badge" style="background:' + esc(pAcc) + ';color:' + esc(pBg) + '">' + esc(pcr.subtitle) + '</span>';
      if (pcr.description) popupHtml += '<p>' + esc(pcr.description) + '</p>';
      popupHtml += '<button class="campaign-cta" style="background:' + esc(pAcc) + ';color:' + esc(pBg) + '">' + esc(pcr.cta || 'Order Now') + '</button>';
      popupHtml += '</div></div></div>';
      document.body.insertAdjacentHTML('beforeend', popupHtml);
    }

    // ─── FLOATING OFFER (from promotions with offer-card template, second one) ──
    var floatingPromos = promos.filter(function(p) {
      return (p.templateId === 'offer-card' || p.templateId === 'square-creative') && p.creative;
    });
    if (floatingPromos.length > 1 && !sessionStorage.getItem('campaign_floating_dismissed')) {
      var fp = floatingPromos[1] || floatingPromos[0];
      var fcr = fp.creative || {};
      var fBg = (fcr.colors && fcr.colors.background) || '#1b5e8e';
      var fTxt = (fcr.colors && fcr.colors.text) || '#ffffff';
      var fAcc = (fcr.colors && fcr.colors.accent) || '#f59e0b';
      var floatingHtml = '<div class="campaign-floating" id="campaign-floating" style="background:' + esc(fBg) + ';color:' + esc(fTxt) + '">'
        + '<button class="campaign-floating-close" onclick="document.getElementById(\'campaign-floating\').style.display=\'none\';sessionStorage.setItem(\'campaign_floating_dismissed\',\'1\')">&times;</button>'
        + '<div class="campaign-floating-inner">'
        + '<span style="font-size:14px">\\uD83D\\uDD25</span>'
        + '<div><strong>' + esc(fcr.title || fp.name || 'Deal') + '</strong>'
        + (fcr.subtitle ? '<br><span style="font-size:11px;opacity:.8">' + esc(fcr.subtitle) + '</span>' : '')
        + '</div>'
        + '<button class="campaign-floating-cta" style="background:' + esc(fAcc) + ';color:' + esc(fBg) + '">' + esc(fcr.cta || 'View') + '</button>'
        + '</div></div>';
      document.body.insertAdjacentHTML('beforeend', floatingHtml);
    }
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
  #document-root { max-width:520px; margin:0 auto; background:#fff; min-height:100vh; position:relative; }
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

  /* ─── Campaign Banner ──────────────────────────────────────────── */
  .campaign-banner { border-radius:0; padding:28px 22px; position:relative; overflow:hidden; }
  .campaign-banner-img { width:100%; height:180px; object-fit:cover; border-radius:12px; margin-bottom:16px; }
  .campaign-banner-content { position:relative; z-index:1; }
  .campaign-banner-content h2 { font-size:24px; font-weight:800; margin:8px 0; line-height:1.2; }
  .campaign-banner-content p { font-size:13px; opacity:.85; margin-bottom:12px; }
  .campaign-badge { display:inline-block; font-size:10px; font-weight:800; letter-spacing:1px; padding:4px 10px; border-radius:999px; text-transform:uppercase; }
  .campaign-cta { display:inline-block; padding:10px 20px; border:none; border-radius:10px; font-size:13px; font-weight:800; cursor:pointer; transition:opacity .2s; }
  .campaign-cta:hover { opacity:.85; }

  /* ─── Campaign Offer Cards ─────────────────────────────────────── */
  .campaign-cards { display:flex; flex-direction:column; gap:12px; }
  .campaign-card { background:#fff; border:1px solid #e6e9f2; border-radius:16px; overflow:hidden; box-shadow:0 2px 8px rgba(20,40,80,.05); }
  .campaign-card-img { width:100%; height:140px; object-fit:cover; }
  .campaign-card-body { padding:14px; }
  .campaign-card-tag { display:inline-block; font-size:9px; font-weight:800; letter-spacing:.5px; padding:3px 8px; border-radius:6px; margin-bottom:6px; }
  .campaign-card-body h4 { font-size:14px; font-weight:800; margin-bottom:4px; }
  .campaign-card-body p { font-size:11px; color:#66788f; margin-bottom:10px; }
  .campaign-card-cta { display:inline-block; padding:8px 16px; border:none; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; }

  /* ─── Campaign Menu Highlight ──────────────────────────────────── */
  .campaign-highlight { background:#fbfcff; border-radius:14px; margin:0 22px 24px; padding:16px !important; }
  .highlight-inner { display:flex; gap:14px; align-items:flex-start; }
  .highlight-img { width:80px; height:80px; border-radius:12px; object-fit:cover; flex-shrink:0; }
  .highlight-badge { display:inline-block; font-size:9px; font-weight:800; padding:3px 8px; border-radius:6px; margin-bottom:6px; }
  .highlight-inner h4 { font-size:14px; font-weight:800; margin-bottom:4px; }
  .highlight-inner p { font-size:11px; color:#66788f; margin-bottom:8px; }
  .highlight-cta { display:inline-block; padding:7px 14px; border:none; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; }

  /* ─── Campaign Popup ───────────────────────────────────────────── */
  .campaign-popup-overlay { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(4px); }
  .campaign-popup { width:100%; max-width:380px; border-radius:20px; padding:24px; position:relative; box-shadow:0 20px 60px rgba(0,0,0,.3); text-align:center; }
  .campaign-popup-close { position:absolute; top:12px; right:14px; background:none; border:none; color:inherit; font-size:24px; cursor:pointer; opacity:.6; line-height:1; padding:4px; }
  .campaign-popup-close:hover { opacity:1; }
  .campaign-popup-img { width:100%; height:140px; object-fit:cover; border-radius:12px; margin-bottom:14px; }
  .campaign-popup-content h3 { font-size:18px; font-weight:800; margin:8px 0; }
  .campaign-popup-content p { font-size:12px; opacity:.85; margin:8px 0 14px; }

  /* ─── Floating Campaign Offer ──────────────────────────────────── */
  .campaign-floating { position:fixed; bottom:20px; right:20px; z-index:900; border-radius:14px; padding:12px 14px; box-shadow:0 4px 20px rgba(0,0,0,.2); max-width:260px; }
  .campaign-floating-inner { display:flex; align-items:center; gap:10px; }
  .campaign-floating-inner strong { font-size:12px; display:block; }
  .campaign-floating-close { position:absolute; top:4px; right:8px; background:none; border:none; color:inherit; font-size:16px; cursor:pointer; opacity:.5; padding:2px; }
  .campaign-floating-close:hover { opacity:1; }
  .campaign-floating-cta { padding:6px 12px; border:none; border-radius:8px; font-size:10px; font-weight:700; cursor:pointer; white-space:nowrap; flex-shrink:0; }
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
