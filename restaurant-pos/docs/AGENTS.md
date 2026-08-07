# Agents & Automation
## Restaurant POS — Point of Sale & Restaurant Management System

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** July 27, 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Development Agents](#2-development-agents)
3. [Build Agents](#3-build-agents)
4. [Testing Agents](#4-testing-agents)
5. [Quality Assurance Agents](#5-quality-assurance-agents)
6. [CI/CD Pipeline](#6-cicd-pipeline)
7. [Desktop Packaging Agents](#7-desktop-packaging-agents)
8. [AI Feature Agents](#8-ai-feature-agents)
9. [Sync & Offline Agents](#9-sync--offline-agents)
10. [Deployment Agents](#10-deployment-agents)

---

## 1. Overview

The Restaurant POS project uses a comprehensive suite of **development**, **testing**, **quality**, and **AI agents** to ensure a reliable, feature-rich POS experience. The project includes full E2E testing via Playwright, unit testing via Vitest, TypeScript type checking, and AI-powered features via Google Generative AI.

---

## 2. Development Agents

### 2.1 Vite Dev Server (HMR Agent)

| Property | Value |
|---|---|
| **Agent** | Vite 6 Development Server |
| **Trigger** | `npm run dev` (from `Frontend/`) |
| **Purpose** | Hot Module Replacement (HMR) for rapid frontend development |
| **Input** | React/TypeScript source files |
| **Output** | Browser-served application with instant updates |
| **Port** | 5173 (typical) |

### 2.2 Concurrent Dev Agent

| Property | Value |
|---|---|
| **Agent** | Concurrent Run Manager |
| **Trigger** | `npm run dev` (from root `restaurant-pos/`) |
| **Command** | `concurrently -k \"cd Frontend && npm run dev\" \"cd backend && npm run dev\"` |
| **Purpose** | Run frontend Vite server + backend Express server simultaneously |

### 2.3 Backend Dev Agent

| Property | Value |
|---|---|
| **Agent** | tsx Node Runner |
| **Trigger** | `npm run dev` (from `backend/`) |
| **Command** | `tsx watch src/server.ts` |
| **Purpose** | Hot-reloading TypeScript backend server |
| **Port** | 3002 (typical) |

---

## 3. Build Agents

### 3.1 React Build Agent

| Property | Value |
|---|---|
| **Agent** | Vite Production Build |
| **Trigger** | `npm run build` (from `Frontend/`) |
| **Command** | `vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs` |
| **Input** | `src/` + `components/` — TypeScript + React + CSS |
| **Output** | `dist/` — Optimized static bundle + server CJS file |
| **Features** | Code splitting, tree shaking, asset hashing, minification |

### 3.2 Electron Build Agent

| Property | Value |
|---|---|
| **Agent** | esbuild Electron Bundler |
| **Trigger** | `npm run build` (from root `restaurant-pos/`) |
| **Input** | `electron/main.ts` |
| **Output** | `electron/main.js` |
| **Config** | `electron/tsconfig.json` |

---

## 4. Testing Agents

### 4.1 Vitest (Unit Testing Agent)

| Property | Value |
|---|---|
| **Agent** | Vitest 4 |
| **Trigger** | `npm run test` / `npm run test:watch` |
| **Config** | `vitest.config.ts` (in project root or Frontend/) |
| **Environment** | jsdom (DOM simulation for React components) |
| **Purpose** | Run unit tests for utilities, hooks, and components |

**Test files discovered:**
- `src/utils/debugLog.test.ts` — Debug logging tests
- Following filename pattern: `*.test.ts` / `*.test.tsx`

**Workflow:**
```
npm run test       → vitest run (single run)
npm run test:watch → vitest (watch mode)
```

### 4.2 Playwright (E2E Testing Agent)

| Property | Value |
|---|---|
| **Agent** | Playwright 1.62 |
| **Trigger** | `npm run test:e2e` |
| **Config** | `playwright.config.ts` (in `Frontend/`) |
| **UI Mode** | `npm run test:e2e:ui` — Interactive test runner UI |
| **Debug Mode** | `npm run test:e2e:debug` — Step-by-step debugging |

**E2E Test Files:**

| File | Purpose |
|---|---|
| `Frontend/e2e/ai-diag.spec.ts` | AI diagnostic tests |
| `Frontend/e2e/ai-diagnostic.spec.ts` | Additional AI diagnostic tests |
| `Frontend/e2e/ai-visual-qa.spec.ts` | Visual QA tests for AI features |
| `Frontend/e2e/ordering-flow.spec.ts` | End-to-end ordering workflow tests |
| `Frontend/e2e/tour-visual-verify.spec.ts` | Guided tour visual verification |

**E2E Test Workflow:**
```
1. Build frontend: vite build
2. Start server: node dist/server.cjs (or dev server)
3. Run Playwright against localhost
4. Playwright launches headless Chromium
5. Tests navigate, interact, and assert UI state
6. Screenshots captured on failure
7. Report generated (HTML)
```

### 4.3 Testing Library (Component Testing Agent)

| Property | Value |
|---|---|
| **Agent** | React Testing Library 16 |
| **Packages** | `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/dom` |
| **Purpose** | Component-level DOM testing with accessibility-first queries |
| **Environment** | jsdom (via Vitest) |

---

## 5. Quality Assurance Agents

### 5.1 TypeScript Type Checker

| Property | Value |
|---|---|
| **Agent** | TypeScript Compiler (tsc) |
| **Trigger** | `npm run lint` |
| **Command** | `tsc --noEmit` |
| **Config** | `tsconfig.json` |
| **Level** | Strict (target: ES2022, module: ESNext) |
| **Scope** | All source files in `src/` and `components/` |
| **Exit Code** | 0 = pass, 1 = type errors found |

### 5.2 Code Review Agents

| Review Type | Method | Scope |
|---|---|---|
| **Manual Code Review** | Peer review via PR | Logic, correctness, edge cases |
| **AI-Powered Review** | Conversational review | Architecture, patterns, security |
| **Pre-commit Review** | Developer self-review | Before git commit |

### 5.3 Visual QA Agents

| Check | Agent | Details |
|---|---|---|
| **E2E Screenshots** | Playwright visual comparisons | Captures screenshots and compares against baselines |
| **Tour Walkthrough** | `tour-visual-verify.spec.ts` | Verifies guided tour steps render correctly |
| **AI Feature Display** | `ai-visual-qa.spec.ts` | Verifies AI feature UI components |
| **Ordering Flow** | `ordering-flow.spec.ts` | Verifies the complete ordering + payment flow |

### 5.4 UI Review Checklist

| Area | Check | Agent |
|---|---|---|
| **Billing Workspace** | Product grid renders, categories work, cart updates | Manual / E2E |
| **Orders** | Table floor plan renders, drag interaction works | Manual |
| **Kitchen Display** | KOT cards appear, statuses update | E2E |
| **Loyalty** | Customer search, points calculation, reward application | E2E |
| **Reports** | Z-report, daily sales data accuracy | Manual |
| **Receipt** | Receipt formatting, print preview, auto-print | Manual |
| **Settings** | All toggles save, role permissions enforced | E2E |
| **Multi-Branch** | Branch switching filters data correctly | Manual |

---

## 6. CI/CD Pipeline

### 6.1 Full CI Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CI/CD Pipeline                                 │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Lint/Type   │  │  Unit Tests  │  │  E2E Tests   │  │  Build     │  │
│  │  Check       │──▶│  (Vitest)    │──▶│  (Playwright)│──▶│  (Vite +  │  │
│  │  tsc --noEmit│  │              │  │              │  │  esbuild) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────┬──────┘  │
│                                                                │        │
│                                           ┌────────────────────┼──────┐  │
│                                           ▼                    ▼      │  │
│                                    ┌──────────┐         ┌──────────┐  │  │
│                                    │  Package │         │  Deploy  │  │  │
│                                    │  Desktop │         │  API +   │  │  │
│                                    │  (Electron│        │  Web     │  │  │
│                                    └──────────┘         └──────────┘  │  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 CI Scripts Reference

| Script | Description | Agent(s) |
|---|---|---|
| `npm run lint` | TypeScript type checking | tsc |
| `npm run test` | Run unit tests (single run) | Vitest |
| `npm run test:watch` | Run tests in watch mode | Vitest |
| `npm run test:e2e` | Run E2E tests (headless) | Playwright |
| `npm run test:e2e:ui` | Run E2E tests with interactive UI | Playwright |
| `npm run test:e2e:debug` | Run E2E tests with debug mode | Playwright |
| `npm run build` | Build frontend + server | Vite + esbuild |
| `npm run clean` | Clean dist/ and server.js | Shell |

---

## 7. Desktop Packaging Agents

### 7.1 electron-builder Agent

| Property | Value |
|---|---|
| **Agent** | electron-builder |
| **Trigger** | `npm run package` (from `Frontend/`) |
| **Config** | `electron-builder.json` |
| **Purpose** | Package POS as desktop installer |

### 7.2 Package Scripts

| Script | Description |
|---|---|
| `npm run package` | Build + package for current platform |

---

## 8. AI Feature Agents

### 8.1 Google Generative AI Agent

| Property | Value |
|---|---|
| **Agent** | Google Gemini AI |
| **Package** | `@google/genai` |
| **Auth** | API token + employee ID + role |
| **Purpose** | Power AI-driven restaurant features |

### 8.2 AI Feature Agents

| Agent | Feature | Module | Trigger |
|---|---|---|---|
| **AI Daily Summary Agent** | Generates daily business performance summary | Dashboard | End of day / on-demand |
| **AI Inventory Health Agent** | Scores inventory items based on usage patterns | Inventory | On-demand |
| **AI Purchase Recommendations Agent** | Suggests reorder quantities based on history | Inventory | Low stock detection |
| **AI Low Stock Predictions Agent** | Predicts when items will run out | Inventory | Scheduled / on-demand |
| **AI Waste Analysis Agent** | Analyzes waste patterns and suggests improvements | Inventory | Scheduled |
| **AI Voice Entry Agent** | Voice-controlled inventory data entry | Inventory | Microphone input |
| **AI Weather Recommendations Agent** | Suggests menu/promotions based on weather | Analytics | Daily |
| **AI Closing Assistant Agent** | End-of-day closing checklist and assistance | Dashboard | End of day |

### 8.3 AI Client Configuration

```typescript
// ai/aiClient.ts
setAiAuth(employeeId, role)    // Set auth context
setAiToken(token)               // Set JWT token
// AI client uses the same JWT token as the REST API client
```

### 8.4 AI Feature Toggles

All AI features can be individually enabled/disabled via settings:

```typescript
interface ModuleSettings {
  enableAISummary: boolean
  enableAIInventoryHealth: boolean
  enableAIPurchaseRecs: boolean
  enableAILowStock: boolean
  enableAIWasteAnalysis: boolean
  enableAIVoiceEntry: boolean
  enableAIWeather: boolean
  enableAIClosingAssistant: boolean
}
```

---

## 9. Sync & Offline Agents

### 9.1 SyncEngine Agent

| Property | Value |
|---|---|
| **Agent** | `SyncEngine` (Singleton) |
| **Location** | `Frontend/src/lib/syncEngine.ts` |
| **Pattern** | Publish/Subscribe |
| **Purpose** | Manage offline/online state transitions and trigger data re-fetch |
| **States** | `{ lastSynced, online, pendingChanges }` |

**Capabilities:**

| Method | Purpose |
|---|---|
| `sync()` | Mark all data as synced, clear pending changes |
| `markPending()` | Increment pending changes counter |
| `markStale(entityType)` | Mark specific entity type for re-fetch |
| `consumeStaleKeys()` | Retrieve and clear all stale keys |
| `setOnline(boolean)` | Update connectivity; triggers auto-sync on reconnection |
| `subscribe(listener)` | Subscribe to state changes (returns unsubscribe function) |
| `getSyncState()` | Read current sync state snapshot |

### 9.2 Online/Offline Detection Agent

```
Browser 'online' event   → SyncEngine.setOnline(true)  → Auto-sync all stale data
Browser 'offline' event  → SyncEngine.setOnline(false) → Continue local operations
```

### 9.3 Local Storage Agent

| Property | Value |
|---|---|
| **Agent** | localStorage Persistence Manager |
| **Location** | `Frontend/src/data.ts` |
| **Functions** | `getDBData(key, default)`, `setDBData(key, data)`, `getCachedData(key)`, `setCachedData(key, data)`, `isCacheFresh(key, ttl)` |
| **Cache Keys** | 15+ entity types with TTL constants (FAST=30s, MEDIUM=2min, SLOW=5min, LIVE=0) |

---

## 10. Deployment Agents

### 10.1 Production Express Server

| Property | Value |
|---|---|
| **Agent** | Production Express Server |
| **Trigger** | `npm run start` (from `Frontend/`) |
| **Command** | `node dist/server.cjs` |
| **Input** | `dist/` (Vite build) + `dist/server.cjs` (Express entry) |
| **Port** | Configurable via environment variables |
| **Purpose** | Serve built frontend app + API proxy in production |

### 10.2 Backend Production Server

| Property | Value |
|---|---|
| **Agent** | Production Backend Process |
| **Script** | `backend/package.json` → `npm run start` |
| **Runtime** | Node.js (via tsx or compiled JS) |
| **Database** | MongoDB Atlas (production) / Local MongoDB (development) |

### 10.3 Environment Configuration

| Variable | Required | Agent That Reads It |
|---|---|---|
| `VITE_API_URL` | Yes | Frontend Vite build |
| `JWT_SECRET` | Yes | Backend auth service |
| `JWT_REFRESH_SECRET` | Yes | Backend auth service |
| `MONGODB_URI` | Yes | Backend database connection |
| `GOOGLE_AI_API_KEY` | For AI features | AI client |
| `PORT` | No (default: 3002) | Backend server |
| `NODE_ENV` | Yes | Backend + Electron |

---

## Appendix: Complete Script Reference

```bash
# ========================
# Frontend (Frontend/)
# ========================

# ─── Development ────────────────────────────────────────
npm run dev            # Vite dev server

# ─── Build ────────────────────────────────────────────
npm run build          # Vite build + server esbuild

# ─── Production ─────────────────────────────────────────
npm run start          # node dist/server.cjs

# ─── Clean ──────────────────────────────────────────────
npm run clean          # rm -rf dist server.js

# ─── Testing ────────────────────────────────────────────
npm run test           # vitest run (unit tests)
npm run test:watch     # vitest (watch mode)
npm run lint           # tsc --noEmit (type check)
npm run test:e2e       # playwright test (headless)
npm run test:e2e:ui    # playwright test --ui
npm run test:e2e:debug # playwright test --debug

# ========================
# Root (restaurant-pos/)
# ========================

npm run dev:electron   # Run full stack with Electron

# ========================
# Backend (backend/)
# ========================

npm run dev            # tsx watch src/server.ts
npm run build          # tsc (compile TypeScript)
npm run start          # node dist/server.js
npm run test           # vitest run
npm run seed           # npx tsx src/seed.ts
npm run cleanup-db     # npx tsx scripts/cleanup-db.ts
```

## Appendix: Testing Strategy

```
                    ┌──────────────────────────┐
                    │   E2E Tests (Playwright)  │
                    │   • Full ordering flow    │
                    │   • AI feature integration│
                    │   • Guided tour walkthrough│
                    └────────────┬─────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Component Tests │   │   Hook Tests     │   │  Utility Tests   │
│  (Testing Lib)   │   │   (Vitest)       │   │  (Vitest)        │
│  • UI primitives │   │  • useBilling    │   │  • kotDelta      │
│  • Modal behavior│   │  • useOrders     │   │  • debugLog      │
│  • Form inputs   │   │  • useLoyalty    │   │  • formatters    │
└──────────────────┘   └──────────────────┘   └──────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │   TypeScript Type Check   │
                    │   (tsc --noEmit)          │
                    │   • Full codebase type    │
                    │     safety verification   │
                    └──────────────────────────┘
```
