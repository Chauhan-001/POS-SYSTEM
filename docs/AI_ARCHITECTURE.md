# AI_ARCHITECTURE.md — AI, Voice & Recommendations

## Overview

AI is used for **understanding, reasoning, prioritization, and explanation —
never for financial truth**. All money math (pricing, tax, margins, recipe
cost, discount allocation) is computed deterministically by the billing and
pricing engines. AI keys remain server-side; the POS and customer site call AI
through backend routes (`/api/ai/*`, `/api/voice-inventory/*`).

---

## 1. Provider Abstraction (`backend/src/modules/ai/`)

- Provider-driven: `AI_PROVIDER` (default `openai`), `AI_BASE_URL`,
  `AI_MODEL`, `AI_API_KEY`, `AI_TIMEOUT`, `AI_MAX_TOKENS`, `AI_TEMPERATURE`.
- Rate limiting, circuit-breaker style fallbacks, and usage logging
  (`AIUsageLog`, `AiQuotaSnapshot` for admin quota cards).
- Prompt infrastructure under `modules/ai/prompts/` (e.g. offer copy).
- Voice parse (`voice-parse`) + `aiController`/`aiService` for completions.

## 2. Speech-to-Text

Provider-managed STT (`modules/voice-inventory`):
- Groq Whisper (`whisper-large-v3-turbo`), Deepgram (`nova-3-general`),
  Google STT — selected via `STT_PROVIDER` + keys/models.
- Cost-per-minute tracking per provider for admin dashboards.
- Routes: `/api/voice-inventory/transcribe` (audio → text),
  `/api/ai/*` for intent extraction.

## 3. Product Resolution (`ProductResolver.ts`)

7-stage multilingual resolution for voice inventory: name → aliases →
learned aliases (self-improving from merchant behavior) → fuzzy match,
scoped to the tenant. Supports Hindi/Hinglish (e.g. "doodh" → Fresh Milk).

## 4. Deterministic vs AI — by feature

| Feature | Deterministic engine | AI role |
|---|---|---|
| Pricing / tax / margins | `pricingEngine`, tax engine | none |
| Recipe cost | `modules/recipes` costing | ingredient parsing only |
| Offer validation | `offerValidationService` | copy generation, not amounts |
| Recommendations | sales/inventory/margin analytics | prioritization & explanation |
| Festival/seasonality | `festivalService` (calendar) | context narrative only |

## 5. Recommendations & Business Advisor

- `advisorService` + `advisorController` (`/api/advisor`) — the Business
  Advisor analyzes real operational data (sales, inventory, margins,
  seasonality, festival/weather context) deterministically, then AI explains
  and prioritizes. Owner picks a goal; the POS recommends actions.
- `recommendationContext`, `priceIntelligenceService`, `festivalService`,
  `comboHealthService` feed the context.
- Frontend: `components/marketing/BusinessAdvisor.tsx`, `RecommendationsPage`,
  `RecommendationPreview`.

## 6. AI Security Boundaries

- Keys/API secrets live in the backend `.env`, never exposed to the browser.
- Requests are proxied via backend routes; prompts sanitized; PII minimized.
- Usage is logged and quota-tracked per key/tenant.
- LLM failure never blocks registration or billing (graceful fallbacks —
  e.g. recipe parsing falls back to manual ingredient entry).
