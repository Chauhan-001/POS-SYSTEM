# OFFLINE_ENGINE.md — Offline Storage & Backend Sync Engine

## Overview

The **Loyalty POS Terminal** operates under a zero-downtime, offline-first design pattern. Cashiers can operate the terminal indefinitely during internet disruptions.

---

## 1. Storage & Synchronization Flow

```
[Cashier Action] ---> [In-Memory State] ---> [Local Storage / IndexedDB (data.ts)]
                                                      |
                                                      v
                                            [Sync Buffer Queue]
                                                      |
                                           (Network Check: Online?)
                                                      |
                                                      v
                                        [API POST /api/bills/sync]
                                                      |
                                           [Backend Confirmation]
                                                      |
                                       [Mark Buffer Items as Synced]
```

---

## 2. Key Offline Components

- **`src/data.ts`**: Provides sync and async read/write functions (`getDBData`, `setDBData`) for persistence across sessions.
- **`src/lib/syncEngine.ts`**: Manages sync timers, listens to `online` and `offline` browser events, and flushes pending transaction queues to the backend REST API.
