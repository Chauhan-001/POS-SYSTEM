# Agents & Automation
## Admin Dashboard — Restaurant Chain Management Platform

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** July 27, 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Development Agents](#2-development-agents)
3. [Build Agents](#3-build-agents)
4. [Testing Agents](#4-testing-agents)
5. [CI/CD Pipeline](#5-cicd-pipeline)
6. [Desktop Packaging Agents](#6-desktop-packaging-agents)
7. [Quality Assurance Agents](#7-quality-assurance-agents)
8. [Deployment Agents](#8-deployment-agents)

---

## 1. Overview

The Admin Dashboard uses a combination of **build automation**, **quality assurance**, and **packaging** agents to ensure reliable delivery of both web and desktop applications. The project does not currently include dedicated test files, but agents handle TypeScript compilation, esbuild bundling, Electron packaging, and multi-platform installer generation.

---

## 2. Development Agents

### 2.1 Vite Dev Server (HMR Agent)

| Property | Value |
|---|---|
| **Agent** | Vite 8 Development Server |
| **Trigger** | `npm run dev` / `npm run dev:web` |
| **Purpose** | Hot Module Replacement (HMR) for rapid frontend development |
| **Port** | 5174 |
| **Input** | React/TypeScript source files |
| **Output** | Browser-served application with instant updates |

**Workflow:**
```
File change detected → esbuild HMR transform → WebSocket push → Browser updates
```

### 2.2 Electron Dev Agent

| Property | Value |
|---|---|
| **Agent** | Concurrent Dev Runner |
| **Trigger** | `npm run dev` |
| **Purpose** | Run Vite dev server + Electron main process concurrently |
| **Components** | `concurrently` + `wait-on` + `esbuild` + `electron` |

**Workflow:**
```
1. Start Vite dev server on port 5174
2. Wait until server is ready (wait-on)
3. esbuild compile electron/main.ts → electron/main.js
4. esbuild compile electron/preload.ts → electron/preload.js
5. Launch Electron pointing to localhost:5174
```

---

## 3. Build Agents

### 3.1 React Build Agent

| Property | Value |
|---|---|
| **Agent** | Vite Production Build |
| **Trigger** | `npm run build:react` |
| **Command** | `tsc --noEmit && vite build` |
| **Input** | `src/` — TypeScript + React + CSS |
| **Output** | `dist/` — Optimized static bundle (HTML, JS, CSS) |
| **Features** | Code splitting, tree shaking, asset hashing, minification |

### 3.2 Electron Build Agent

| Property | Value |
|---|---|
| **Agent** | esbuild Electron Bundler |
| **Trigger** | `npm run build:electron` |
| **Command** | `esbuild electron/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=electron/main.js --external:electron && esbuild electron/preload.ts --bundle --platform=node --format=esm --target=node22 --outfile=electron/preload.js --external:electron` |
| **Input** | `electron/main.ts`, `electron/preload.ts` |
| **Output** | `electron/main.js`, `electron/preload.js` |
| **Key Flags** | `--external:electron` (keeps Electron from the bundle), `--platform=node` (Node.js runtime) |

---

## 4. Testing Agents

### 4.1 TypeScript Compiler Check

| Property | Value |
|---|---|
| **Agent** | TypeScript Compiler (tsc) |
| **Trigger** | `npm run build:react` (runs `tsc --noEmit` first) |
| **Purpose** | Static type checking without emitting output files |
| **Config** | `tsconfig.json` |
| **Output** | Type errors reported to console; build fails on error |

### 4.2 Manual Testing Agents

The project currently does not have automated test runners configured. Testing is performed via:

| Agent | Method | Purpose |
|---|---|---|
| **Manual Browser Testing** | Open `localhost:5174` in browser after `npm run dev:web` | Visual verification of UI changes |
| **Manual Electron Testing** | Run `npm run dev` | Full desktop app testing |
| **Manual API Testing** | Backend API endpoints tested via browser/curl | Backend integration verification |

---

## 5. CI/CD Pipeline

### 5.1 Build Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                        CI/CD Pipeline                            │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌────────────────────┐   │
│  │  Lint/Type  │    │  Build Web  │    │   Package Desktop  │   │
│  │  Check      │───▶│  (Vite)     │───▶│   (electron-       │   │
│  │  tsc --noEmit│    │             │    │    builder)        │   │
│  └─────────────┘    └─────────────┘    └────────────────────┘   │
│                                              │                    │
│                     ┌────────────────────────┼─────────────┐     │
│                     ▼                        ▼             ▼     │
│              ┌──────────┐            ┌──────────┐   ┌──────────┐│
│              │ Windows  │            │   macOS  │   │  Linux   ││
│              │ NSIS .exe│            │  DMG     │   │AppImage  ││
│              └──────────┘            └──────────┘   │  .deb    ││
│                                                     └──────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Available CI Scripts

| Script | Description | Agent |
|---|---|---|
| `npm run build` | Full build (React + Electron) | Build Agent |
| `npm run build:react` | TypeScript check + Vite build | TSC + Vite |
| `npm run build:electron` | esbuild Electron main + preload | esbuild |
| `npm run preview` | Serve built dist/ for verification | Vite Preview |

---

## 6. Desktop Packaging Agents

### 6.1 electron-builder Agent

| Property | Value |
|---|---|
| **Agent** | electron-builder 26 |
| **Trigger** | `npm run package`, `package:win`, `package:mac`, `package:linux` |
| **Config** | `electron-builder.json` |
| **Purpose** | Package Electron app into platform-specific installers |

### 6.2 Platform-Specific Packaging Agents

#### Windows (NSIS)

| Property | Value |
|---|---|
| **Command** | `npm run package:win` |
| **Target** | NSIS installer (.exe) |
| **Config** | `nsis.oneClick: false`, `allowToChangeInstallationDirectory: true` |
| **Features** | Desktop shortcut, Start menu shortcut, custom install directory |

#### macOS (DMG)

| Property | Value |
|---|---|
| **Command** | `npm run package:mac` |
| **Target** | DMG disk image |
| **Icon** | `public/favicon.svg` |

#### Linux (AppImage + Deb)

| Property | Value |
|---|---|
| **Command** | `npm run package:linux` |
| **Target** | AppImage + .deb |
| **Icon** | `public/favicon.svg` |

### 6.3 Release Directory Structure

```
release/
├── Admin Dashboard Setup x.x.x.exe   — Windows NSIS installer
├── Admin Dashboard-x.x.x.dmg         — macOS DMG
└── Admin Dashboard-x.x.x.AppImage    — Linux AppImage
```

---

## 7. Quality Assurance Agents

### 7.1 TypeScript Type Checker

| Property | Value |
|---|---|
| **Agent** | `tsc --noEmit` |
| **Config** | `tsconfig.json` |
| **Level** | Strict (target: ES2022, module: ESNext) |
| **Scope** | All source files in `src/` |
| **Exit Code** | 0 = pass, 1 = type errors found |

### 7.2 UI Component Review Agents

The following manual checks should be performed before release:

| Check | Agent | Details |
|---|---|---|
| **Dark Mode** | Visual Reviewer | Verify all pages render correctly in dark mode |
| **Responsive** | Layout Reviewer | Test at 1024px (min), 1440px (default), and larger |
| **Loading States** | UX Reviewer | Check skeleton loaders and error boundaries |
| **Empty States** | UX Reviewer | Verify empty table states render correctly |
| **Modal Accessibility** | UX Reviewer | Test tab order, focus trapping, escape key |
| **Touch Targets** | UX Reviewer | Minimum 44x44px for all interactive elements |

---

## 8. Deployment Agents

### 8.1 Production Backend Deployment

| Agent | Role | Details |
|---|---|---|
| **Express Server** | API host | Node.js 22+, serves `/api/*` routes |
| **MongoDB Atlas** | Database host | Cloud-hosted MongoDB instance |
| **Environment Config** | Config agent | Manages `VITE_API_URL`, `JWT_SECRET`, `MONGODB_URI` |

### 8.2 Production Frontend Deployment

**Web Mode:**
- Built via `npm run build:react` → `dist/`
- Static files served by Nginx/CDN or Express's static middleware

**Desktop Mode:**
- Built and packaged via `npm run package`
- Distributed via installer file download
- Auto-updaters via `electron-updater` (configured in main process)

---

## Appendix: Script Reference

```bash
# ─── Development ─────────────────────────────────────────
npm run dev          # Vite + Electron (concurrent)
npm run dev:web      # Vite dev server only
npm run dev:electron # Electron only (uses built files)

# ─── Build ───────────────────────────────────────────────
npm run build        # Full build (React + Electron)
npm run build:react  # tsc --noEmit + vite build
npm run build:electron # esbuild Electron files

# ─── Preview ─────────────────────────────────────────────
npm run preview      # Vite preview of built assets

# ─── Package ─────────────────────────────────────────────
npm run package      # Build + package for current platform
npm run package:win  # Windows NSIS installer
npm run package:mac  # macOS DMG
npm run package:linux # Linux AppImage + Deb

# ─── Production ──────────────────────────────────────────
npm run start        # Start built Electron app
```

## Appendix: Environment Variables

| Variable | Required | Default | Agent That Reads It |
|---|---|---|---|
| `VITE_API_URL` | Yes | `http://localhost:3002/api` | React Vite build |
| `NODE_ENV` | Yes | — | Electron main process |
| `JWT_SECRET` | Yes | — | Backend Express |
| `MONGODB_URI` | Yes | — | Backend Express |
