# Support
## Restaurant POS — Point of Sale & Restaurant Management System

Welcome! This document provides troubleshooting resources, frequently asked questions, and community links for the Restaurant POS system.

---

## Table of Contents

1. [Getting Help](#1-getting-help)
2. [Frequently Asked Questions (FAQ)](#2-frequently-asked-questions-faq)
3. [Common Issues & Solutions](#3-common-issues--solutions)
4. [POS-Specific Troubleshooting](#4-pos-specific-troubleshooting)
5. [Reporting Bugs](#5-reporting-bugs)
6. [Feature Requests](#6-feature-requests)
7. [Community & Resources](#7-community--resources)
8. [Documentation](#8-documentation)

---

## 1. Getting Help

### Before You Ask

1. **Check the documentation** — Refer to the project docs in `README.md` and this guide
2. **Search existing issues** — Your question may have been answered already
3. **Check this guide** — Many common POS problems are listed below

### How to Get Help

| Channel | Description | Response Time |
|---|---|---|
| **GitHub Issues** | Bug reports, feature requests, questions | 1–3 business days |
| **Documentation** | README, PRD, ARCHITECTURE, AGENTS docs | Always available |
| **Code Review** | Inline comments on PRs and commits | Varies |

---

## 2. Frequently Asked Questions (FAQ)

### General

**Q: What is the Restaurant POS?**  
A: A comprehensive, offline-first Point of Sale and restaurant management system. It handles the full order lifecycle — from order creation and kitchen display to billing, payments, and analytics.

**Q: Does it work without internet?**  
A: Yes. The POS is fully offline-first. All core operations work without internet. Data syncs to the cloud automatically when connectivity is restored.

**Q: Can I run multiple POS terminals?**  
A: Yes. Multiple terminals can operate simultaneously. Data syncs between terminals via the backend when online. Invoice numbers are atomically generated to prevent duplicates.

**Q: What platforms are supported?**  
A: Desktop (Windows, macOS, Linux via Electron) and Web (any modern browser).

**Q: Can I print receipts and KOT tickets?**  
A: Yes. The system supports thermal printers (58mm and 80mm) via ESC/POS protocol.

### Setup & Installation

**Q: What are the system requirements?**  
A: Node.js 22+, npm 10+, MongoDB 6+. Desktop requires ~150MB for Electron.

**Q: How do I set up the POS for the first time?**  
A: Follow the [Quick Start](./README.md#quick-start) guide. After starting the backend and frontend, the First Time Setup wizard will guide you through Owner registration.

**Q: I see a blank screen on startup. What's wrong?**  
A: This is usually a backend/MongoDB connection issue. Ensure MongoDB is running and the backend has started successfully. Check the troubleshooting section.

### Features

**Q: How do I create a dine-in order?**  
A: Go to the Orders workspace → Click a table → Select "Dine In" → The system switches to Billing → Add products → Send to kitchen.

**Q: How does the loyalty program work?**  
A: Customers earn points based on spending. Points can be redeemed for rewards (percentage discount, flat discount, or free items). Visit milestones provide bonus rewards.

**Q: Can I customize the receipt?**  
A: Yes. Go to Settings → Receipt to customize print size, logo, footer, QR code, tax summary, and more.

**Q: How do I set up multiple branches?**  
A: Go to Branches → Add Branch → Configure branch settings. Enable multi-branch mode in Settings → Module Toggles.

**Q: What AI features are available?**  
A: 8 AI features: Daily Summary, Inventory Health, Purchase Recommendations, Low Stock Predictions, Waste Analysis, Voice Entry, Weather Recommendations, Closing Assistant.

---

## 3. Common Issues & Solutions

### Backend Connection

| Symptom | Likely Cause | Solution |
|---|---|---|
| Backend won't start | MongoDB not running | Start MongoDB: `mongod --dbname pos` |
| "JWT_SECRET required" error | Missing .env config | Create `.env` from `.env.example` |
| API returns 500 errors | Database connection issue | Check `MONGODB_URI` in `.env` |
| CORS error in console | Backend CORS origin mismatch | Update `CORS_ORIGIN` in backend `.env` |

### Frontend

| Symptom | Likely Cause | Solution |
|---|---|---|
| Blank white screen | Backend unreachable or dependencies missing | Check backend is running; run `npm install` |
| "TypeError: Cannot read properties of undefined" | Missing local state data | Clear localStorage and restart |
| Products not showing in billing | Branch filter active or availability off | Check current branch; verify product availability |
| Slow loading | Large dataset without cache | Ensure localStorage isn't full; clear old bills |
| Styles broken | Tailwind not compiled | Check `@tailwindcss/vite` plugin is installed |

### Offline Mode

| Symptom | Likely Cause | Solution |
|---|---|---|
| Data not syncing | Backend unreachable | Check backend URL and network connectivity |
| "Sync Pending" indicator shows | Unsaved local changes | Wait for auto-sync; or click "Sync" in Sync Panel |
| Conflicts between terminals | Concurrent offline edits | Last-write-wins strategy; manual conflict resolution |
| localStorage full | Too many cached bills | Only last 50 bills are cached; clear old data |

---

## 4. POS-Specific Troubleshooting

### Billing Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| Can't add products to cart | Product availability off | Check product availability toggle in Products |
| Wrong price showing | Variant not selected | Select the correct variant (size/type) |
| GST calculation seems wrong | Per-product GST incorrect | Check GST percentage on each product |
| Discount not applying | Reward conditions not met | Verify minimum bill amount and reward type |
| "Cannot pay — processing" message | Stuck double-click guard | Wait a few seconds; refresh if stuck |

### KOT / Kitchen Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| KOT not printing | Printer not configured | Configure printer in Settings → Receipt |
| Duplicate items sent to kitchen | KOT delta detection failed | Check `lastKotSnapshot` on the order |
| KOT preview shows wrong items | Snapshot out of sync | Re-open the order to rebuild snapshot |
| Kitchen display not updating | Stale data | Wait for polling refresh (30s) or manual refresh |

### Payment Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| "Payment already in progress" | Double-click guard active | Wait a few seconds for processing to complete |
| Invoice number duplicate | Multiple offline terminals | Backend atomic counter prevents duplicates when online |
| Split payment total mismatch | Split amounts don't add up | Ensure split amounts equal the grand total |
| Receipt not auto-printing | Auto-print setting off | Enable in Settings → Receipt |

### Multi-Branch Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| Wrong products showing | Branch filter active | Check current branch in title bar |
| Tables not showing | Tables not configured for this branch | Add tables in Branch Manager |
| Prices different from expected | Per-branch price override active | Check branch pricing settings |
| Branch selector not visible | Multi-branch module disabled | Enable in Settings → Module Toggles |

### Role & Access Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| "Access denied. Redirected to Dashboard." | Insufficient role permissions | Owner can adjust Manager permissions in Settings |
| Can't access Settings | Role is Cashier or Manager without permission | Log in as Owner or request access |
| Can't delete products | Role is Cashier (read-only for products) | Log in as Owner or Manager |
| Can't see Staff page | Manager permission not enabled | Owner enables in Settings → Role Permissions |

### Login Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| First Time Setup not appearing | Owner already exists | Clear localStorage or check backend data |
| "Invalid PIN" for cashier | Wrong PIN entered | Owner can reset cashier PIN in Staff Manager |
| Can't log in after lock | Employee session cleared | Log in again with credentials |
| Login screen loops | Token refresh failing | Clear localStorage and restart |

### Inventory & AI Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| AI features not working | API key not configured | Set `AI_API_KEY` in backend `.env` |
| AI Daily Summary empty | No sales data today | Process at least one bill to generate data |
| Inventory health not scoring | Insufficient data | AI needs history to calculate health scores |
| Voice entry not responding | Microphone permission denied | Grant microphone access in browser/Electron |

---

## 5. Reporting Bugs

### Before Reporting

1. Search the [issue tracker] for existing reports
2. Check the troubleshooting sections above
3. Test if the issue occurs in both web and desktop modes
4. Test if the issue occurs when offline vs online
5. Ensure you're on the latest version

### Bug Report Template

```markdown
## Description
[A clear and concise description of the bug]

## Steps to Reproduce
1. Go to '...' (which workspace?)
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior
[What should happen instead]

## Screenshots / Screen Recordings
[If applicable — especially for UI issues]

## Environment
- OS: [e.g., Windows 11, macOS 14, Ubuntu 22.04]
- Browser: [e.g., Chrome 120, Firefox 121]
- Version: [e.g., 1.0.0]
- Mode: [Web / Desktop Electron]
- Online/Offline: [Was the app online or offline when the issue occurred?]
- Role: [Owner / Manager / Cashier]

## Logs
[Any browser console errors or backend logs]

## Additional Context
[Any other relevant information]
```

### Where to Report

Open a new issue on the project's **GitHub Issues** page with:
- The `bug` label
- The relevant workspace label (e.g., `billing`, `orders`, `kitchen`)

---

## 6. Feature Requests

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

## Affected Workspace
[Which workspace(s) would be affected?]

## Alternatives Considered
[What other approaches have you considered?]

## Additional Context
[Screenshots, mockups, or references]
```

---

## 7. Community & Resources

### Project Resources

| Resource | Description |
|---|---|
| [README.md](./README.md) | Getting started, setup, keyboard shortcuts |
| [PRD.md](./PRD.md) | Product requirements (19 feature areas, 8 AI features) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture (19 sections) |
| [AGENTS.md](./AGENTS.md) | Development, testing, AI, and sync agents |
| [DECISIONS.md](./DECISIONS.md) | Architecture decisions (16 ADRs) |
| [TASKS.md](./TASKS.md) | Task tracking (8 milestones) |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guidelines |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | Community standards |
| [SECURITY.md](./SECURITY.md) | Security policies |

### Development Resources

| Resource | Link |
|---|---|
| **React 19 Docs** | https://react.dev |
| **TypeScript 5.8** | https://www.typescriptlang.org |
| **Vite 6** | https://vite.dev |
| **Tailwind CSS 4** | https://tailwindcss.com |
| **Electron** | https://www.electronjs.org |
| **dnd-kit** | https://dndkit.com |
| **Recharts** | https://recharts.org |
| **Vitest** | https://vitest.dev |
| **Playwright** | https://playwright.dev |
| **MongoDB / Mongoose** | https://mongoosejs.com |
| **Express** | http://expressjs.com |
| **Lucid React Icons** | https://lucide.dev |
| **Motion (Framer Motion)** | https://motion.dev |
| **Google AI** | https://ai.google.dev |

---

## 8. Documentation

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
