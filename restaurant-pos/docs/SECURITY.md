# Security Policy
## Restaurant POS — Point of Sale & Restaurant Management System

## Supported Versions

| Version | Supported |
|---|---|
| 1.x | ✅ Supported |
| < 1.0 | ❌ Not supported |

---

## Reporting a Vulnerability

We take the security of the Restaurant POS system seriously — especially given that it handles financial transactions, customer data, and restaurant operations. If you discover a security vulnerability, please follow the steps below.

### Disclosure Process

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. **Do NOT** post details to public forums, social media, or chat channels
3. **Do** email the details to the project maintainers at **[INSERT CONTACT EMAIL]**
4. **Do** include as much information as possible:
   - Type of vulnerability
   - Steps to reproduce
   - Affected versions
   - Potential impact (especially financial or data-related)
   - Whether the issue occurs online, offline, or both
   - What role context was used (Owner, Manager, Cashier)
   - Suggested fix (if any)

### Response Timeline

| Stage | Timeframe |
|---|---|
| **Acknowledgement** | Within 24 hours |
| **Initial Assessment** | Within 3 business days |
| **Fix Development** | Based on severity |
| **Public Disclosure** | After fix is released |

### Severity Guidelines

| Severity | Response Time | Example |
|---|---|---|
| **Critical** | < 3 days | Payment bypass, auth bypass, data breach |
| **High** | < 7 days | Privilege escalation, invoice manipulation, customer data exposure |
| **Medium** | < 21 days | XSS, CSRF, session fixation |
| **Low** | < 60 days | Minor misconfigurations, logging best practices |

---

## Security Architecture

### Authentication

| Layer | Mechanism |
|---|---|
| **Owner Registration** | Unique credentials created during first-time setup |
| **Staff Login** | PIN-based (Cashier) and username/password (Manager) |
| **JWT Tokens** | Access token + refresh token rotation |
| **Password Storage** | bcrypt hashing with salt rounds |
| **Session Lock** | PIN or credentials re-entry to unlock |

### Authorization

| Layer | Mechanism |
|---|---|
| **Role Enforcement** | Owner (full), Manager (configurable), Cashier (restricted) |
| **Workspace Gating** | Per-workspace access check before rendering |
| **Route Protection** | `requireRole('Owner', 'Manager')` on sensitive API endpoints |
| **Product/Order/Bill Mutations** | Owner/Manager only for destructive operations |

### Transport Security

| Layer | Measure |
|---|---|
| **API Communication** | HTTPS enforced in production |
| **CORS** | Backend restricts origins to known frontend URLs |
| **API Proxy (Dev)** | Vite dev server proxies `/api` to backend |

### Offline Data Security

| Layer | Measure |
|---|---|
| **localStorage Persistence** | Data stored in browser's sandboxed localStorage |
| **No Sensitive Data in Storage** | Passwords are never stored client-side |
| **Sync Security** | Data synced via authenticated API calls |
| **Offline Invoice IDs** | Local counter; duplicates possible but detectable |

### Payment Security

| Layer | Measure |
|---|---|
| **Double-Click Guard** | Ref-based synchronous guard prevents duplicate payment processing |
| **Sequential Processing** | Customer update queue prevents race conditions |
| **Atomic Invoice Counters** | Backend `$inc` operation ensures unique invoice numbers |
| **No Card Storage** | Payment method names stored, not card numbers |
| **Invoice Audit Trail** | All bills linked to cashier name and timestamp |

### Input Validation

| Layer | Measure |
|---|---|
| **API Validation** | Zod schemas validate all request bodies, params, and queries |
| **TypeScript Types** | Static type checking prevents type-based injection |
| **XSS Prevention** | React's built-in XSS escaping (JSX auto-escapes) |
| **Price Validation** | Client-side and server-side price calculation consistency |

### AI Security

| Layer | Measure |
|---|---|
| **API Key Management** | AI provider API keys stored server-side only (in `.env`) |
| **Feature Toggles** | Individual AI features can be disabled by Owner |
| **Data Sent to AI** | Only aggregated, non-sensitive data for AI analysis |

---

## Threat Model

### Assets

| Asset | Classification | Description |
|---|---|---|
| **Payment Transactions** | Critical | Bills, invoice numbers, payment methods, amounts |
| **Customer Data** | High | Names, phone numbers, email, purchase history, points |
| **Auth Credentials** | Critical | JWT tokens, PINs, passwords, refresh tokens |
| **Order Data** | High | Orders, KOT records, timeline events |
| **Employee Accounts** | High | Roles, PINs, login sessions |
| **Settings & Configuration** | Medium | Restaurant info, GSTIN, printer config |
| **AI API Keys** | Critical | Backend `.env` — never exposed to client |
| **Product Data** | Low | Menu items, prices, categories |
| **Offline Cache** | Medium | localStorage copy of all above data |

