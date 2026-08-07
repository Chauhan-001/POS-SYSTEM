# Contributing Guide
## POS Backend — Express + MongoDB REST API

Thank you for your interest in contributing! This guide outlines the development workflow, coding standards, branch strategy, and PR guidelines for the backend API server.

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started](#2-getting-started)
3. [Architecture Overview](#3-architecture-overview)
4. [Development Workflow](#4-development-workflow)
5. [Branch Strategy](#5-branch-strategy)
6. [Commit Conventions](#6-commit-conventions)
7. [Pull Request Guidelines](#7-pull-request-guidelines)
8. [Coding Standards](#8-coding-standards)
9. [Project Structure](#9-project-structure)
10. [Route & Controller Patterns](#10-route--controller-patterns)
11. [Validation](#11-validation)
12. [Testing](#12-testing)
13. [Database & Migrations](#13-database--migrations)
14. [Documentation](#14-documentation)
15. [Review Process](#15-review-process)
16. [Release Process](#16-release-process)

---

## 1. Code of Conduct

This project follows a standard Code of Conduct. All contributors are expected to be respectful, constructive, and collaborative. By participating, you agree to use welcoming language, respect differing viewpoints, and focus on what's best for the community.

---

## 2. Getting Started

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥ 22 | JavaScript runtime |
| npm | ≥ 10 | Package manager |
| MongoDB | ≥ 6.0 | Database |
| Git | ≥ 2.30 | Version control |

### First-Time Setup

```bash
# Clone the repository
git clone <repository-url>
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Start MongoDB (if running locally)
mongod --dbname pos

# Start the development server
npm run dev
```

### Environment Variables

Create `.env` in the `backend/` root:

```env
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017/pos

# JWT secrets (REQUIRED in production)
JWT_SECRET=your-jwt-secret-here
REFRESH_SECRET=your-refresh-secret-here

# Server
PORT=3002
CORS_ORIGIN=http://localhost:5173
ADMIN_CORS_ORIGINS=http://localhost:5174
NODE_ENV=development

# AI (optional — for AI features)
AI_API_KEY=your-google-ai-api-key
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
```

### Seed Data

The server automatically seeds the following on first startup:
- **Admin user**: `userId: admin` / password: `1111` (for Admin Dashboard)
- **Super admin**: `email: admin@pos.com` / password: `admin123`
- **Full authorization** on all collections for the admin user

---

## 3. Architecture Overview

### Layer Architecture

```
Routes (src/routes/)
    │
    ▼
Middlewares (src/middleware/)
    │  ├── authMiddleware.ts    — JWT verification + role enforcement
    │  ├── authorizationMiddleware.ts — Collection-level CRUD permissions
    │  ├── validate.ts          — Zod schema validation
    │  └── rateLimiter.ts       — IP + account-based throttling
    │
    ▼
Controllers (src/controllers/)
    │
    ▼
Services (src/services/) — Business logic layer
    │
    ▼
Repositories (src/repositories/) — Database access layer
    │
    ▼
Models (src/models/) — Mongoose schemas
```

### Request Pipeline

```
Incoming Request
    │
    ├── 1. CORS → Helmet → JSON Parser
    ├── 2. Rate Limiter (auth: strict, public: moderate, api: standard)
    ├── 3. Auth Middleware (JWT verification)
    ├── 4. Authorization Middleware (collection-level permissions)
    ├── 5. Validation Middleware (Zod body/params/query schemas)
    ├── 6. Controller → Service → Repository → MongoDB
    └── 7. Error Handler (catches + formats all errors)
```

### Route Groups

| Group | Rate Limiter | Auth Required | Purpose |
|---|---|---|---|
| `/api/auth/*` | Auth-specific (strict) | Mixed | Login, register, refresh |
| `/api/admin/*` | Global API | Required | Super admin dashboard |
| `/api/ai/*` | AI-specific | Required | AI feature endpoints |
| `/api/products/*` | Global API | Required | Menu management |
| `/api/orders/*` | Global API | Required | Order lifecycle |
| `/api/bills/*` | Global API | Required | Payment records |
| `/api/health` | Public (moderate) | No | Health check |
| All others | Global API | Required | CRUD operations |

---

## 4. Development Workflow

### Standard Flow

```
1. Pick an issue from the task tracker
2. Create a feature branch from `main`
3. Write code following the coding standards
4. Run tests: npm run test
5. Run type check: npx tsc --noEmit
6. Test manually with curl/Postman or the frontend
7. Commit using conventional commits
8. Push and create a Pull Request
9. Address review feedback
10. Squash merge to main
```

### Development Server

```bash
# Start with hot reload
npm run dev
# → tsx watch src/server.ts
# → Auto-restarts on file changes
# → Listens on http://localhost:3002 (or PORT from .env)
```

---

## 5. Branch Strategy

### Branch Naming

| Branch Type | Pattern | Example |
|---|---|---|
| **Feature** | `feature/<issue-number>-<short-description>` | `feature/42-add-customer-search` |
| **Bug Fix** | `fix/<issue-number>-<short-description>` | `fix/57-invoice-counter-race` |
| **Chore** | `chore/<description>` | `chore/update-mongoose-v9` |
| **Docs** | `docs/<description>` | `docs/add-api-endpoints` |
| **Refactor** | `refactor/<description>` | `refactor/extract-repository-pattern` |

### Rules

- **`main` is protected**: No direct commits. All changes via PR.
- **Branch from `main`**: Always create feature/fix branches from the latest `main`.
- **Keep branches short-lived**: Ideally less than 3 days.
- **Rebase, don't merge**: Use `git rebase main` to keep history clean.
- **Delete after merge**: Clean up remote branches after PR is merged.

---

## 6. Commit Conventions

We use **Conventional Commits** for structured commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types & Backend-Specific Scopes

| Type | Usage |
|---|---|
| `feat` | New API endpoint, service, or feature |
| `fix` | Bug fix |
| `docs` | Documentation (API docs, README) |
| `refactor` | Code improvement without feature change |
| `test` | Adding or fixing tests |
| `chore` | Dependencies, tooling, build process |
| `perf` | Performance optimization |
| `security` | Security fix |

| Scope | Area |
|---|---|
| `auth` | Authentication routes, JWT, middleware |
| `products` | Product CRUD |
| `orders` | Order lifecycle endpoints |
| `bills` | Billing, invoice counter |
| `customers` | Customer profiles, loyalty |
| `sync` | Offline sync endpoints |
| `ai` | AI feature endpoints |
| `middleware` | Auth, validation, rate limiting |
| `models` | Mongoose schemas |
| `config` | Server configuration |

### Examples

```
feat(products): add variant pricing support to product schema

fix(orders): correct KOT timeline event ordering

refactor(middleware): extract validation error formatter

docs(api): add complete endpoint reference

security(auth): implement refresh token rotation

chore(deps): upgrade mongoose to v9
```

---

## 7. Pull Request Guidelines

### PR Checklist

Before submitting, ensure:

- [ ] Branch is up to date with `main` (rebased)
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Tests pass: `npm run test`
- [ ] New endpoints have Zod validation schemas
- [ ] New endpoints have proper rate limiting
- [ ] Auth/authorization middleware is applied correctly
- [ ] Error handling is in place (try/catch or error middleware)
- [ ] No hardcoded secrets or connection strings
- [ ] API changes are documented (if applicable)
- [ ] Seed data updated (if new collections added)

### PR Template

```markdown
## Description
Brief description of the changes.

## Related Issue
Closes #ISSUE_NUMBER

## Type of Change
- [ ] New API endpoint
- [ ] Bug fix
- [ ] Schema change
- [ ] Configuration change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing with curl/Postman completed
- [ ] Backward compatible (no breaking API changes)

## Checklist
- [ ] Type check passes
- [ ] Tests pass
- [ ] Validation schemas added
- [ ] Rate limiting configured
- [ ] Auth middleware applied
- [ ] Error handling in place
- [ ] Seed data updated (if needed)
```

---

## 8. Coding Standards

### TypeScript

- **All files must be `.ts`**: No plain JavaScript.
- **Strict mode**: `strict: true` in tsconfig. No `any` unless absolutely necessary.
- **Use `import type`**: For type-only imports to avoid bundling issues.
- **No `// @ts-ignore`** or `// @ts-nocheck`.

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| **Routes** | camelCase | `productsRouter`, `ordersRouter` |
| **Controllers** | camelCase | `listProducts`, `createOrder` |
| **Services** | camelCase | `createBill`, `findCustomerByPhone` |
| **Models** | PascalCase | `Product`, `Order`, `Customer` |
| **Middleware** | camelCase | `requireAuth`, `validate` |
| **Validation schemas** | camelCase | `createProductSchema` |
| **Files** | camelCase | `authService.ts`, `rateLimiter.ts` |
| **Interfaces** | PascalCase | `IBillService`, `AuthRequest` |
| **Constants** | UPPER_SNAKE_CASE | `ACCESS_TOKEN_EXPIRY` |

### Imports Order

```typescript
// 1. Node built-ins
import path from 'node:path'

// 2. Third-party
import express from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'

// 3. Local modules
import { config } from '../config'
import { requireAuth } from '../middleware/authMiddleware'

// 4. Local models
import Product from '../models/Product'

// 5. Types
import type { Request, Response, NextFunction } from 'express'
```

### Error Handling Pattern

```typescript
import { AppError } from '../utils/AppError'

// In controllers: throw AppError for expected errors
if (!product) {
  throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND')
}

// In services: let errors propagate to the global error handler
export async function createProduct(data: CreateProductInput) {
  const product = await Product.create(data)
  return product.toJSON()
}

// Global error handler catches everything:
// src/middleware/errorHandler.ts
```

---

## 9. Project Structure

```
backend/
├── src/
│   ├── server.ts              — Express app setup, middleware registration
│   ├── config.ts              — Centralized env config
│   ├── db.ts                  — MongoDB connection + seeds
│   ├── seed.ts                — Standalone seed script
│   ├── routes/
│   │   ├── auth.ts            — Login, refresh, logout, owner registration
│   │   ├── admin.ts           — Super admin: restaurants, owners, devices, subscriptions
│   │   ├── products.ts        — Menu product CRUD
│   │   ├── orders.ts          — Order lifecycle
│   │   ├── bills.ts           — Billing + invoice counter
│   │   ├── customers.ts       — Customer loyalty profiles
│   │   ├── employees.ts       — Staff management
│   │   ├── branches.ts        — Multi-branch management
│   │   ├── expenses.ts        — Expense tracking
│   │   ├── sync.ts            — Offline sync
│   │   ├── rewards.ts         — Loyalty rewards
│   │   ├── tables.ts          — Table layout management
│   │   ├── takeawayOrders.ts  — Takeaway order management
│   │   └── reservations.ts    — Reservations + waiting list
│   ├── controllers/           — Request handlers
│   ├── services/              — Business logic
│   ├── repositories/          — Database access layer
│   ├── models/                — Mongoose schemas (15+ models)
│   ├── middleware/
│   │   ├── authMiddleware.ts  — JWT verification
│   │   ├── authorizationMiddleware.ts — Collection-level permissions
│   │   ├── rateLimiter.ts     — IP + account rate limiting
│   │   ├── validate.ts        — Zod validation runner
│   │   └── errorHandler.ts    — Global error handler
│   ├── validation/            — Zod schemas per entity
│   ├── utils/
│   │   ├── AppError.ts        — Custom error class
│   │   ├── bcrypt.ts          — Password hashing helpers
│   │   └── jwt.ts             — Token generation/verification
│   └── modules/               — Domain modules
│       ├── ai/                — AI feature endpoints + services
│       └── voice-inventory/   — Voice inventory endpoints
├── data/
│   ├── employees.json         — Seed data for employees
│   └── products.json          — Seed data for products
├── scripts/
│   └── cleanup-db.ts          — Database cleanup utility
├── .env.example               — Environment variable template
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── CONTRIBUTING.md
```

---

## 10. Route & Controller Patterns

### Route Definition Pattern

```typescript
// routes/products.ts
import { Router } from 'express'
import { listProducts, createProduct, updateProduct, deleteProduct } from '../controllers/productsController'
import { requireAuth, requireRole } from '../middleware/authMiddleware'
import { validate } from '../middleware/validate'
import { createProductSchema, updateProductSchema, productQuerySchema } from '../validation'

const router = Router()

// All authenticated users can read
router.get('/', requireAuth, validate({ query: productQuerySchema }), listProducts)

// Only Owner and Manager can write
router.post('/', requireRole('Owner', 'Manager'), validate({ body: createProductSchema }), createProduct)
router.put('/:id', requireRole('Owner', 'Manager'), validate({ body: updateProductSchema }), updateProduct)
router.delete('/:id', requireRole('Owner', 'Manager'), deleteProduct)

export default router
```

### Controller Pattern

```typescript
// controllers/productsController.ts
import type { Request, Response, NextFunction } from 'express'
import * as productService from '../services/productService'

export async function listProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const products = await productService.findAll(req.query)
    res.json({ data: products, total: products.length })
  } catch (err) {
    next(err)
  }
}
```

### Middleware Pipeline Rules

1. **Auth middleware first**: `requireAuth` or `requireRole`
2. **Validation second**: `validate({ body/params/query })`
3. **Controller last**: Business logic handler
4. **Error handler**: Global — no per-route error handling needed

---

## 11. Validation

All API inputs are validated using **Zod schemas**.

### Pattern

```typescript
// validation/product.ts
import { z } from 'zod'

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  price: z.number().positive(),
  category: z.string().min(1),
  gstPercent: z.number().min(0).max(100).default(5),
  availability: z.boolean().default(true),
  code: z.string().optional(),
  variants: z.array(z.object({
    name: z.string(),
    price: z.number().positive(),
  })).optional(),
})

export const updateProductSchema = createProductSchema.partial()
```

### Rules

- **One file per entity** in `src/validation/`
- **Export create, update, query, and params schemas**
- **Use `.partial()`** for update schemas
- **Use `.default()`** for optional fields with defaults
- **Params schemas** for route parameters (`z.object({ id: z.string() })`)

---

## 12. Testing

### Vitest

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch
```

### Test Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/ai/**'],
    },
  },
})
```

### Writing Tests

```typescript
// src/services/__tests__/billService.test.ts
import { describe, it, expect } from 'vitest'

describe('billService', () => {
  it('should calculate GST correctly', () => {
    const result = calculateGST(100, 5)
    expect(result).toBe(5)
  })
})
```

### Test Coverage Expectations

| Area | Coverage |
|---|---|
| Services (business logic) | 70%+ |
| Validation schemas | 80%+ |
| Controllers | 50%+ |
| Middleware | 60%+ |

---

## 13. Database & Migrations

### MongoDB Conventions

- **Collection names**: Plural lowercase (`products`, `orders`, `bills`)
- **Document IDs**: MongoDB ObjectId by default
- **Timestamps**: Use `timestamps: true` on schemas (auto `createdAt`/`updatedAt`)
- **Soft deletes**: Use `isActive` boolean instead of hard deletes where possible
- **Indexes**: Create indexes for all query patterns (especially `branchId`, `status`, `date`)

### Schema Pattern

```typescript
import mongoose, { Schema, Document } from 'mongoose'

export interface IProduct extends Document {
  name: string
  price: number
  category: string
  gstPercent: number
  availability: boolean
  branchId?: string
}

const productSchema = new Schema<IProduct>({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  gstPercent: { type: Number, default: 5 },
  availability: { type: Boolean, default: true },
  branchId: { type: String, index: true },
}, { timestamps: true })

export default mongoose.model<IProduct>('Product', productSchema)
```

### Seed Data

Update seed data in these locations when adding new models:

- **Auto-seed**: `src/db.ts` (runs on server start)
- **Manual seed**: `src/seed.ts` (run with `npm run seed`)
- **JSON data files**: `data/` directory for bulk imports

---

## 14. Documentation

### When to Update Docs

- **New endpoint**: Document in the API section of the frontend README
- **New model**: Update database schema documentation
- **Config change**: Update `.env.example` and config.ts
- **Architecture change**: Update this CONTRIBUTING guide

### Documentation Files

| File | When to Update |
|---|---|
| `CONTRIBUTING.md` | Workflow, pattern, or standard changes |
| `.env.example` | New environment variables |
| `README.md` (root) | Setup changes |
| `data/` JSON files | New seed data |

---

## 15. Review Process

### Review Timeline

| PR Size | Review Deadline |
|---|---|
| Small (< 100 lines) | 1 business day |
| Medium (100–500 lines) | 2 business days |
| Large (500+ lines) | 3 business days |

### What Reviewers Look For

1. **Correctness**: Does the endpoint work as expected?
2. **Security**: Are auth/authorization middleware properly applied?
3. **Validation**: Are all inputs validated with Zod?
4. **Error handling**: Are errors caught and properly formatted?
5. **Performance**: Are there N+1 queries? Missing indexes?
6. **Backward compatibility**: Do existing clients break?
7. **Rate limiting**: Is the endpoint properly throttled?
8. **Type safety**: Are types correct and complete?
9. **Testing**: Are there adequate tests?
10. **Consistency**: Does the code follow project patterns?

---

## 16. Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking API changes (removed endpoints, altered schemas)
- **MINOR**: New endpoints, backward-compatible features
- **PATCH**: Bug fixes, security patches

### Release Steps

```
1. Ensure all PRs for the release are merged to main
2. Create a release branch: release/vX.Y.Z
3. Update version in package.json
4. Update CHANGELOG.md
5. Create a PR from release branch to main
6. After merge, tag the commit: git tag vX.Y.Z && git push origin vX.Y.Z
7. Build: npm run build
8. Deploy: dist/server.cjs to production server
```
