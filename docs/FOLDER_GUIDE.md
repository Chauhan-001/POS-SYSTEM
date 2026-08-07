# FOLDER_GUIDE.md — Detailed Folder Responsibilities

## Overview

This guide documents the purpose of every major folder across `backend`, `restaurant-pos`, and `admin-dashboard`.

---

## 1. Backend (`backend/src`)

- `config.ts`: Environment variables parsing and DB connections.
- `controllers/`: Request handler functions mapped to Express endpoints.
- `middleware/`: Auth tokens verification, request validation, error formatting.
- `models/`: Mongoose schemas defining database document structures.
- `repositories/`: Database abstraction queries.
- `routes/`: Express router endpoint declarations.
- `services/`: Business domain logic independent of HTTP protocols.
- `utils/`: Encryption, hashing, token generators, date formatters.
- `validation/`: Schema checkers for HTTP request parameters and bodies.

---

## 2. POS Terminal (`restaurant-pos/Frontend`)

- `components/`: UI components organized by feature domain (Billing, Orders, KDS, Inventory, Reports, Staff, Branches, Settings).
- `src/app/`: App entry points and workspace routing.
- `src/hooks/`: Custom React hooks encapsulating POS logic (`usePOSState`, `useBilling`, `useAuth`, `useWindowResize`).
- `src/lib/`: Offline sync engine and background data workers.
- `src/types/`: Central TypeScript interface definitions.
- `src/utils/`: Math helpers, currency formatting, KOT delta computation.

---

## 3. Desktop Shell (`restaurant-pos/electron`)

- `main.ts`: Main process script managing window bounds, menu bars, IPC handlers.
- `preload.ts`: Secure bridge exposing allowed desktop features to renderer.
