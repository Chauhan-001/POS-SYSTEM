# Run doc — POS dev preview

This workspace **is** the main checkout (`C:\Loyalty_POS system`), so no env files
need to be copied from elsewhere; `backend/.env` already lives in the repo root
(gitignored) and `node_modules` are installed in `backend/`,
`restaurant-pos/Frontend/` and `customer-site/`.

## Reproduce the artifacts

Nothing to build for dev mode — Vite serves the frontends from source and the
backend runs via tsx. Prerequisites on a fresh checkout:

1. `cd backend && npm install`, `cd restaurant-pos/Frontend && npm install`,
   `cd customer-site && npm install`
2. `backend/.env` must exist with DB connection, JWT secrets, and AI keys.
   Copy it from the main checkout if missing (it is gitignored).
3. Optional overrides:
   - `QR_BASE_URL` forces the origin baked into QR stickers (default: the
     machine's auto-detected LAN IP + `:5177`, see `backend/src/config.ts`).
   - `VITE_API_URL` (customer-site) forces the backend base URL (default: the
     page's own hostname + `:3002`, see `customer-site/src/api.js`).

## Run the server

Three processes are needed — the API backend, the POS frontend, and the
customer QR ordering site. The POS frontend proxies `/api` to the backend.

- **Backend API** (port 3002):
  `cd backend && PORT=3002 npx tsx watch src/server.ts`
  (config default is 3002 — see `src/config.ts`. ALWAYS pin `PORT=3002`: if a
  `PORT` env var is already set in the environment the backend binds that
  random port instead and the Vite `/api` proxy 500s.)

- **POS frontend** (port 5175):
  `cd restaurant-pos/Frontend && npm run dev`

- **Customer QR site** (port 5177):
  `cd customer-site && npm run dev`
  (vite.config.js serves on `0.0.0.0` with strictPort so phones on the LAN can
  reach it. QR Studio bakes `http://<auto-detected-LAN-IP>:5177` into NEW
  stickers — regenerate a sticker in QR Studio after the machine's IP changes.)

From the repo root, backend + POS frontend can be started together with
`npm --prefix restaurant-pos run dev` — but pin the backend port first:
`PORT=3002 npm --prefix restaurant-pos run dev`.

Verify before registering a preview:
`curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/api/health` → 200
`curl -s -o /dev/null -w "%{http_code}" http://localhost:5175/` → 200
`curl -s -o /dev/null -w "%{http_code}" http://localhost:5177/` → 200

Register the preview at `http://localhost:5175` with the PID of the Vite node
process (the one listening on 5175, not the backend). The customer site is at
`http://localhost:5177` locally, or `http://<lan-ip>:5177` from a phone.
