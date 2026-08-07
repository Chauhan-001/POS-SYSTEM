# Contributing Guide
## Admin Dashboard — Restaurant Chain Management Platform

Thank you for your interest in contributing! This guide outlines the development workflow, coding standards, branch strategy, and PR guidelines for the Admin Dashboard project.

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started](#2-getting-started)
3. [Development Workflow](#3-development-workflow)
4. [Branch Strategy](#4-branch-strategy)
5. [Commit Conventions](#5-commit-conventions)
6. [Pull Request Guidelines](#6-pull-request-guidelines)
7. [Coding Standards](#7-coding-standards)
8. [Component Guidelines](#8-component-guidelines)
9. [API Integration](#9-api-integration)
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

### First-Time Setup

```bash
# Clone the repository
git clone <repository-url>
cd admin-dashboard

# Install dependencies
npm install

# Install backend dependencies
cd ../backend
npm install

# Set up the backend
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secrets

# Start the backend (terminal 1)
npm run dev

# Start the frontend (terminal 2)
cd ../admin-dashboard
npm run dev:web
```

### Environment Variables

Create `.env` in the project root:

```env
VITE_API_URL=http://localhost:3002/api
NODE_ENV=development
```

---

## 3. Development Workflow

### 3.1 Standard Flow

```
1. Pick an issue from the task tracker
2. Create a feature branch from `main`
3. Write code following the coding standards
4. Run type checking: npm run build:react (tsc --noEmit)
5. Test your changes manually in browser + Electron
6. Commit using conventional commits
7. Push and create a Pull Request
8. Address review feedback
9. Squash merge to main
```

### 3.2 Development Modes

```bash
# Web development (fastest)
npm run dev:web
# → Hot reload at http://localhost:5174

# Full desktop development
npm run dev
# → Vite + Electron concurrently

# Build and preview
npm run build
npm run preview
# → Serve production build locally
```

---

## 4. Branch Strategy

### Branch Naming

| Branch Type | Pattern | Example |
|---|---|---|
| **Feature** | `feature/<issue-number>-<short-description>` | `feature/42-add-restaurant-export` |
| **Bug Fix** | `fix/<issue-number>-<short-description>` | `fix/57-pagination-off-by-one` |
| **Chore** | `chore/<description>` | `chore/update-dependencies` |
| **Docs** | `docs/<description>` | `docs/add-api-endpoints` |
| **Refactor** | `refactor/<description>` | `refactor/extract-table-hook` |

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
- **Branch from `main`**: Always create feature/fix branches from the latest `main`.
- **Keep branches short-lived**: Ideally less than 3 days. Large features should be split.
- **Delete after merge**: Clean up remote branches after PR is merged.

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
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, semicolons) |
| `refactor` | Code changes that neither fix bugs nor add features |
| `perf` | Performance improvements |
| `test` | Adding or fixing tests |
| `chore` | Build process, dependencies, tooling |
| `ci` | CI configuration changes |

### Scope Examples

| Scope | Area |
|---|---|
| `dashboard` | Dashboard page |
| `restaurants` | Restaurant CRUD |
| `auth` | Authentication |
| `ui` | UI component library |
| `electron` | Electron main process |
| `api` | API client or backend routes |
| `settings` | Settings pages |
| `deps` | Dependencies |

### Examples

```
feat(restaurants): add CSV export for restaurant list

fix(dashboard): correct subscription percentage calculation

docs(api): document all admin endpoints

refactor(ui): extract shared table pagination component

chore(deps): upgrade react-router-dom to v7

ci: add GitHub Actions workflow for PR checks
```

---

## 6. Pull Request Guidelines

### PR Checklist

Before submitting, ensure:

- [ ] Branch is up to date with `main` (rebased, not merged)
- [ ] TypeScript type check passes (`npm run build:react`)
- [ ] No ESLint warnings or errors
- [ ] All manual testing complete
- [ ] New components follow the component guidelines
- [ ] New API modules follow the API integration pattern
- [ ] Dark mode tested for new UI components
- [ ] Loading, empty, and error states handled
- [ ] Responsive layout verified (1024px minimum)
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

## Screenshots
[If applicable]

## Testing
Describe how you tested the changes.

## Checklist
- [ ] Type check passes
- [ ] Manual testing complete
- [ ] Dark mode verified
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
- **Use hooks**: All state and effects in hooks. No lifecycle methods.
- **Use proper types**: Prefer `interface` over `type` for object shapes.
- **Avoid `any`**: Use `unknown` if type is truly unknown, then narrow.
- **No `// @ts-ignore`**: Find the correct type or fix the issue.
- **No `// @ts-nocheck`**: Files without types should not be committed.

### File Organization

```
src/
├── pages/          — One file per route/page component
├── components/
│   └── ui/         — Reusable UI primitives (one component per file)
├── api/            — API modules (one per entity)
├── context/        — React context providers
├── layouts/        — Layout components
├── hooks/          — Custom hooks (if any)
├── utils/          — Utility functions
└── types/          — Shared type definitions
```

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| **Components** | PascalCase | `RestaurantCard`, `Button` |
| **Functions** | camelCase | `getDashboardStats` |
| **Files** | camelCase | `subscriptions.tsx` |
| **Hooks** | camelCase with `use` prefix | `useOrders` |
| **Context** | PascalCase with `Context` suffix | `AuthContext` |
| **API modules** | camelCase | `restaurants.ts` |
| **Types/Interfaces** | PascalCase | `Restaurant`, `PaginatedResponse` |
| **Constants** | UPPER_SNAKE_CASE | `CACHE_TTL` |
| **CSS classes** | kebab-case | `btn-primary` (Tailwind) |

### Imports Order

```typescript
// 1. React and framework imports
import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'

// 2. Third-party libraries
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'

// 3. Local components
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

// 4. API modules
import { getRestaurants } from '../api/restaurants'

// 5. Types
import type { Restaurant } from '../types'

// 6. Utilities
import { formatDate } from '../utils/format'

// 7. Styles (imported last via Vite)
import './style.css'
```

---

## 8. Component Guidelines

### Component Structure

```tsx
// Imports
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

// Types (colocated or imported)
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

// Component
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'base-styles',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'
```

### Rules

- **One component per file** (except tightly coupled small components).
- **Use `cn()` for class merging**: Always wrap Tailwind classes with the `cn()` utility.
- **Use `displayName`**: Set `displayName` on all forwardRef components.
- **Handle all states**: Loading, empty, error, and success states are required.
- **Support dark mode**: Every component must have `dark:` variants.
- **Support responsive**: Test at minimum width of 1024px.
- **No inline styles**: Use Tailwind classes or CSS variables.

---

## 9. API Integration

### Module Pattern

```typescript
// api/restaurants.ts
import apiClient from './client'

export interface RestaurantsFilter {
  page?: number
  limit?: number
  search?: string
  status?: string
}

export async function getRestaurants(filters: RestaurantsFilter = {}): Promise<PaginatedResponse<Restaurant>> {
  const { data } = await apiClient.get('/admin/restaurants', { params: filters })
  return data
}

export async function createRestaurant(payload: CreateRestaurantPayload): Promise<Restaurant> {
  const { data } = await apiClient.post('/admin/restaurants', payload)
  return data
}
```

### Rules

- **One file per entity**: Group related endpoints in the same file.
- **Typed parameters and return types**: Every function is fully typed.
- **Use query params object**: For list endpoints, use a filters interface.
- **Error handling in pages**: API modules throw errors; pages catch them via React Query.
- **No raw axios calls in components**: Always go through an API module.

---

## 10. Testing

Currently the project does not have automated tests configured. When contributing tests:

- **Unit tests**: Vitest with jsdom environment
- **Component tests**: React Testing Library
- **E2E tests**: Playwright

### Testing Convention (Future)

```
src/
├── __tests__/          — Test files (mirroring source structure)
│   ├── components/     — Component tests
│   ├── utils/          — Utility tests
│   └── api/            — API integration tests
e2e/                    — E2E test files
```

---

## 11. Documentation

### When to Update Docs

- **New feature**: Update README and PRD if scope changed
- **New API endpoint**: Document in the API section
- **Architecture change**: Update ARCHITECTURE.md
- **New decision**: Add ADR to DECISIONS.md
- **New dependency**: Update tech stack in README

### Documentation Files

| File | When to Update |
|---|---|
| `README.md` | Setup changes, new features, dependency updates |
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

1. **Correctness**: Does the code do what it's supposed to?
2. **Type Safety**: Are types correct and complete?
3. **Edge Cases**: Are loading, error, and empty states handled?
4. **Dark Mode**: Do new components render correctly in dark mode?
5. **Performance**: Are there unnecessary re-renders or API calls?
6. **Consistency**: Does the code follow project conventions?
7. **Security**: Are there XSS, CSRF, or auth bypass risks?
8. **Accessibility**: Are interactive elements keyboard-accessible?

### Reviewer Responsibilities

- Review within the agreed timeline
- Be specific and constructive in feedback
- Approve only when all concerns are addressed
- Verify the PR checklist is complete

---

## 13. Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes (incompatible API changes, breaking UI changes)
- **MINOR**: New features (backward-compatible)
- **PATCH**: Bug fixes (backward-compatible)

### Release Steps

```
1. Ensure all PRs for the release are merged to main
2. Create a release branch: release/vX.Y.Z
3. Update CHANGELOG.md with the new version
4. Update version in package.json
5. Create a PR from release branch to main
6. After merge, tag the commit: git tag vX.Y.Z
7. Push tag: git push origin vX.Y.Z
8. Build and package: npm run package
9. Upload installers to release page
```
