# Restaurant POS — Point of Sale & Restaurant Management System

A comprehensive, **offline-first** Point of Sale and restaurant management system for single and multi-branch restaurant operations. Handles the full order lifecycle — from order creation and kitchen display to billing, payments, and post-sales analytics.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Electron](https://img.shields.io/badge/electron-35-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![TypeScript](https://img.shields.io/badge/typescript-5.8-3178c6)
![MongoDB](https://img.shields.io/badge/mongodb-6-green)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Development](#development)
- [Available Scripts](#available-scripts)
- [Environment Variables](#environment-variables)
- [API Configuration](#api-configuration)
- [Building for Production](#building-for-production)
- [Packaging Desktop App](#packaging-desktop-app)
- [Testing](#testing)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

---

## Features

### Core POS

| Feature | Description |
|---|---|
| **Billing** | Product grid with categories, search, quick-fire mode, variant selection, add-ons |
| **Order Management** | Dine-in, Takeaway, Delivery, Online orders (Swiggy, Zomato, Uber Eats) |
| **Table Floor Plan** | Visual table map with drag interaction, status colors, guest management |
| **Cart Management** | Resizable cart panel with live totals, discounts, GST calculation |
| **Payment Processing** | Cash, UPI, Card, Wallet, Split payments with double-click guard |
| **KOT / Kitchen Display** | Kitchen Order Tickets with delta detection, original/additional/reprint |
| **Receipt Printing** | Thermal printer support (58mm and 80mm) with customizable templates |

### Management

| Feature | Description |
|---|---|
| **Product Manager** | Menu CRUD with categories, variants, images, GST, availability |
| **Customer Loyalty** | Points system, rewards, visit milestones, purchase history |
| **Employee Management** | Role-based access (Owner, Manager, Cashier) with PIN login |
| **Expense Tracking** | Categorized expenses with vendor tracking and date filtering |
| **Reservations** | Table booking with date/time picker and waiting list management |
| **Reports** | Z-report, daily sales summary, payment breakdown, item sales |

### Advanced

| Feature | Description |
|---|---|
| **Multi-Branch** | Branch-level data isolation, per-branch pricing and settings |
| **Inventory Management** | Stock tracking with AI-powered insights |
| **AI Features** | Daily summary, inventory health, purchase recommendations, low stock predictions, waste analysis, voice entry, weather recommendations, closing assistant |
| **Offline-First** | Full operation without internet; background sync when online |
| **Guided Tour** | Interactive onboarding tour for new users |
| **Keyboard Shortcuts** | Comprehensive shortcut system for rapid operations |
| **Role Permissions** | Configurable Manager permissions via toggle switches |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 |
| **Desktop** | Electron 35 |
| **State Mgmt** | React hooks + localStorage / IndexedDB |
| **Routing** | React Router DOM v7 |
| **HTTP Client** | Axios |
| **Charts** | Recharts |
| **Drag & Drop** | dnd-kit |
| **Icons** | Lucide React |
| **Animations** | Motion (Framer Motion) |
| **Backend** | Node.js + Express |
| **Database** | MongoDB (Mongoose) |
| **Auth** | JWT + bcrypt |
| **AI** | Google Generative AI |
| **Testing** | Vitest, Playwright, React Testing Library |

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 22 | JavaScript runtime |
| **npm** | ≥ 10 | Package manager |
| **MongoDB** | ≥ 6.0 | Database (local or Atlas) |
| **Git** | ≥ 2.30 | Version control |

**Optional:**

| Tool | Purpose |
|---|---|
| **Electron** | Desktop app runtime (installed via npm) |
| **electron-builder** | Desktop app packaging |
| **Google AI API Key** | AI features |

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd restaurant-pos
```

The project is organized as a monorepo with three main directories:

```
restaurant-pos/
├── Frontend/     — React + Vite SPA
├── electron/     — Electron desktop shell
├── ../backend/   — Express + MongoDB API server (shared)
└── package.json  — Root orchestration scripts
```

### 2. Install Frontend Dependencies

```bash
cd Frontend
npm install
```

### 3. Install & Start Backend

```bash
cd ../backend
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

# AI (optional - for AI features)
AI_API_KEY=your-google-ai-api-key
AI_PROVIDER=openai
```

Start the backend:

```bash
npm run dev
```

The backend starts on **http://localhost:3002** and automatically seeds initial data.

### 4. Start the Frontend

Open a new terminal:

```bash
cd restaurant-pos/Frontend
npm run dev
```

The frontend starts on **http://localhost:5173**.

### 5. First-Time Setup

1. Open your browser to `http://localhost:5173`
2. The **First Time Setup** wizard will appear
3. Create an **Owner account** with your restaurant details
4. Log in with the Owner credentials
5. Follow the **Guided Tour** to learn the interface
6. Start adding products, creating orders, and processing payments!

---

## Project Structure

```
restaurant-pos/
├── Frontend/
│   ├── src/
│   │   ├── main.tsx               — React entry point
│   │   ├── App.tsx                — Root orchestrator
│   │   ├── types.ts               — All TypeScript interfaces
│   │   ├── data.ts                — localStorage helpers
│   │   ├── routes.ts              — URL ↔ workspace mapping
│   │   ├── index.css              — Global styles
│   │   ├── api/
│   │   │   └── client.ts          — Axios + all API functions
│   │   ├── lib/
│   │   │   └── syncEngine.ts      — Cross-tab sync engine
│   │   ├── hooks/
│   │   │   ├── usePOSState.ts     — Central state (80+ variables)
│   │   │   ├── useBilling.ts      — Cart & payments
│   │   │   ├── useOrders.ts       — Orders & KOT
│   │   │   ├── useLoyalty.ts      — Customer rewards
│   │   │   ├── useKeyboardShortcuts.ts — Keyboard system
│   │   │   └── useNotifications.ts — Toast system
│   │   ├── utils/
│   │   │   ├── kotDelta.ts        — KOT delta computation
│   │   │   └── debugLog.ts        — Debug logging
│   │   └── components/
│   │       ├── modals/            — 15+ modal components
│   │       └── inventory/         — Inventory management
│   ├── components/
│   │   ├── AppTitleBar.tsx        — Custom title bar
│   │   ├── AppSidebar.tsx         — Navigation sidebar
│   │   ├── BillingProductGrid.tsx — Product grid
│   │   ├── CartPanel.tsx          — Cart side panel
│   │   ├── DashboardWorkspace.tsx — Dashboard
│   │   ├── OrderManager.tsx       — Orders & tables
│   │   ├── KitchenDisplay.tsx     — KOT display
│   │   ├── ProductManager.tsx     — Menu management
│   │   ├── CustomerManager.tsx    — Customer loyalty
│   │   ├── OffersManager.tsx      — Offers & rewards
│   │   ├── ReportsManager.tsx     — Reports
│   │   ├── StaffManager.tsx       — Employee management
│   │   ├── SettingsManager.tsx    — Settings
│   │   ├── BranchManager.tsx      — Multi-branch
│   │   ├── ExpenseManager.tsx     — Expenses
│   │   ├── ReservationWorkspace.tsx — Reservations
│   │   ├── AnalyticsWorkspace.tsx — Analytics
│   │   ├── FinanceWorkspace.tsx   — Finance overview
│   │   ├── ReceiptHistory.tsx     — Receipt lookup
│   │   ├── ReceiptModal.tsx       — Receipt preview
│   │   ├── KOTModal.tsx           — KOT display
│   │   ├── OrderTimeline.tsx      — Order history
│   │   ├── RestaurantFloorPlan.tsx — Table map
│   │   ├── AddOnModal.tsx         — Product customizations
│   │   ├── LoginScreen.tsx        — Staff login
│   │   ├── FirstTimeSetup.tsx     — Owner registration
│   │   ├── GuidedTour.tsx         — Onboarding tour
│   │   └── ShortcutsGuide.tsx     — Keyboard shortcuts
│   ├── e2e/                       — Playwright E2E tests
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   └── tsconfig.json
├── electron/
│   ├── main.ts                    — Electron main process
│   ├── preload.ts                 — Preload script
│   ├── package.json               — Electron dependencies
│   └── electron-builder.json      — Build config
├── package.json                   — Root scripts
├── docs/                           — Project documentation
│   ├── PRD.md                     — Product requirements
│   ├── ARCHITECTURE.md            — System architecture
│   ├── AGENTS.md                  — CI/CD & automation agents
│   ├── DECISIONS.md               — Architecture decision records
│   ├── TASKS.md                   — Task tracking & milestones
│   ├── CHANGELOG.md               — Version history
│   ├── CONTRIBUTING.md            — Contribution guidelines
│   ├── CODE_OF_CONDUCT.md         — Code of conduct
│   ├── SECURITY.md                — Security policies
│   ├── LICENSE.md                 — License
│   └── SUPPORT.md                 — Support resources

backend/                           — Express API server
├── src/
│   ├── server.ts                  — Server entry
│   ├── config.ts                  — Environment config
│   ├── db.ts                      — MongoDB connection
│   ├── models/                    — Mongoose schemas
│   ├── routes/                    — Route definitions
│   ├── services/                  — Business logic
│   ├── controllers/               — Request handlers
│   ├── middleware/                 — Auth, validation, rate limiting
│   └── utils/                     — AppError, bcrypt, JWT
├── data/                          — Seed data
├── package.json
└── tsconfig.json
```

---

## Development

### 1. Start the Backend

```bash
cd backend
npm run dev
```

### 2. Start the Frontend

```bash
cd Frontend
npm run dev
```

### 3. Start with Electron (Optional)

From the root:

```bash
npm run dev:electron
```

### Default Credentials

After first-time setup, the Owner creates their own credentials. For development, you can use the seeded admin:

| Role | User | Password |
|---|---|---|
| **Admin** | `admin` | `1111` |

---

## Available Scripts

### Frontend (`Frontend/`)

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build (Vite + server esbuild) |
| `npm run start` | Start production server |
| `npm run clean` | Clean build artifacts |
| `npm run lint` | TypeScript type check (`tsc --noEmit`) |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run E2E tests (Playwright) |
| `npm run test:e2e:ui` | Run E2E with interactive UI |
| `npm run test:e2e:debug` | Run E2E with debug mode |

### Backend (`backend/`)

| Script | Description |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run start` | Start production server |
| `npm run test` | Run backend tests |
| `npm run seed` | Seed database with sample data |
| `npm run cleanup-db` | Clean up database |

### Root (`restaurant-pos/`)

| Script | Description |
|---|---|
| `npm run dev:electron` | Full stack with Electron |

---

## Environment Variables

### Frontend (`Frontend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | Yes | `http://localhost:3002/api` | Backend API URL |
| `NODE_ENV` | No | `development` | Environment mode |

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGODB_URI` | Yes | `mongodb://localhost:27017/pos` | MongoDB connection string |
| `JWT_SECRET` | Yes | (dev default) | JWT signing secret |
| `REFRESH_SECRET` | Yes | (dev default) | Refresh token secret |
| `PORT` | No | `3002` | HTTP server port |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin |
| `NODE_ENV` | No | `development` | Environment mode |
| `AI_API_KEY` | For AI | — | Google/OpenAI API key |
| `AI_PROVIDER` | For AI | `openai` | AI provider |
| `AI_MODEL` | No | `gpt-4o-mini` | AI model |
| `WEATHER_API_KEY` | For weather | — | Weather API key |

---

## API Configuration

The frontend connects to the backend via Axios. The API client is in `src/api/client.ts`.

### Key Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/login` | Staff login |
| `POST` | `/api/refresh` | Refresh JWT token |
| `POST` | `/api/logout` | Logout |
| `GET` | `/api/owner-exists` | Check if Owner exists |
| `POST` | `/api/register-owner` | Register first Owner |
| `GET` | `/api/products` | List menu items |
| `POST` | `/api/products` | Create product (Owner/Manager) |
| `GET` | `/api/orders` | List orders |
| `POST` | `/api/orders` | Create order |
| `PUT` | `/api/orders/:id` | Update order |
| `GET` | `/api/bills` | List bills |
| `POST` | `/api/bills` | Create bill |
| `GET` | `/api/bills/next-invoice` | Get next invoice number |
| `GET` | `/api/tables` | List tables |
| `POST` | `/api/tables` | Create table |
| `GET` | `/api/customers` | List customers |
| `POST` | `/api/customers` | Create customer |
| `GET` | `/api/expenses` | List expenses |
| `POST` | `/api/expenses` | Create expense |
| `GET` | `/api/reservations` | List reservations |
| `POST` | `/api/reservations` | Create reservation |
| `GET` | `/api/branches` | List branches |
| `POST` | `/api/branches` | Create branch |
| `GET` | `/api/employees` | List employees |
| `POST` | `/api/employees` | Create employee |
| `POST` | `/api/sync` | Sync offline data |

---

## Building for Production

```bash
cd Frontend

# Production build
npm run build
```

Output:
- `dist/assets/` — Optimized JS and CSS bundles
- `dist/index.html` — Entry HTML
- `dist/server.cjs` — Production Express server

### Running Production Build

```bash
npm run start
```

The production server serves the built frontend and proxies API requests.

---

## Packaging Desktop App

```bash
cd Frontend
npm run build  # Must build first

# Then from root:
npm run package  # electron-builder
```

### Platform Support

| Platform | Installer | Notes |
|---|---|---|
| **Windows** | NSIS installer (.exe) | Tested on Windows 10/11 |
| **macOS** | DMG | Tested on macOS 13+ |
| **Linux** | AppImage + .deb | Tested on Ubuntu 22.04+ |

---

## Testing

### Unit Tests

```bash
cd Frontend

# Run all tests
npm run test

# Watch mode
npm run test:watch
```

### E2E Tests

```bash
# Build the app first
npm run build

# Run headless E2E tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug
```

### Type Checking

```bash
cd Frontend

npm run lint  # tsc --noEmit
```

### Test Files

| File | Type | Description |
|---|---|---|
| `src/utils/debugLog.test.ts` | Unit | Debug logging utility |
| `e2e/ordering-flow.spec.ts` | E2E | Full ordering flow |
| `e2e/ai-diag.spec.ts` | E2E | AI diagnostic tests |
| `e2e/ai-diagnostic.spec.ts` | E2E | Additional AI tests |
| `e2e/ai-visual-qa.spec.ts` | E2E | AI visual verification |
| `e2e/tour-visual-verify.spec.ts` | E2E | Guided tour verification |

---

## Documentation

| Document | Description |
|---|---|
| [PRD.md](./docs/PRD.md) | Product Requirements Document |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture documentation |
| [AGENTS.md](./docs/AGENTS.md) | CI/CD, AI, testing, and automation agents |
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

### "Cannot connect to backend"

1. **Ensure MongoDB is running**: `mongod --dbname pos`
2. **Ensure backend is running**: `cd ../backend && npm run dev`
3. **Check CORS**: Backend default CORS origin is `http://localhost:5173`
4. **Check port**: Backend defaults to `3002`, frontend proxies `/api` to it

### "Blank screen on startup"

1. Check browser console for errors
2. Ensure you completed **First Time Setup** (Owner registration)
3. Clear localStorage: `localStorage.clear()` in DevTools console
4. Check that dependencies are installed: `npm install` in `Frontend/`

### "KOT not printing"

1. Ensure a printer is configured in Settings → Receipt
2. Check printer routing rules (category → printer mapping)
3. Thermal printer must support ESC/POS (58mm or 80mm)

### "Sync not working"

1. Check the online/offline indicator in the title bar
2. Open Sync Panel (`Ctrl+Shift+S`) to view sync status
3. If offline, data is saved locally and syncs automatically when online
4. Manual sync may be needed after extended offline periods

### "Products not showing in billing"

1. Check that products have `availability: true`
2. Products may be filtered by branch — check you're in the correct branch
3. Ensure categories are assigned to products

### "Invoice numbers duplicating"

1. This indicates the backend was offline during invoice generation
2. The system uses atomic counters on the backend (`findOneAndUpdate $inc`)
3. When offline, it falls back to localStorage counters
4. Duplicates can be resolved by deleting duplicate bills

### "Cannot log in"

1. First-time setup required an Owner account — check if setup wizard appears
2. Owner uses username/password; Cashiers use 4-digit PIN
3. Check `localStorage` for `pos_current_employee` — clear and retry

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+F` | Focus billing search |
| `Ctrl+L` | Focus loyalty/phone search |
| `Ctrl+K` | Send to kitchen (KOT) |
| `Ctrl+P` | Open payment modal |
| `Ctrl+D` | Open daily sales |
| `Ctrl+H` | Hold current order |
| `Ctrl+Shift+H` | Open held orders drawer |
| `Ctrl+Shift+S` | Open sync panel |
| `Ctrl+/` | Open shortcuts guide |
| `Escape` | Close current modal |
| `F1–F12` | Workspace navigation |

---

## License

[Specify your license here]
