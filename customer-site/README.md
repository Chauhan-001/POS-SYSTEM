# HungryBolt — Customer Site

React (Vite) public QR ordering website. One build serves **every restaurant tenant** —
the URL decides which tenant and which ordering mode:

```
/{tenant-slug}/qr/{token}
  e.g. /hungrybolt/qr/hb-t1       → table (dine-in)
       /hungrybolt/qr/hb-car-p1   → car / drive-in
       /hungrybolt/qr/hb-pickup   → pickup
```

The app reads `slug` + `token` from the URL, pins `slug` onto every API call (see `src/api.js`),
then the shared backend scopes all data to that tenant.

## Run / build

```bash
npm install
npm run dev     # dev server on :5173
npm run build   # production bundle in dist/
```

## Env

Copy `.env.example` → `.env` (or set at build time):

- `VITE_API_URL` — shared backend base. Dev: `http://localhost:3001/api`.
  Production (same-origin, recommended): `/api`.
- `VITE_SOCKET_URL` — Socket.IO server. Leave blank to auto-derive from `VITE_API_URL`.

## Key files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Routes: `/` (demo landing) and `/:slug/qr/:token` → `cart`, `track` |
| `src/context/SessionContext.jsx` | Boot: resolve QR → create/resume session; cart + loyalty state |
| `src/api.js` | Axios with tenant `slug` auto-pinned to every request |
| `src/razorpay.js` | Pay-now flow (create order → checkout → verify) |
| `src/socket.js` | Socket.IO singleton for live status/bill updates |
| `src/pages/*` | Home, CarForm, Menu, Cart, Track |
| `src/components/*` | Header, MenuCard, ItemSheet, Stepper, WaiterFab, OtpModal, bits |

Full API/socket contract: `../API_CONTRACT.md`. How this fits the whole platform: `../INTEGRATION.md`.