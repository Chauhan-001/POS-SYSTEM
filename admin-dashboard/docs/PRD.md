# Product Requirements Document (PRD)
## Admin Dashboard — Restaurant Chain Management Platform

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** July 27, 2026

---

## 1. Executive Summary

The **Admin Dashboard** is a centralized management platform for restaurant chains and multi-branch restaurant businesses. It enables super-admins and support staff to manage all registered restaurants, owners, devices, subscriptions, and platform-wide settings from a single interface. Delivered as both a desktop Electron application and a web app.

---

## 2. Product Vision

Provide restaurant operators and platform administrators with a unified, real-time command center to monitor, manage, and scale their restaurant network — handling everything from subscription billing to device fleet management and AI-powered analytics.

---

## 3. Target Users

| Persona | Description |
|---|---|
| **Super Admin** | Full platform access — manages all restaurants, owners, subscriptions, system settings |
| **Support Agent** | Searches and resolves restaurant/owner issues, views device and subscription details |
| **Account Manager** | Manages subscriptions, upgrades/downgrades plans, handles renewals |

---

## 4. Functional Requirements

### 4.1 Authentication & Authorization

| ID | Feature | Description | Priority |
|---|---|---|---|
| AUTH-01 | Admin Login | Secure login with JWT authentication | P0 |
| AUTH-02 | Session Management | Token-based sessions with refresh tokens | P0 |
| AUTH-03 | Profile Management | View and update admin profile, change password | P1 |
| AUTH-04 | Role-Based Access | Granular collection-level permissions (read/create/update/delete) | P1 |

### 4.2 Dashboard

| ID | Feature | Description | Priority |
|---|---|---|---|
| DASH-01 | Overview Stats | Real-time stats: total/active restaurants, total owners, active devices | P0 |
| DASH-02 | Subscription Summary | Active/paused/expired subscription counts with percentages | P0 |
| DASH-03 | Recent Activity Feed | Chronological feed of platform-wide actions | P1 |
| DASH-04 | Latest Restaurants | Recently registered restaurants with quick status badges | P1 |
| DASH-05 | Quick Actions | One-click navigation to common admin tasks | P1 |

### 4.3 Restaurant Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| REST-01 | List Restaurants | Paginated, searchable, filterable list of all restaurants | P0 |
| REST-02 | View Restaurant Details | Detailed view with owner info, devices, subscription, settings | P0 |
| REST-03 | Create Restaurant | Register new restaurant with name, phone, plan, max devices | P0 |
| REST-04 | Edit Restaurant | Update restaurant details, upgrade/downgrade plan | P0 |
| REST-05 | Suspend/Activate | Temporarily disable or re-enable a restaurant | P0 |
| REST-06 | Delete Restaurant | Permanently remove a restaurant from the platform | P1 |

### 4.4 Owner Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| OWN-01 | List Owners | Paginated list of all restaurant owners | P0 |
| OWN-02 | View Owner | Detailed owner profile with associated restaurants | P0 |
| OWN-03 | Update Owner | Edit owner details | P1 |
| OWN-04 | Reset Password | Force password reset for owner accounts | P1 |
| OWN-05 | Activate/Deactivate | Enable or disable owner accounts | P1 |

### 4.5 Device Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| DEV-01 | List Devices | All registered POS devices across all restaurants | P0 |
| DEV-02 | Device Details | Device info: OS version, app version, last login, registration | P0 |
| DEV-03 | Block/Unblock | Remotely block or unblock a device from the POS system | P1 |

### 4.6 Subscription Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| SUB-01 | List Subscriptions | Searchable, filterable list of all subscriptions | P0 |
| SUB-02 | Subscription Details | Plan, status, price, expiry, max devices, AI features | P0 |
| SUB-03 | Renew Subscription | Extend subscription period | P0 |
| SUB-04 | Upgrade/Downgrade | Change subscription plan tier | P0 |
| SUB-05 | Pause/Resume | Temporarily pause or resume a subscription | P1 |

### 4.7 Analytics

| ID | Feature | Description | Priority |
|---|---|---|---|
| ANL-01 | Restaurant Growth | Area chart showing restaurant registration trends | P1 |
| ANL-02 | Daily Logins | Bar chart of daily login activity | P1 |
| ANL-03 | Subscription Trends | Line chart of subscription growth over time | P1 |
| ANL-04 | AI Usage Chart | Area chart of AI feature usage trends | P1 |
| ANL-05 | Most Active Restaurants | Horizontal bar chart of top-performing restaurants | P1 |

### 4.8 AI Usage Monitoring

| ID | Feature | Description | Priority |
|---|---|---|---|
| AI-01 | AI Requests Counter | Total AI requests across all restaurants | P1 |
| AI-02 | Daily/Period Usage | Usage metrics with daily average and peak day | P1 |
| AI-03 | Usage Charts | Bar and area charts of AI request trends | P2 |
| AI-04 | Feature Status Overview | Which AI features are enabled/disabled across the platform | P2 |

### 4.9 Support Search

