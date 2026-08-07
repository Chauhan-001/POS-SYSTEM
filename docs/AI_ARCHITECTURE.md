# AI_ARCHITECTURE.md — Voice Assistant & Smart Analytics Architecture

## Overview

The POS terminal includes an optional AI-driven assistant (`src/ai/`) that provides voice command input, intelligent stock suggestions, and natural language analytics queries.

---

## 1. Components & Data Flow

- **`VoiceFAB.tsx`**: Floating Action Button component for voice recording and natural language command parsing.
- **`aiClient.ts`**: API wrapper for communicating with AI backend endpoints.
- **Command Matcher**: Parses spoken voice intent into POS actions (e.g. "Add 2 Burgers", "Search customer 9876543210", "Show daily sales report").
