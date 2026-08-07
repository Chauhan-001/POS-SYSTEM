# Loyalty POS System — Enterprise Monorepo

Welcome to the **Loyalty POS Monorepo**. This system provides a full-featured, offline-first Restaurant POS Terminal, Express REST API Backend, and Multi-Tenant Admin Web Portal.

---

## 🚀 Quick Start

### 1. Installation
Install all dependencies across backend, desktop POS, and admin dashboard:
```bash
npm run install:all
```

### 2. Running Dev Environment
Start all services in development mode:
```bash
# Run web dev servers concurrently (Backend + Admin Portal + POS Frontend)
npm run dev

# Run Electron Desktop environment concurrently (Backend + Admin Portal + Desktop POS)
npm run dev:electron
```

---

## 📁 System Architecture & Documentation Map

- 🗺️ **[CODEBASE_MAP.md](docs/CODEBASE_MAP.md)**: Master navigation guide & file index.
- 📐 **[PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)**: Monorepo package structure.
- 🏗️ **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**: High-level offline-first system topology.
- 📂 **[FOLDER_GUIDE.md](docs/FOLDER_GUIDE.md)**: Granular directory responsibilities.
- 🧭 **[ROUTING_GUIDE.md](docs/ROUTING_GUIDE.md)**: Workspace and API endpoint routes.
- ⚡ **[STATE_MANAGEMENT.md](docs/STATE_MANAGEMENT.md)**: React custom hooks & state flows.
- 🗄️ **[DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)**: MongoDB collection schemas & indexes.
- 🔌 **[API_REFERENCE.md](docs/API_REFERENCE.md)**: Express REST API documentation.
- 🔄 **[OFFLINE_ENGINE.md](docs/OFFLINE_ENGINE.md)**: Offline persistence & sync engine.
- 🤖 **[AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md)**: Voice assistant & smart analytics.
- 🖥️ **[ELECTRON.md](docs/ELECTRON.md)**: Desktop process lifecycle & IPC map.
- 🏪 **[POS_ARCHITECTURE.md](docs/POS_ARCHITECTURE.md)**: POS Terminal UI & flexbox layout engine.
- 📊 **[ADMIN_DASHBOARD.md](docs/ADMIN_DASHBOARD.md)**: Admin management web portal.
- 🌐 **[CUSTOMER_WEBSITE.md](docs/CUSTOMER_WEBSITE.md)**: Customer loyalty & ordering portal.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons
- **Desktop Shell**: Electron 35
- **Backend**: Node.js, Express, TypeScript, MongoDB / Mongoose
- **Tooling**: Concurrently, Cross-Env, Vitest, Playwright