### Threats & Mitigations

| Threat | Risk | Mitigation |
|---|---|---|
| **Payment processing bypass** | Critical | Double-click guard, sequential processing queue, atomic invoice counters |
| **Unauthorized role escalation** | High | Backend `requireRole()` + frontend workspace gating |
| **Offline data theft** | High | Browser's sandboxed localStorage; no sensitive financial data stored |
| **Invoice number collision** | Medium | Backend atomic `$inc` counter; offline fallback with manual resolution |
| **Cashier viewing sensitive settings** | Medium | Workspace gating redirects Cashiers from Settings/Staff/Branches |
| **Manager privilege escalation** | Medium | Permission toggles enforced both frontend and backend |
| **Brute force login** | Medium | Rate limiting with IP-based window + account-based exponential backoff |
| **KOT manipulation** | Medium | Timeline events record all KOT actions with actor |
| **AI API key leakage** | High | Keys stored server-side only; never sent to client |
| **Duplicate bill creation** | Medium | Invoice counter guard; bill creation linked to cashier session |

---

## Security Best Practices

### For Developers

1. **Never hardcode secrets** — Use environment variables for all secrets
2. **Never commit `.env` files** — Add `.env` to `.gitignore`
3. **Use TypeScript types** — Static typing prevents injection vulnerabilities
4. **Validate all inputs** — Use Zod schemas on all API endpoints
5. **Test offline-first flow** — Security must work without internet
6. **Test role enforcement** — Verify Cashier cannot access Manager/Owner features
7. **Keep AI keys server-side** — Never expose `AI_API_KEY` to frontend
8. **Handle errors safely** — Never expose stack traces in production
9. **Keep dependencies updated** — Regularly run `npm audit`

### For Restaurant Owners

1. **Use strong Owner password** — Minimum 12 characters, unique per installation
2. **Review Manager permissions** — Only enable features your managers need
3. **Monitor invoice numbers** — Duplicates indicate offline sync conflicts
4. **Run daily Z-reports** — Verify totals against expected revenue
5. **Check activity feed** — Review for unusual actions
6. **Set up rate limiting** — Configure in backend `.env` before production
7. **Enable HTTPS** — All API traffic must be encrypted

### For Cashier/Staff

1. **Lock terminal when leaving** — Use the Lock button or switch user
2. **Never share PINs** — Each cashier has a unique PIN
3. **Verify payment amounts** — Check totals before confirming payment
4. **Report suspicious activity** — Notify Owner of unexpected behavior

### For Production Deployment

1. **Set strong JWT secrets** — Minimum 256-bit random strings
2. **Enable HTTPS** — Encrypt all API traffic
3. **Restrict CORS** — Limit to known frontend origins
4. **Configure rate limiting** — Set appropriate limits for auth routes
5. **Secure AI API keys** — Store in environment variables, not in code
6. **Regular backups** — Backup MongoDB database daily
7. **Monitor invoice counters** — Check for gaps or duplicates

---

## Dependency Security

### Audit Process

```bash
# Check for known vulnerabilities
npm audit

# Update dependencies safely
npm update

# Check for out-of-date packages
npx npm-check-updates
```

### Critical Dependencies

| Dependency | Risk | Mitigation |
|---|---|---|
| **Electron** | High (Chromium CVEs) | Update promptly; subscribe to Electron security announcements |
| **Express** | Medium | Keep updated; follow Express security advisories |
| **Mongoose / MongoDB** | Medium | Validate queries; prevent NoSQL injection |
| **Axios** | Low | Regular updates via `npm audit` |
| **Google Generative AI** | Medium | API key security; monitor usage for anomalies |
| **bcrypt** | Low | Well-established; update for vulnerability patches |
| **Playwright** | Low | Dev dependency; no production risk |

---

## Security Contact

For security-related inquiries, please contact:

- **Email**: [INSERT CONTACT EMAIL]
- **Response SLA**: Within 24 hours for critical issues (payment/auth related)

---

## Disclosure Policy

We follow a **coordinated disclosure** process:

1. Reporter submits vulnerability details via email
2. Project maintainers acknowledge receipt within 24 hours
3. Maintainers investigate and develop a fix
4. Fix is released in a patch/minor version
5. Reporter is credited (if desired) after public disclosure
6. Full details are published after the fix is deployed

We kindly request a **90-day disclosure window** from the time of acknowledgement to allow for fix development and release.

For payment-related or customer data vulnerabilities, we may request an extended window to ensure all affected deployments are patched before public disclosure.
