# CUSTOMER_WEBSITE.md — Customer QR Ordering & Loyalty Portal

## Overview

The `customer-site` is the public-facing React (Vite, JSX) website that
handles QR-code table ordering, pickup/drive-in ordering, and digital receipts
for the Loyalty POS platform. **One build serves every restaurant tenant** —
the URL decides the tenant and ordering mode.

Dev URL: http://localhost:5177 (strict port, LAN-exposed so phone scanners can
reach it).

---

## 1. URL Model

```
/{tenant-slug}/qr/{token}
  e.g. /hungrybolt/qr/hb-t1       → table (dine-in)
       /hungrybolt/qr/hb-car-p1   → car / drive-in
       /hungrybolt/qr/hb-pickup   → pickup
```

The app reads `slug` + `token` from the URL, pins `slug` onto every API call
(`src/api.js`), and the shared backend scopes all data to that tenant.

Other routes:
- `/` — demo landing page
- `/:slug/qr/:token` → cart / track
- `/r/:token` — digital receipt (reward earned, today's bill items, feedback
  box, no personal data required)

## 2. Key Files

| File | Purpose |
|---|---|
| `src/App.jsx` | Routes |
| `src/context/SessionContext.jsx` | Boot: resolve QR → create/resume session; cart + loyalty state |
| `src/api.js` | Axios with tenant `slug` auto-pinned to every request |
| `src/razorpay.js` | Pay-now flow (create order → checkout → verify) |
| `src/socket.js` | Socket.IO singleton for live status/bill updates |
| `src/pages/*` | Home, CarForm, Menu, Cart, Track, ReceiptPage |
| `src/components/*` | Header, MenuCard, ItemSheet, ConfigModal, OfferCard, Stepper, WaiterFab, OtpModal, bits |

## 3. Backend Integration

- Ordering: `/api/public-store/*` (rate-limited, no auth) — menu, cart,
  order placement, session create/resume.
- Receipts: `/api/public-store/receipt/*` by token (12h expiry) — renders the
  digital receipt including the multi-slab GST SUMMARY (`src/lib/taxSummary.js`).
- Loyalty: reward info + feedback via public endpoints (`ReceiptFeedback`).
- Socket.IO for live order/bill updates.

## 4. Tenant Isolation

The `slug` is pinned as a header on every request; the backend resolves the
restaurant and scopes all queries by `restaurantId`. QR tokens are
tenant-specific, so a token from restaurant A never opens restaurant B.
