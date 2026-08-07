# Support
## Admin Dashboard — Restaurant Chain Management Platform

Welcome! This document provides troubleshooting resources, frequently asked questions, and community links for the Admin Dashboard.

---

## Table of Contents

1. [Getting Help](#1-getting-help)
2. [Frequently Asked Questions (FAQ)](#2-frequently-asked-questions-faq)
3. [Common Issues & Solutions](#3-common-issues--solutions)
4. [Reporting Bugs](#4-reporting-bugs)
5. [Feature Requests](#5-feature-requests)
6. [Community & Resources](#6-community--resources)
7. [Documentation](#7-documentation)

---

## 1. Getting Help

### Before You Ask

1. **Check the documentation** — Refer to the project docs in the `README.md` and `docs/` folder
2. **Search existing issues** — Your question may have been answered already
3. **Check this guide** — Many common problems are listed below

### How to Get Help

| Channel | Description | Response Time |
|---|---|---|
| **GitHub Issues** | Bug reports, feature requests, questions | 1–3 business days |
| **Documentation** | README, PRD, ARCHITECTURE, AGENTS docs | Always available |
| **Code Review** | Inline comments on PRs and commits | Varies |

---

## 2. Frequently Asked Questions (FAQ)

### General

**Q: What is the Admin Dashboard?**  
A: A centralized management platform for restaurant chains and multi-branch restaurant businesses. It enables super-admins to manage restaurants, owners, devices, subscriptions, and platform settings from a single interface.

**Q: Can I run it as a web app instead of a desktop app?**  
A: Yes. Run `npm run dev:web` to start the Vite dev server. The app works fully in a browser.

**Q: What browsers are supported?**  
A: Chrome, Firefox, Safari, and Edge (latest 2 versions). Electron uses Chromium.

### Setup & Installation

**Q: What are the system requirements?**  
A: Node.js 22+, npm 10+, MongoDB 6+. Desktop version requires additional ~150MB for Electron.

**Q: How do I set up the backend?**  
A: See the [README](./README.md#quick-start) for step-by-step setup instructions.

**Q: The app shows a blank screen. What's wrong?**  
A: Likely one of: backend not running, port conflict, or missing build step. See the troubleshooting section.

### Authentication

**Q: How do I log in for the first time?**  
A: Default credentials: username `admin`, password `1111`. These are seeded automatically when the backend starts.

**Q: I'm stuck on the login screen. What should I do?**  
A: Ensure the backend is running on port 3002. Check the browser console for API errors.

### Features

**Q: How do I create a new restaurant?**  
A: Navigate to Restaurants → Click "Add Restaurant" → Fill in the form → Click "Create".

**Q: How do I upgrade a subscription?**  
A: Navigate to Subscriptions → Find the subscription → Click "Upgrade" → Select new plan.

**Q: Can I export data?**  
A: CSV/PDF export is planned for a future release. Currently data is viewed in-app.

---

## 3. Common Issues & Solutions

### Backend Connection

| Symptom | Likely Cause | Solution |
|---|---|---|
| "Failed to load dashboard stats" | Backend not running | Start backend: `cd ../backend && npm run dev` |
| "Network Error" in console | MongoDB not running | Start MongoDB: `mongod --dbname pos` |
| "401 Unauthorized" | Token expired | Refresh the page to redirect to login |
| "CORS error" | Backend CORS not configured | Set `CORS_ORIGIN` env var to match frontend URL |

### Frontend

| Symptom | Likely Cause | Solution |
|---|---|---|
| Blank white screen | Missing dependencies | Run `npm install` |
| "Cannot find module" error | Missing dependencies | Run `npm install` and restart dev server |
| Stale data shown | React Query cache | Hard refresh (Ctrl+Shift+R) |
| CSS styles not applied | Tailwind not loading | Check that `@tailwindcss/vite` plugin is installed |
| Page not found on navigation | Incorrect route | Start from `/dashboard` or the root URL |

### Electron Desktop

| Symptom | Likely Cause | Solution |
|---|---|---|
| Electron window opens but blank | Build step missing | Run `npm run build:electron` first |
| "Cannot find module 'electron'" | Electron not installed | Run `npm install -D electron` |
| IPC not working | Preload script not loaded | Check that `electron/preload.js` exists |
| DevTools not opening | Dev flag not set | Ensure `NODE_ENV=development` is set |

### Database

| Symptom | Likely Cause | Solution |
|---|---|---|
| "MongoDB connection error" | MongoDB not running | Start MongoDB service: `mongod` |
| Data not persisting | Wrong database | Check `MONGODB_URI` in backend `.env` |
| Seed data missing | Seed failed | Restart backend; seeds run on first connection |

---

## 4. Reporting Bugs

### Before Reporting

1. Search the [issue tracker] for existing reports
2. Check the troubleshooting section above
3. Ensure you're on the latest version

### Bug Report Template

```markdown
## Description
[A clear and concise description of the bug]

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior
[What should happen instead]

## Screenshots
[If applicable]

## Environment
- OS: [e.g., Windows 11, macOS 14, Ubuntu 22.04]
- Browser: [e.g., Chrome 120, Firefox 121]
- Version: [e.g., 1.0.0]
- Mode: [Web / Desktop Electron]

## Additional Context
[Any other relevant information]
```

### Where to Report

Open a new issue on the project's **GitHub Issues** page with the `bug` label.

---

## 5. Feature Requests

Feature requests are welcome! Before submitting:

1. Check the [backlog](./TASKS.md) to see if it's already planned
2. Search existing issues for similar requests
3. Describe the problem you're trying to solve, not just the solution

### Feature Request Template

```markdown
## Problem Statement
[What problem would this feature solve?]

## Proposed Solution
[How do you envision this feature working?]

## Alternatives Considered
[What other approaches have you considered?]

## Additional Context
[Screenshots, mockups, or references]
```

---

## 6. Community & Resources

### Project Resources

| Resource | Description |
|---|---|
| [README.md](./README.md) | Getting started guide |
| [PRD.md](./PRD.md) | Product requirements |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |
| [AGENTS.md](./AGENTS.md) | Build and automation agents |
| [DECISIONS.md](./DECISIONS.md) | Architecture decisions |
| [TASKS.md](./TASKS.md) | Task tracking |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guidelines |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | Community standards |
| [SECURITY.md](./SECURITY.md) | Security policies |

### Development Resources

| Resource | Link |
|---|---|
| **React 19 Docs** | https://react.dev |
| **TypeScript 6** | https://www.typescriptlang.org |
| **Vite 8** | https://vite.dev |
| **Tailwind CSS 4** | https://tailwindcss.com |
| **TanStack React Query 5** | https://tanstack.com/query |
| **Electron 35** | https://www.electronjs.org |
| **Recharts** | https://recharts.org |
| **React Router 7** | https://reactrouter.com |
| **MongoDB** | https://www.mongodb.com |
| **Express** | http://expressjs.com |
| **electron-builder** | https://www.electron.build |

---

## 7. Documentation

All project documentation is available in the repository:

| Document | Location |
|---|---|
| Product Requirements | [PRD.md](./PRD.md) |
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Agents & Automation | [AGENTS.md](./AGENTS.md) |
| README & Setup | [README.md](./README.md) |
| Contributing Guide | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Code of Conduct | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |
| Architecture Decisions | [DECISIONS.md](./DECISIONS.md) |
| Task Tracking | [TASKS.md](./TASKS.md) |
| Security Policy | [SECURITY.md](./SECURITY.md) |
