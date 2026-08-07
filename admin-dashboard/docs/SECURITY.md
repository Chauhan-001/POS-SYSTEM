# Security Policy
## Admin Dashboard — Restaurant Chain Management Platform

## Supported Versions

| Version | Supported |
|---|---|
| 1.x | ✅ Supported |
| < 1.0 | ❌ Not supported |

---

## Reporting a Vulnerability

We take the security of the Admin Dashboard seriously. If you discover a security vulnerability, please follow the steps below.

### Disclosure Process

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. **Do NOT** post details to public forums, social media, or chat channels
3. **Do** email the details to the project maintainers at **[INSERT CONTACT EMAIL]**
4. **Do** include as much information as possible:
   - Type of vulnerability
   - Steps to reproduce
   - Affected versions
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Stage | Timeframe |
|---|---|
| **Acknowledgement** | Within 48 hours |
| **Initial Assessment** | Within 5 business days |
| **Fix Development** | Based on severity |
| **Public Disclosure** | After fix is released |

### Severity Guidelines

| Severity | Response Time | Example |
|---|---|---|
| **Critical** | < 7 days | Remote code execution, auth bypass, data exposure |
| **High** | < 14 days | SQL injection, privilege escalation |
| **Medium** | < 30 days | XSS, CSRF, information disclosure |
| **Low** | < 90 days | Minor misconfigurations, best practice violations |

---

## Security Architecture

### Authentication

| Layer | Mechanism |
|---|---|
| **Admin Login** | JWT-based authentication with Bearer tokens |
| **Session Management** | Token-based (no cookies); stored in localStorage |
| **Token Expiry** | Access token: 15 minutes; Refresh token: 7 days |
| **Password Storage** | bcrypt hashing with salt rounds |

### Authorization

| Layer | Mechanism |
|---|---|
| **Route Protection** | `requireAuth` middleware validates JWT on every request |
| **Collection Access** | `requireCollectionAccess` middleware checks CRUD permissions per entity |
| **Frontend Guards** | `ProtectedRoute` component redirects unauthenticated users to login |
| **401 Handling** | Axios interceptor clears tokens and redirects to `/login` |

### Transport Security

| Layer | Measure |
|---|---|
| **API Communication** | HTTPS enforced in production |
| **CORS** | Backend restricts origins; Vite dev server proxies to backend |
| **API Proxy (Dev)** | Vite dev server proxies `/api` to backend to avoid cross-origin issues |

### Electron Security

| Layer | Measure |
|---|---|
| **Context Isolation** | Enabled — renderer cannot access Node.js or Electron APIs directly |
| **Node Integration** | Disabled — no `require()` in renderer |
| **Sandbox** | Enabled — renderer process is sandboxed |
| **Web Security** | Enabled — CORS and CSP enforced |
| **Preload Script** | Exposes only specific, sanitized APIs via `contextBridge` |
| **IPC Channels** | Narrow, explicitly defined channels (no wildcard IPC) |

### Input Validation

| Layer | Measure |
|---|---|
| **API Validation** | Zod schemas validate all request bodies, params, and queries |
| **TypeScript Types** | Static type checking prevents type-based injection |
| **XSS Prevention** | React's built-in XSS escaping (JSX auto-escapes) |
| **Error Messages** | No stack traces exposed in production API responses |

### Data Protection

| Data Type | Protection |
|---|---|
| **Passwords** | bcrypt hashed, never stored in plaintext |
| **JWT Tokens** | Signed with HMAC-SHA256; stored in localStorage |
| **API Responses** | No sensitive data in error messages |
| **Restaurant Data** | Access controlled by collection-level authorization |

---

## Threat Model

### Assets

| Asset | Classification | Description |
|---|---|---|
| **Admin Credentials** | Critical | JWT tokens, passwords, refresh tokens |
| **Restaurant Data** | High | Restaurant profiles, status, plan details |
| **Owner Data** | High | Owner names, emails, phone numbers |
| **Subscription Data** | High | Plan details, prices, expiry dates |
| **Device Registry** | Medium | Device IDs, OS versions, last login times |
| **Analytics Data** | Low | Aggregated usage statistics |

### Threats & Mitigations

| Threat | Risk | Mitigation |
|---|---|---|
| **Unauthorized admin access** | Critical | JWT authentication, rate limiting, account lockout |
| **Privilege escalation** | High | Collection-level authorization on every endpoint |
| **Data breach via API** | High | Input validation, Zod schemas, HTTPS |
| **Electron renderer compromise** | High | Context isolation, sandbox, no nodeIntegration |
| **CSRF via Electron** | Medium | Token-based auth (Bearer header, not cookies) |
| **XSS via admin input** | Medium | React auto-escaping, Content Security Policy |
| **Brute force login** | Medium | Rate limiting with IP-based and account-based backoff |
| **Token theft (XSS)** | Medium | Short-lived access tokens (15 min), refresh token rotation |
| **Insecure direct object reference** | High | Authorization middleware checks ownership/permissions |

---

## Security Best Practices

### For Developers

1. **Never hardcode secrets** — Use environment variables for all secrets
2. **Never commit `.env` files** — Add `.env` to `.gitignore`
3. **Use TypeScript types** — Static typing prevents injection vulnerabilities
4. **Validate all inputs** — Use Zod schemas on all API endpoints
5. **Handle errors safely** — Never expose stack traces in production
6. **Keep dependencies updated** — Regularly run `npm audit` and update vulnerable packages
7. **Use the cn() utility** — Avoid dangerous `dangerouslySetInnerHTML`
8. **Review Electron changes carefully** — Main process changes can have security implications

### For Production Deployment

1. **Set strong JWT secrets** — Minimum 256-bit random strings for `JWT_SECRET` and `REFRESH_SECRET`
2. **Enable HTTPS** — All API traffic must be encrypted
3. **Restrict CORS** — Limit to known frontend origins
4. **Enable rate limiting** — Configure rate limits in backend `.env`
5. **Disable registration** — Set `maintenanceMode` or disable public registration in production
6. **Use environment-specific configs** — Separate `.env` files per environment
7. **Monitor audit logs** — Track admin actions for security incidents

### For Electron Build

1. **Enable sandbox** — Already configured; do not disable
2. **Context isolation** — Already enabled; do not disable
3. **No nodeIntegration** — Already disabled; do not enable
4. **Validate IPC input** — All IPC channels should validate their inputs
5. **Use preload scripts** — Never expose Node.js APIs directly to renderer

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
| **Electron (35)** | High (Chromium CVEs) | Update promptly when new versions released |
| **Express** | Medium | Keep updated, follow Express security advisories |
| **Axios** | Low | Regular updates via `npm audit` |
| **React, React DOM** | Low | Fast response to CVEs; auto-update |
| **Mongoose / MongoDB driver** | Medium | Validate queries; prevent NoSQL injection |

---

## Security Contact

For security-related inquiries, please contact:

- **Email**: [INSERT CONTACT EMAIL]
- **Response SLA**: Within 48 hours for critical issues

---

## Disclosure Policy

We follow a **coordinated disclosure** process:

1. Reporter submits vulnerability details via email
2. Project maintainers acknowledge receipt within 48 hours
3. Maintainers investigate and develop a fix
4. Fix is released in a patch/minor version
5. Reporter is credited (if desired) after public disclosure
6. Full details are published after the fix is deployed

We kindly request a **90-day disclosure window** from the time of acknowledgement to allow for fix development and release.
