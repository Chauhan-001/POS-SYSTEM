# Contributing Guide
## Restaurant POS — Point of Sale & Restaurant Management System

Thank you for your interest in contributing! This guide outlines the development workflow, coding standards, branch strategy, and PR guidelines for the Restaurant POS project.

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started](#2-getting-started)
3. [Development Workflow](#3-development-workflow)
4. [Branch Strategy](#4-branch-strategy)
5. [Commit Conventions](#5-commit-conventions)
6. [Pull Request Guidelines](#6-pull-request-guidelines)
7. [Coding Standards](#7-coding-standards)
8. [Component & Hook Guidelines](#8-component--hook-guidelines)
9. [State Management Rules](#9-state-management-rules)
10. [Testing](#10-testing)
11. [Documentation](#11-documentation)
12. [Review Process](#12-review-process)
13. [Release Process](#13-release-process)

---

## 1. Code of Conduct

This project follows a standard Code of Conduct. All contributors are expected to be respectful, constructive, and collaborative. Harassment or discrimination of any kind will not be tolerated.

By participating, you agree to:
- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community and project
- Show empathy towards other community members

---

## 2. Getting Started

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥ 22 | JavaScript runtime |
| npm | ≥ 10 | Package manager |
| MongoDB | ≥ 6.0 | Database |
| Git | ≥ 2.30 | Version control |
| Playwright Browsers | — | E2E testing (optional) |

### First-Time Setup

```bash
# Clone the repository
git clone <repository-url>
cd restaurant-pos

# Install frontend dependencies
cd Frontend
npm install

# Install backend dependencies
cd ../backend
npm install

# Set up the backend
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secrets

# Install Playwright browsers (for E2E tests)
npx playwright install chromium

# Start the backend (terminal 1)
cd ../backend
npm run dev

# Start the frontend (terminal 2)
cd ../Frontend
npm run dev
```

### Environment Variables

**Frontend (`Frontend/.env`):**

```env
VITE_API_URL=http://localhost:3002/api
```

**Backend (`backend/.env`):**

```env
MONGODB_URI=mongodb://localhost:27017/pos
JWT_SECRET=your-jwt-secret-here
REFRESH_SECRET=your-refresh-secret-here
PORT=3002
NODE_ENV=development
```

### First-Time Usage

1. Open `http://localhost:5175` after both servers are running
2. Complete the **First Time Setup** wizard to register the Owner account
3. Log in and start using the POS system

---

## 3. Development Workflow

### 3.1 Standard Flow

```
1. Pick an issue or task from the task tracker
2. Create a feature branch from `main`
3. Write code following the coding standards
4. Run type checking: npm run lint (tsc --noEmit)
5. Run unit tests: npm run test
6. Run E2E tests if applicable: npm run test:e2e
7. Commit using conventional commits
8. Push and create a Pull Request
9. Address review feedback
10. Squash merge to main
```

### 3.2 Development Modes

```bash
# Frontend only (fastest)
cd Frontend && npm run dev
# → Hot reload at http://localhost:5175

# Backend only
cd backend && npm run dev
# → Hot reload at http://localhost:3002

# Full stack with Electron
cd (root) && npm run dev:electron
# → Frontend + Backend + Electron concurrently
```

---

## 4. Branch Strategy

### Branch Naming

| Branch Type | Pattern | Example |
|---|---|---|
| **Feature** | `feature/<issue-number>-<short-description>` | `feature/42-add-waitlist-notifications` |
| **Bug Fix** | `fix/<issue-number>-<short-description>` | `fix/57-kot-delta-calculation` |
| **Chore** | `chore/<description>` | `chore/update-tailwind-v4` |
| **Docs** | `docs/<description>` | `docs/add-api-docs` |
| **Refactor** | `refactor/<description>` | `refactor/extract-hooks` |

### Branch Structure

```
main          — Production-ready code. Protected. No direct pushes.
  │
  ├── feature/*    — New features. Branch from main, merge back to main.
  ├── fix/*        — Bug fixes. Branch from main, merge back to main.
  ├── chore/*      — Maintenance tasks.
  ├── docs/*       — Documentation updates.
  └── refactor/*   — Code improvements without feature changes.
```

### Rules

- **`main` is protected**: No direct commits. All changes via PR.
- **Branch from `main`**: Always create branches from the latest `main`.
- **Keep branches short-lived**: Ideally less than 3 days. Large features should be split.
- **Delete after merge**: Clean up remote branches after PR is merged.
- **Rebase, don't merge**: Use `git rebase main` to keep history clean.

---

## 5. Commit Conventions

We use **Conventional Commits** for clear, structured commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Usage |
|---|---|
| `feat` | A new feature (workspace, component, hook) |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting) |
| `refactor` | Code changes that neither fix bugs nor add features |
| `perf` | Performance improvements |
| `test` | Adding or fixing tests |
| `chore` | Build process, dependencies, tooling |
| `ci` | CI configuration changes |

### Scope Examples

| Scope | Area |
|---|---|
| `billing` | Billing workspace, cart, payments |
| `orders` | Order management, tables, KOT |
| `kitchen` | Kitchen display, KOT status |
| `products` | Product management |
| `customers` | Customer loyalty |
| `staff` | Employee management |
| `branches` | Multi-branch |
| `settings` | Settings manager |
| `ai` | AI features |
| `sync` | Sync engine, offline |
| `electron` | Electron main process |
| `e2e` | E2E tests |
| `hooks` | Custom hooks |
| `types` | Type definitions |

### Examples

```
feat(billing): add quick-fire mode for fast product entry

fix(kitchen): correct KOT delta calculation when items are removed

feat(customers): add birthday tracking and automated offers

refactor(hooks): extract useLoyalty from useBilling

test(e2e): add ordering flow E2E test

chore(deps): upgrade dnd-kit to v10

docs(api): document all backend routes

perf(sync): reduce polling interval when no active order
```

---

## 6. Pull Request Guidelines

### PR Checklist

Before submitting, ensure:

- [ ] Branch is up to date with `main` (rebased)
- [ ] TypeScript type check passes (`npm run lint`)
- [ ] Unit tests pass (`npm run test`)
- [ ] E2E tests pass if applicable (`npm run test:e2e`)
- [ ] All manual testing complete (billing flow, order creation, KOT)
- [ ] Offline mode tested (disconnect network, verify local persistence)
- [ ] New components follow component guidelines
- [ ] New hooks follow state management rules
- [ ] Loading, empty, and error states handled
- [ ] Role-based access verified (Owner, Manager, Cashier)
- [ ] Documentation updated if needed

### PR Template

```markdown
## Description
Brief description of the changes.

## Related Issue
Closes #ISSUE_NUMBER

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Screenshots / Screen Recordings
[If applicable]

## Testing
- [ ] Unit tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing completed
- [ ] Offline mode verified
- [ ] Role-based access verified

## Checklist
- [ ] Type check passes
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Dark mode verified (if UI change)
- [ ] Error states handled
- [ ] Loading states handled
- [ ] Empty states handled
```

### PR Size Guidelines

| Size | Lines Changed | Review Approach |
|---|---|---|
| **Small** | < 100 lines | Quick review |
| **Medium** | 100–500 lines | Standard review |
| **Large** | 500+ lines | Consider splitting |
| **Extra Large** | 1000+ lines | Must split into multiple PRs |

---

## 7. Coding Standards

### TypeScript & React

- **Use TypeScript**: All files must be `.ts` or `.tsx`. No plain JavaScript.
- **Use functional components**: Class components are not allowed.
- **Use hooks**: All state and effects in hooks.
- **Use proper types**: Prefer `interface` over `type` for object shapes.
- **Minimize `any`**: Use specific types from `types.ts` wherever possible.
- **No `// @ts-ignore`** or `// @ts-nocheck`.
- **Use `const` assertions**: `as const` for literal types.

### File Organization

```
Frontend/
├── src/
│   ├── App.tsx              — Root component (orchestrator)
│   ├── types.ts             — All shared type definitions
│   ├── data.ts              — localStorage helpers
│   ├── routes.ts            — URL ↔ workspace mapping
│   ├── api/
│   │   └── client.ts        — Axios instance + all API functions
│   ├── lib/
│   │   └── syncEngine.ts    — Cross-tab sync engine
│   ├── hooks/
│   │   └── use*.ts          — Custom hooks
│   ├── utils/
│   │   └── *.ts             — Utility functions
│   └── components/
│       ├── modals/          — Modal components
│       └── inventory/       — Inventory components
├── components/               — Top-level workspace components
│   └── *.tsx                — One component per workspace
├── e2e/                     — Playwright E2E tests
└── index.html
```

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| **Components** | PascalCase | `CartPanel`, `BillingProductGrid` |
| **Functions** | camelCase | `handleCheckoutPayment` |
| **Files (components)** | PascalCase | `KitchenDisplay.tsx` |
| **Files (hooks/utils)** | camelCase | `useBilling.ts` |
| **Files (types)** | camelCase | `types.ts` |
| **Hooks** | camelCase with `use` prefix | `useOrders` |
| **Types/Interfaces** | PascalCase | `Order`, `TableInfo` |
| **Constants** | UPPER_SNAKE_CASE | `CACHE_TTL`, `DEFAULT_ROLE_PERMISSIONS` |
| **CSS classes** | utility-based | Tailwind utilities |

### Imports Order

```typescript
// 1. React
import { useCallback, useMemo } from 'react'

// 2. Third-party
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// 3. Local types
import type { Order, Bill, CartItem } from '../types'

// 4. Local data/utils
import { setDBData, getDBData } from '../data'
import { syncEngine } from '../lib/syncEngine'

// 5. API
import * as api from '../api/client'

// 6. Local components
import ProductManager from '../components/ProductManager'

// 7. Hooks
import { useNotifications } from '../hooks/useNotifications'
```

---

## 8. Component & Hook Guidelines

### Workspace Components

Each workspace is a top-level component in `Frontend/components/`. They receive all state and handlers as props from `App.tsx`.

```tsx
// Good — workspace receives props
function DashboardWorkspace({ dailySales, bills, onNavigate }: DashboardWorkspaceProps) {
  // ...
}

// Bad — workspace reads state directly
function DashboardWorkspace() {
  const { dailySales } = usePOSState() // ❌ Don't use hooks directly in workspace components
  // ...
}
```

### Custom Hooks

Hooks encapsulate business logic and receive state/state-setters as config:

```tsx
// useBilling.ts
export function useBilling(config: BillingConfig) {
  const {
    cartItems,
    setCartItems,
    settings,
    currentEmployee,
    // ... more config
  } = config

  const calculateCartSubtotal = useCallback(() => {
    return cartItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)
  }, [cartItems])

  const handleCheckoutPayment = useCallback(async () => {
    // ... payment logic
  }, [cartItems, settings, ...])

  return {
    calculateCartSubtotal,
    handleCheckoutPayment,
    handleAddProductToCart,
    // ...
  }
}
```

### Rules

- **Hooks own logic, not state**: They receive state and return actions.
- **`useCallback` for handlers**: Prevent unnecessary re-renders.
- **`useMemo` for derived values**: Memoize computed data.
- **Workspace components are stateless**: All state comes from App.tsx via props.
- **Modal state in usePOSState**: Boolean flags for each modal.
- **No direct API calls in components**: All through hooks or API modules.

---

## 9. State Management Rules

### Central State Architecture

All state lives in `usePOSState()` in `App.tsx`. Child hooks receive state slices.

```
usePOSState (single source of truth)
    ↓
  Props/Config → useBilling, useOrders, useLoyalty, useKeyboardShortcuts
    ↓
  Workspace Components (receive props from App.tsx)
```

### Data Flow Rules

1. **localStorage is the source of truth**: Initialize state from localStorage.
2. **API is secondary**: Update API in background; failures are silent.
3. **No React Query**: API calls are fire-and-forget with `.catch()`.
4. **TTL-aware fetching**: Use `fetchIfStale()` for cache management.
5. **Branch filtering**: All data filtered by current branch via `useMemo`.
6. **Derived state memoized**: `dailySales`, `zReportData`, `filteredBills`, etc.
7. **Offline mutations write to localStorage**: API is best-effort.

### Persistence Rules

| Data Type | Persistence | TTL |
|---|---|---|
| Products, Employees, Branches | localStorage + API | SLOW (5 min) |
| Customers, Bills, Expenses | localStorage + API | MEDIUM (2 min) |
| Orders, Tables, Takeaway | localStorage + API | FAST (30 sec) |
| Reservations | localStorage + API | LIVE (0 sec) |
| Settings, Held Orders, Categories | localStorage only | Episode |

---

## 10. Testing

### Unit Tests (Vitest + React Testing Library)

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch
```

### E2E Tests (Playwright)

```bash
# Run all E2E tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug
```

### Type Checking

```bash
npm run lint  # tsc --noEmit
```

### Writing Tests

**Unit test example:**

```typescript
// src/utils/__tests__/kotDelta.test.ts
import { describe, it, expect } from 'vitest'
import { computeKOTDelta } from '../kotDelta'

describe('computeKOTDelta', () => {
  it('returns all items when no snapshot exists', () => {
    const result = computeKOTDelta(mockCart, undefined)
    expect(result.toPrint).toHaveLength(3)
  })

  it('only returns delta items when snapshot exists', () => {
    const result = computeKOTDelta(updatedCart, snapshot)
    expect(result.toPrint).toHaveLength(1)
    expect(result.toPrint[0].printQty).toBe(2) // additional quantity
  })
})
```

**E2E test example:**

```typescript
// e2e/ordering-flow.spec.ts
import { test, expect } from '@playwright/test'

test('complete ordering and payment flow', async ({ page }) => {
  await page.goto('http://localhost:5175')
  // Login, create order, add items, process payment, verify receipt
})
```

### Test Coverage Expectations

| Area | Minimum Coverage |
|---|---|
| Utility functions | 80%+ |
| Custom hooks | 70%+ |
| Critical E2E paths (ordering, payment, KOT) | 100% |
| UI components | 60%+ |

---

## 11. Documentation

### When to Update Docs

- **New feature/workspace**: Update README and PRD
- **New API endpoint**: Document in API section of README
- **Architecture change**: Update ARCHITECTURE.md
- **New decision**: Add ADR to DECISIONS.md
- **New dependency**: Update tech stack in README
- **New hook**: Update hook architecture in ARCHITECTURE.md
- **New test**: Update testing section

### Documentation Files

| File | When to Update |
|---|---|
| `README.md` | Setup changes, new features, KB shortcuts |
| `PRD.md` | Feature scope changes |
| `ARCHITECTURE.md` | Architecture or data flow changes |
| `DECISIONS.md` | New architectural decisions |
| `TASKS.md` | After completing tasks |
| `CHANGELOG.md` | Each release |
| `CONTRIBUTING.md` | Workflow changes |

---

## 12. Review Process

### Review Timeline

| PR Size | Review Deadline |
|---|---|
| Small (< 100 lines) | 1 business day |
| Medium (100–500 lines) | 2 business days |
| Large (500+ lines) | 3 business days |

### What Reviewers Look For

1. **Correctness**: Does the code function as expected?
2. **Offline Resilience**: Will it work without internet?
3. **Type Safety**: Are types correct? No `any` abuse?
4. **Edge Cases**: Loading, error, empty, offline states handled?
5. **Role Enforcement**: Owner/Manager/Cashier access correct?
6. **Branch Awareness**: Does new code filter by branch correctly?
7. **Performance**: Unnecessary re-renders? Memoization correct?
8. **KOT Integrity**: KOT delta detection accurate?
9. **Payment Safety**: Double-click guard in place?
10. **Consistency**: Code follows project patterns?

### Reviewer Responsibilities

- Review within the agreed timeline
- Be specific and constructive in feedback
- Approve only when all concerns are addressed
- Verify the PR checklist is complete

---

## 13. Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes (schema changes, breaking UI changes)
- **MINOR**: New features (backward-compatible)
- **PATCH**: Bug fixes (backward-compatible)

### Release Steps

```
1. Ensure all PRs for the release are merged to main
2. Create a release branch: release/vX.Y.Z
3. Update CHANGELOG.md with the new version
4. Update version in package.json (Frontend + backend)
5. Create a PR from release branch to main
6. After merge, tag the commit: git tag vX.Y.Z
7. Push tag: git push origin vX.Y.Z
8. Build frontend: cd Frontend && npm run build
9. Run E2E tests: cd Frontend && npm run test:e2e
10. Package desktop app: npm run package
11. Upload installers to release page
```
