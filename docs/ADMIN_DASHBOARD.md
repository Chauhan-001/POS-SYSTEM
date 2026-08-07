# ADMIN_DASHBOARD.md — Multi-Tenant Admin Web Portal Architecture

## Overview

The `admin-dashboard` project is a React web portal built for multi-branch store owners and system super-admins to oversee sales performance, manage subscriptions, and manage store access rights across branches.

---

## 1. Directory Blueprint

- **`admin-dashboard/src/pages/`**: Main portal pages (Dashboard, Restaurants, Subscriptions, Staff, Reports).
- **`admin-dashboard/src/api/`**: REST client communicating with `/api/admin/*` backend endpoints.
- **`admin-dashboard/src/layouts/`**: Top navbar, sidebar navigation drawer, and modal containers.
