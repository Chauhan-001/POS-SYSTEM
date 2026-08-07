# Admin Dashboard — Restaurant Chain Management Platform

A centralized **management dashboard** for restaurant chains and multi-branch restaurant businesses. Super-admins can manage restaurants, owners, devices, subscriptions, and platform-wide settings from a single interface.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Electron](https://img.shields.io/badge/electron-35-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![TypeScript](https://img.shields.io/badge/typescript-6-3178c6)

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Development](#development)
  - [Web Mode](#web-mode)
  - [Desktop Mode (Electron)](#desktop-mode-electron)
- [Available Scripts](#available-scripts)
- [Environment Variables](#environment-variables)
- [API Configuration](#api-configuration)
- [Building for Production](#building-for-production)
- [Packaging Desktop App](#packaging-desktop-app)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Description |
|---|---|
| **Dashboard** | Real-time stats, subscription overview, recent activity feed, latest restaurants |
| **Restaurant Management** | CRUD operations, suspend/activate, plan management |
| **Owner Management** | User management with password reset and activation controls |
| **Device Management** | POS terminal registry with remote block/unblock |
| **Subscription Management** | Plans, renewals, upgrades, downgrades, pause/resume |
| **Analytics** | Restaurant growth, daily logins, subscription trends, AI usage charts |
| **AI Usage Monitoring** | AI feature adoption metrics and usage tracking |
| **Support Search** | Unified search across restaurants, owners, subscriptions, and devices |
| **System Settings** | Company info, default subscription config, AI settings, general configuration |
| **Dark Mode** | Full dark mode support with automatic theme detection |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| **Desktop** | Electron 35 |
| **State Mgmt** | TanStack React Query 5 |
| **Routing** | React Router DOM v7 |
| **HTTP Client** | Axios |
| **Charts** | Recharts |
| **Icons** | Lucide React |
| **Notifications** | React Hot Toast |
| **Forms** | React Hook Form + @hookform/resolvers |
| **Backend** | Node.js + Express |
| **Database** | MongoDB (Mongoose) |
| **Auth** | JWT with refresh tokens |

---

## Prerequisites

Before you begin, ensure you have the following installed:

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 22 | JavaScript runtime |
| **npm** | ≥ 10 | Package manager |
| **MongoDB** | ≥ 6.0 | Database (local or Atlas) |
| **Git** | ≥ 2.30 | Version control |

**Optional for Desktop Build:**

| Tool | Purpose |
|---|---|
| **Electron** | Desktop app runtime (installed via npm) |
| **electron-builder** | Desktop app packaging |

---

## Quick Start

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd admin-dashboard

# Install frontend dependencies
npm install
```

### 2. Set Up the Backend

```bash
cd ../backend

# Install backend dependencies
npm install

# Create environment file
cp .env.example .env
```

Configure `.env`:

```env
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017/pos

# JWT secrets (change in production!)
JWT_SECRET=your-jwt-secret-here
REFRESH_SECRET=your-refresh-secret-here

# Server
PORT=3002
NODE_ENV=development
```

### 3. Start the Backend

```bash
cd ../backend
npm run dev
```

The backend starts on **http://localhost:3002** and automatically seeds:
- **Admin user**: `userId: admin` / password: `1111`

### 4. Start the Frontend

Open a new terminal:

```bash
cd admin-dashboard

# Start in web mode (browser)
npm run dev:web
```

The frontend starts on **http://localhost:5174**.

### 5. Login

Open your browser to `http://localhost:5174` and log in with:

> **Username:** `admin`  
> **Password:** `1111`

---

## Project Structure

```
admin-dashboard/
├── electron/
│   ├── main.ts             — Electron main process
│   ├── preload.ts          — Context bridge (secure IPC)
│   └── electron-builder.json — Build configuration
├── src/
│   ├── main.tsx            — App entry point
│   ├── style.css           — Global styles + Tailwind
│   ├── routes/
│   │   └── index.tsx       — React Router configuration
│   ├── context/
│   │   ├── AuthContext.tsx  — JWT authentication
│   │   ├── ThemeContext.tsx — Dark mode toggle
│   │   └── SidebarContext.tsx — Sidebar collapse state
│   ├── layouts/
│   │   ├── DashboardLayout.tsx — Main layout (sidebar + navbar)
│   │   ├── Sidebar.tsx         — Navigation sidebar
│   │   └── Navbar.tsx          — Top navigation bar
│   ├── pages/
│   │   ├── Dashboard.tsx       — Overview with stats & charts
│   │   ├── Restaurants.tsx     — Restaurant CRUD
│   │   ├── RestaurantDetails.tsx — Restaurant detail view
│   │   ├── Owners.tsx          — Owner management
│   │   ├── Subscriptions.tsx   — Subscription management
│   │   ├── Devices.tsx         — Device management
│   │   ├── Analytics.tsx       — Charts & analytics
│   │   ├── AIUsage.tsx         — AI feature monitoring
│   │   ├── Support.tsx         — Unified support search
│   │   ├── Settings.tsx        — System settings
│   │   ├── Profile.tsx         — Admin profile
│   │   └── Login.tsx           — Login page
│   ├── components/
│   │   └── ui/
│   │       ├── Button.tsx      — 6 variants, 3 sizes
│   │       ├── Card.tsx        — Container with slots
│   │       ├── Table.tsx       — Typed generic table
│   │       ├── Badge.tsx       — Status badges
│   │       ├── Modal.tsx       — Overlay dialogs
│   │       ├── Input.tsx       — Form inputs
│   │       ├── Skeleton.tsx    — Loading placeholders
│   │       ├── ErrorPage.tsx   — Error states with retry
│   │       ├── EmptyState.tsx  — Empty state illustrations
│   │       ├── LoadingSpinner.tsx — Loading indicator
│   │       └── ProtectedRoute.tsx — Auth guard
│   ├── api/
│   │   ├── client.ts          — Axios instance + interceptors
│   │   ├── analytics.ts       — Dashboard stats & analytics
│   │   ├── subscriptions.ts   — Subscription CRUD
│   │   ├── restaurants.ts     — Restaurant CRUD
│   │   ├── owners.ts          — Owner CRUD
│   │   ├── devices.ts         — Device management
│   │   ├── settings.ts        — System settings
│   │   └── support.ts         — Support search
│   └── utils/
│       ├── cn.ts              — Tailwind class merge
│       └── format.ts          — Date/number/currency formatters
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── docs/                       — Project documentation
    ├── PRD.md                  — Product requirements
    ├── ARCHITECTURE.md         — System architecture
    ├── AGENTS.md               — CI/CD & automation agents
    ├── DECISIONS.md            — Architecture decision records
    ├── TASKS.md                — Task tracking & milestones
    ├── CHANGELOG.md            — Version history
    ├── CONTRIBUTING.md         — Contribution guidelines
    ├── CODE_OF_CONDUCT.md      — Code of conduct
    ├── SECURITY.md             — Security policies
    ├── LICENSE.md              — License
    └── SUPPORT.md              — Support resources
```

---

## Development

### Web Mode

Run the frontend as a standard web application:

```bash
npm run dev:web
```

Opens at **http://localhost:5174** with:
- Hot Module Replacement (HMR)
- API proxy to backend at `http://localhost:3002`
- Real-time updates on file changes

### Desktop Mode (Electron)

Run the full desktop application:

```bash
npm run dev
```

This runs:
1. Vite dev server on port 5174
2. Electron main process connected to the dev server
3. Automatic reload on file changes

**Tips for Electron development:**
- DevTools open automatically in development mode
- The window maximizes on ready-to-show
- All React DevTools features work in the Electron renderer
- The `electronAPI` object is available in the browser console

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Full development (Vite + Electron concurrently) |
| `npm run dev:web` | Vite dev server only (browser) |
| `npm run dev:electron` | Build Electron files and launch |
| `npm run build` | Full production build (React + Electron) |
| `npm run build:react` | TypeScript check + Vite production build |
| `npm run build:electron` | esbuild Electron main + preload |
| `npm run preview` | Vite preview of production build |
| `npm run start` | Start Electron app in production mode |
| `npm run package` | Build + package for current platform |
| `npm run package:win` | Build + Windows NSIS installer |
| `npm run package:mac` | Build + macOS DMG |
| `npm run package:linux` | Build + Linux AppImage + Debian |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | Yes | `http://localhost:3002/api` | Backend API base URL |
| `NODE_ENV` | Yes | — | `development` or `production` |

Create a `.env` file in the project root:

```env
VITE_API_URL=http://localhost:3002/api
NODE_ENV=development
```

---

## API Configuration

The frontend communicates with the backend via a **RESTful API**. The API client is configured in `src/api/client.ts`:

- **Base URL**: From `VITE_API_URL` environment variable
- **Auth Header**: Automatically attaches `Bearer` token from `localStorage`
- **401 Interceptor**: Clears tokens and redirects to `/login`
- **Content-Type**: JSON

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/admin/login` | Admin login |
| `GET` | `/api/auth/admin/profile` | Get admin profile |
| `PUT` | `/api/auth/admin/profile` | Update admin profile |
| `PUT` | `/api/auth/admin/change-password` | Change password |
| `GET` | `/api/admin/analytics/dashboard` | Dashboard stats |
| `GET` | `/api/admin/analytics` | Analytics data |
| `GET` | `/api/admin/analytics/recent-activity` | Recent activity |
| `GET` | `/api/admin/analytics/latest-restaurants` | Latest restaurants |
| `GET` | `/api/admin/restaurants` | List restaurants |
| `POST` | `/api/admin/restaurants` | Create restaurant |
| `PUT` | `/api/admin/restaurants/:id` | Update restaurant |
| `DELETE` | `/api/admin/restaurants/:id` | Delete restaurant |
| `POST` | `/api/admin/restaurants/:id/suspend` | Suspend restaurant |
| `POST` | `/api/admin/restaurants/:id/activate` | Activate restaurant |
| `GET` | `/api/admin/owners` | List owners |
| `PUT` | `/api/admin/owners/:id` | Update owner |
| `POST` | `/api/admin/owners/:id/reset-password` | Reset owner password |
| `GET` | `/api/admin/devices` | List devices |
| `GET` | `/api/admin/subscriptions` | List subscriptions |
| `POST` | `/api/admin/subscriptions/:id/renew` | Renew subscription |
| `PUT` | `/api/admin/subscriptions/:id/upgrade` | Upgrade plan |
| `PUT` | `/api/admin/subscriptions/:id/downgrade` | Downgrade plan |
| `POST` | `/api/admin/subscriptions/:id/pause` | Pause subscription |
| `POST` | `/api/admin/subscriptions/:id/resume` | Resume subscription |
| `GET` | `/api/admin/settings/company` | Get company settings |
| `PUT` | `/api/admin/settings/company` | Update company settings |
| `GET` | `/api/admin/settings/ai` | Get AI settings |
| `PUT` | `/api/admin/settings/ai` | Update AI settings |
| `GET` | `/api/admin/support/search` | Support search |

---

## Building for Production

```bash
# Full production build
npm run build

# Output:
#   dist/              — React static bundle (HTML, JS, CSS)
#   electron/main.js   — Compiled Electron main process
#   electron/preload.js — Compiled preload script
```

### Testing the Production Build

```bash
# Preview the built web app
npm run preview

# Or run the full desktop app
npm run start
```

---

## Packaging Desktop App

Generate platform-specific installers:

```bash
# Package for current platform
npm run package

# Specific platforms
npm run package:win     # Windows NSIS (.exe)
npm run package:mac     # macOS DMG (.dmg)
npm run package:linux   # Linux AppImage + .deb
```

Output directory: `release/`

| Platform | File | Installer Type |
|---|---|---|
| **Windows** | `Admin Dashboard Setup x.x.x.exe` | NSIS installer |
| **macOS** | `Admin Dashboard-x.x.x.dmg` | DMG disk image |
| **Linux** | `Admin Dashboard-x.x.x.AppImage` | AppImage (portable) |
| **Linux** | `admin-dashboard_x.x.x_amd64.deb` | Debian package |

---

## Configuration

### Electron Configuration

The Electron main process (`electron/main.ts`) manages:
- Window dimensions: 1440×900 (maximizes on start)
- Min window: 1024×700
- Title: "Admin Dashboard"
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`

### Vite Configuration

| Option | Value | Purpose |
|---|---|---|
| `base` | `'./'` | Relative base path for Electron file:// protocol |
| `server.port` | `5174` | Dev server port |
| `server.proxy` | `/api → localhost:3002` | API proxy for development |

---

## Documentation

| Document | Description |
|---|---|
| [PRD.md](./docs/PRD.md) | Product Requirements Document |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture documentation |
| [AGENTS.md](./docs/AGENTS.md) | CI/CD, build, and automation agents |
| [DECISIONS.md](./docs/DECISIONS.md) | Architecture decision records |
| [TASKS.md](./docs/TASKS.md) | Task tracking & milestones |
| [CHANGELOG.md](./docs/CHANGELOG.md) | Version history & releases |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Contribution guidelines |
| [CODE_OF_CONDUCT.md](./docs/CODE_OF_CONDUCT.md) | Code of conduct |
| [SECURITY.md](./docs/SECURITY.md) | Security policies |
| [LICENSE.md](./docs/LICENSE.md) | License |
| [SUPPORT.md](./docs/SUPPORT.md) | Support resources |

---

## Troubleshooting

### "Cannot find module 'electron'"

```bash
npm install -D electron
```

### MongoDB connection errors

Ensure MongoDB is running locally:
```bash
mongod --dbname pos
```

Or configure a remote MongoDB URI in the backend `.env` file.

### Port already in use

The dev server requires port **5174**. To use a different port:
- Update `vite.config.ts` → `server.port`
- Update `electron/main.ts` → load URL port
- Update any scripts that reference port 5174

### Blank screen in Electron

1. Check that `electron/main.js` exists (run `npm run build:electron`)
2. Check the DevTools console for errors
3. Ensure the backend is running on port 3002

### CORS errors

The Vite dev server proxies `/api` requests to `http://localhost:3002`. For production:
1. Configure CORS on the backend to allow your domain
2. Or use a reverse proxy (Nginx, Caddy)

---

## License

[Specify your license here]