| ID | Feature | Description | Priority |
|---|---|---|---|
| SUP-01 | Unified Search | Search across restaurants, owners, subscriptions, and devices | P1 |
| SUP-02 | Multi-Criteria | Search by keyword, restaurant ID, phone, or name | P1 |
| SUP-03 | Result Cards | Combined view showing restaurant, owner, subscription, and device info | P1 |

### 4.10 System Settings

| ID | Feature | Description | Priority |
|---|---|---|---|
| SET-01 | Company Information | Edit company name, email, phone, address | P0 |
| SET-02 | Default Subscription Config | Set default plan, max devices, trial days, AI toggle | P1 |
| SET-03 | AI Settings | Global AI enable/disable, daily request limits, model selection | P1 |
| SET-04 | General Configuration | Registration toggle, maintenance mode, timezone, language | P1 |

---

## 5. Non-Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| NFR-01 | Desktop App | Electron-based desktop application for Windows, macOS, Linux |
| NFR-02 | Web Support | Vite-based web build for browser access |
| NFR-03 | Performance | Sub-second page loads, lazy-loaded route components |
| NFR-04 | Responsive Design | Works on all screen sizes with dark mode support |
| NFR-05 | Security | JWT authentication, context isolation, sandboxed Electron renderer |
| NFR-06 | Offline Resilience | Graceful error handling with retry mechanisms |
| NFR-07 | Packaging | NSIS (Windows), DMG (macOS), AppImage/Deb (Linux) installer support |
| NFR-08 | Auto-Update | Electron auto-updater integration for seamless updates |

---

## 6. Technical Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | React 19, TypeScript 6 |
| **Build Tool** | Vite 8 |
| **Styling** | Tailwind CSS 4 |
| **Desktop Shell** | Electron 35 |
| **State Management** | TanStack React Query |
| **Routing** | React Router DOM v7 |
| **HTTP Client** | Axios |
| **Charts** | Recharts |
| **UI Icons** | Lucide React |
| **Forms** | React Hook Form + @hookform/resolvers |
| **Notifications** | React Hot Toast |
| **CSS Utilities** | clsx, tailwind-merge |
| **Backend** | Node.js + Express |
| **Database** | MongoDB (via Mongoose) |
| **Auth** | JWT with refresh tokens |

---

## 7. UI/UX Guidelines

### 7.1 Design Principles
- **Data Density**: Maximize information per screen for admin efficiency
- **Consistency**: Uniform component library (Button, Card, Table, Badge, Modal)
- **Dark Mode**: Full dark mode support with automatic theme detection
- **Accessibility**: Keyboard navigation, focus states, semantic HTML

### 7.2 Layout
- Sidebar navigation with collapsible sections
- Top navbar with search, notifications, profile menu
- Content area with card-based layouts
- Tables with sorting, search, pagination

### 7.3 Key Screens
1. **Login** — Centered form with branding
2. **Dashboard** — Stats grid + activity feed + latest restaurants + subscription overview + quick actions
3. **Restaurants** — Data table with CRUD modals
4. **Restaurant Detail** — Tabs for overview, devices, subscriptions, settings
5. **Owners** — Data table with detail view
6. **Devices** — Data table with block/unblock actions
7. **Subscriptions** — Data table with renew/pause/resume actions
8. **Analytics** — Multi-chart dashboard with area, bar, line charts
9. **AI Usage** — Metrics cards + charts + feature status grid
10. **Settings** — Sectioned settings with inline editing

---

## 8. Architecture

```
┌─────────────────────────────────────┐
│          Electron Shell             │
│  ┌───────────────────────────────┐  │
│  │   Vite Dev / Build (React)   │  │
│  │  ┌─────────┐ ┌────────────┐  │  │
│  │  │  Pages  │ │Components  │  │  │
│  │  ├─────────┤ ├────────────┤  │  │
│  │  │  React  │ │  Hooks &   │  │  │
│  │  │  Query  │ │  Context   │  │  │
│  │  └─────────┘ └────────────┘  │  │
│  │  ┌────────────────────────┐  │  │
│  │  │   API Client (Axios)   │  │  │
│  │  └────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ HTTP/REST
┌──────────────▼──────────────────────┐
│         Backend (Express)           │
│  ┌──────────┐ ┌──────────────────┐  │
│  │  Auth    │ │  Controllers     │  │
│  │  Middleware│ │  + Services     │  │
│  └──────────┘ └──────────────────┘  │
│  ┌──────────────────────────────┐   │
│  │   MongoDB (Mongoose Models)  │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 9. Dependencies & Integrations

- **Backend API**: RESTful backend running on port 3002
- **Authentication**: JWT-based with Bearer token header
- **Auto-Updater**: Electron builder auto-update mechanism

---

## 10. Future Considerations

| Feature | Description | Priority |
|---|---|---|
| Multi-language support | i18n for international admin teams | P3 |
| Audit logging | Comprehensive admin action audit trail | P3 |
| Bulk operations | Bulk suspend/activate/delete restaurants | P3 |
| Advanced analytics | Custom date ranges, export to CSV/PDF | P3 |
| Team management | Multi-admin with roles and permissions | P3 |
| Notification center | In-app and email notifications for expirations, issues | P2 |
| White-labeling | Custom branding per restaurant chain | P3 |
