# ChitKuber Inventory Intelligence — Deep Read-Only Audit Report

*Generated from codebase audit. No source files modified.*

---

## A. Executive Summary

The ChitKuber repository already has a **fully functional deterministic inventory intelligence system** with:

- **Authoritative data models** (Product, InventoryEvent, Recipe) with tenant/branch scoping
- **Four canonical inventory tools** in the shared tool registry: `getInventoryStatus`, `getStockoutRisk`, `getExpiryRisk`, `getWastage`
- **Deterministic services** generating inventory intelligence: stockout risk, expiry risk, overstock, wastage analysis, reorder suggestions, ingredient consumption forecasting
- **An existing inventory agent** (`inventoryAgent.ts`) that is purely deterministic — no LLM involvement, evidence-backed conclusions, advisory-only next actions
- **Shared AI infrastructure** (tool registry, bounded agent loop, policy system) that can support an LLM-powered agent layer without duplicating business logic
- **Clear separation**: ML predictions (demand forecasting) ≠ authoritative inventory facts; LLM would only reason over tool outputs

**What exists and is strong:**
- Inventory data models with FIFO/expiry batch tracking
- Canonical context builder (`buildInventoryContext`) used by both deterministic engine and AI tools
- Four read-only inventory tools already registered in the shared registry
- Deterministic inventory agent that produces purchase recommendations, stockout predictions, expiry risks, wastage signals
- Promotion-inventory optimization service (`inventoryAwareOptimizationService`)
- Data sufficiency gating that honestly reports when capabilities are unavailable
- Tenant/branch security enforced at every data path

**What needs connection:**
- The existing deterministic inventory agent could be wrapped by the bounded LLM investigation loop (same as marketing agent Phase 1), enabling an LLM to *reason over* the deterministic evidence rather than replace it
- An inventory-specific policy defining which tools the agent may call
- No new inventory tools are needed — the 4 existing ones provide sufficient evidence
- No new data models are needed — everything already exists

**What is missing:**
- An inventory agent policy (allow-list of tool names for the bounded loop)
- An agentic wrapping of the existing inventory agent (optional Phase 1 addition)
- No fundamental pieces are missing — the architecture is largely already in place

The **smallest correct path** to an Inventory Agent:
```
Existing inventory tools (4 tools) → LLM reason/choose tools → Inspect results → Recommend deterministic action → Owner approval → Existing action service
```

No vector databases, new inventory databases, duplicate engines, or duplicate logic needed.

---

## B. Inventory Architecture Map

```
OWNER / EVENT
    ↓
INVENTORY FACTS (MongoDB documents)
    ├─ Product: currentStock, minStock, maxStock, unit, expiryDate, batches (FIFO)
    ├─ InventoryEvent: sold/adjustment/waste/closing/purchase (audit trail)
    └─ Recipe: ingredients → inventoryItemId, quantity, unit, wastagePercent

    ↓ (authoritative services)
AUTHORITATIVE INVENTORY SERVICES
    ├─ recommendationContext.buildInventoryContext() → canonical stock view
    ├─ inventoryDemandForecastingService.generateIngredientConsumptionForecasts()
    ├─ inventoryDemandForecastingService.generateStockoutAlerts()
    ├─ inventoryDemandForecastingService.generateExpiryAlerts()
    ├─ inventoryDemandForecastingService.generateOverstockAlerts()
    ├─ costIntelligenceCore.metrics() → wastage, margin, variance
    └─ inventoryAwareOptimizationService.forecastStockConsumption() → promo impact

    ↓ (read-only tools, shared registry)
INVENTORY AI TOOLS (4 tools)
    ├─ getInventoryStatus → current stock levels
    ├─ getStockoutRisk → predicted stockouts (14-day horizon)
    ├─ getExpiryRisk → approaching expiry (30-day horizon)
    └─ getWastage → observed kitchen wastage

    ↓ (LLM reasoning layer — optional)
INVENTORY AGENT (deterministic core + optional LLM loop)
    ├─ runInventoryAgent() → combines all 4 tool outputs
    └─ bounded agent loop (Phase 1) → LLM plans → policy validates → tools execute → observations → LLM decides

    ↓ (advisory only, never writes)
DETERMINISTIC ACTION SERVICE
    ├─ purchase order creation (separate service, requires approval)
    ├─ stock adjustment (POST /products/:id/stock, role-based)
    └─ reorder/transfer actions (existing APIs)
```

---

## C. Inventory Data Models

| Model | Collection | Key Fields | Tenant Field | Branch Field | Product/Ingredient Ref | Batch Ref | Quantity Fields | Unit Fields | Expiry Fields | Cost Fields | Supplier Fields | Timestamps | Status Fields |
|-------|-----------|-----------|-------------|-------------|-----------------------|-----------|----------------|------------|--------------|------------| -------------- |-----------|--------------|
| **Product** | products | type, name, code, price, currentStock, minStock, maxStock, unit, averageCost, lastPurchasePrices, supplier, expiryDate, batchNumber, batches[IStockBill] | restaurantId | branchId (optional) | self (type='inventory') | batches[] | currentStock (sum of batches), batch.quantity | unit | expiryDate (OLDEST batch) | averageCost, lastPurchasePrices | supplier | createdAt, updatedAt | isDeleted, availability |
| **InventoryEvent** | inventoryEvents | type, item, quantity, unit, operator, details, eventDate, refId, unitCost, totalCost | restaurantId | branchId | item name string | N/A | quantity (absolute) | unit (from event) | N/A | unitCost, totalCost (FIFO cost basis) | N/A | createdAt, updatedAt | type enum |
| **Recipe** | recipes | productId, components[i].inventoryItemId, quantity, unit, normalizedQuantity, normalizedUnit, wastagePercent, optional | restaurantId | branchId (optional) | inventoryItemId → Product._id | N/A | component.quantity | component.unit | N/A | N/A (reads Product.averageCost) | N/A | createdAt, updatedAt | status, version |

**Source of truth for current stock:** `Product.currentStock` is the authoritative balance. It is **stored directly** on the Product document and updated by:
- Purchase entries (add to currentStock)
- Bill consumption (deduct from currentStock via recipe components, FIFO batch consumption)
- Manual adjustments (POST /products/:id/stock)
- Waste events (deduct from currentStock, recorded in InventoryEvent)

Batch quantities (`batches[].quantity`) are the sub-component of `currentStock` — `currentStock = sum(batches[].quantity)`. Deductions consume the oldest-expiry batch first ('' = no expiry → last under FIFO).

---

## D. Authoritative Inventory Services

| Service | File | Key Functions | Authoritative? | AI Allowed to Influence |
|---------|------|--------------|---------------|------------------------|
| **recommendationContext** | `services/recommendationContext.ts` | `buildInventoryContext()`, `deriveSurplusItems()`, `buildSalesContext()` | YES — canonical context for both deterministic engine and AI prompts | MUST NOT override; can only READ |
| **inventoryDemandForecastingService** | `services/inventoryDemandForecastingService.ts` | `generateIngredientConsumptionForecasts()`, `generateStockoutAlerts()`, `generateExpiryAlerts()`, `generateOverstockAlerts()`, `getInventoryForecastDashboard()` | YES — deterministic consumption math (forecast × recipe) | CAN consume predictions; MUST NOT override stock quantities |
| **costIntelligenceCore** | `modules/recipes/services/costIntelligenceCore.ts` | `metrics()`, `marginDeterioration()`, `deterministicInsights()` | YES — wastage, cost changes, variance from real data | CAN reference numbers; MUST NOT fabricate |
| **inventoryAwareOptimizationService** | `services/inventoryAwareOptimizationService.ts` | `forecastStockConsumption()`, `canPromotionProceed()`, `getInventoryAwareAdjustments()` | YES — promo impact on stock, blocking ingredients | CAN consume; MUST NOT bypass blocking calls |
| **consumptionService** | (referenced in costIntelligenceCore) | reconcile() | YES — theoretical vs actual variance | CAN consume; MUST NOT override |

---

## E. Deterministic Business Rules

| Rule | Where Implemented | Authoritative? | AI Allowed to Influence |
|------|------------------|---------------|------------------------|
| **FIFO batch deduction** | `Product.batches` model + inventory engine (not exposed as public tool) | YES — deductions consume oldest-expiry batch first | NO — pure inventory engine logic |
| **FEFO (earliest expiry first)** | Same as FIFO — `expiryDate` on batches, '' means no expiry → consumed last | YES | NO |
| **Stock decrement on bill consumption** | `billService.ts` → recipe component deductions → Product.currentStock - batch.quantity | YES — every bill deducts stock | NO |
| **Recipe consumption** | `Recipe.components` → `inventoryItemId` × `quantity` per yield | YES — denormalized via normalizedQuantity/normalizedUnit | CAN READ recipe→inventory flow; MUST NOT override |
| **Minimum stock** | `Product.minStock` — below minStock triggers reorder recommendation | YES — authoritative low-stock state | CAN recommend reorder above minStock; MUST NOT lower minStock arbitrarily |
| **Maximum stock / surplus** | `Product.maxStock` — `currentStock >= maxStock * 0.8` → surplus (derivedSurplusItems) | YES — deterministic rule | CAN reference; MUST NOT promote surplus below minStock |
| **Wastage tracking** | `InventoryEvent.type = 'waste'` → costIntelligenceCore.metrics() | YES — observed kitchen wastage | CAN reference; MUST NOT invent wastage |
| **Negative stock prevention** | System prevents currentStock from going negative; minStock gate on reorder | YES — enforced by business logic | CAN recommend reorder; MUST NOT create negative stock |
| **Unit conversion** | `RecipeComponent.normalizedQuantity` / `normalizedUnit` converts between recipe unit and inventory unit | YES — computed at consumption time | CAN reference conversion rules; MUST NOT invent conversions |
| **Branch isolation** | `resolveBranchScope()` validates branch belongs to tenant; all queries filter by restaurantId | YES — multi-tenant enforcement | CAN read own tenant's branch; MUST NOT read another tenant's branch |
| **Tenant isolation** | `restaurantId` from JWT/server context; never from model output | YES — hard tenancy boundary | CAN use own restaurantId; MUST NOT accept LLM-supplied tenant IDs |

---

## F. Recipe → Inventory Flow

```
Bill
    ↓
Finished product sold (availability: true)
    ↓
Recipe resolution: activeRecipeKeys → productId → Recipe (base or variant override)
    ↓
Ingredient components: inventoryItemId → Product (inventory item, availability: false)
    ↓
Deduction: Per-component: quantity × (yieldQuantity / servingSize normalization)
    ↓
FIFO batch consumption: oldest-expiry batch first; '' (no expiry) → last
    ↓
Product.currentStock -= consumedQuantity (per batch, tracked)
    ↓
InventoryEvent 'sold' recorded (derived at backfill time)
```

**Variants:**
- `recipeMode: 'base'` → product's default recipe
- `recipeMode: 'override'` → variant-specific recipe; unconfigured variants inherit base recipe
- `componentSource: 'copy'` (override recipes) or `'custom'` (authored directly)

**Wastage:**
- `wastagePercent` on each component: extra quantity needed beyond theoretical to cover trimming/cooking loss
- Separate `InventoryEvent.type = 'waste'` for actual spoiled/dropped stock

**Risk of double deduction:** Avoided by design — recipe consumption happens once per bill. Legacy systems are not present; there is one canonical consumption path.

**Risk of branch leakage:** Avoided — `branchId` on Recipes is optional; sales aggregate per-branch via Bill.branchId; inventory context branch scoping validated by `resolveBranchScope()`.

---

## G. Existing Inventory Intelligence

All existing intelligence is **DETERMINISTIC, RULE-BASED**, and backed by authoritative data:

| Capability | File/Function | Input | Output | Algorithm | Data Sources | Tenant Scope | Branch Scope | Production Callers | Tests | Runtime Status |
|-----------|--------------|-------|--------|-----------|--------------|-------------|-------------|-------------------|-------|---------------|
| **Stock levels** | `getInventoryStatusTool` | restaurantId [branchId] | {items: {id, name, currentStock, minStock, maxStock, unit, price, averageCost}} | Filter products with stock data → map fields | Product.find({type:inventory, availability:false}) | tenant | validated branch | `runInventoryAgent`, `POST /api/ai/inventory-agent/recommend`, recommendationContext | unit tested | PRODUCTION |
| **Stockout risk** | `getStockoutRiskTool` | restaurantId [branchId] [horizonDays] | {alerts: {itemId, itemName, currentStock, predictedDepletionDate, daysUntilDepletion, severity, recommendedReorderQty, contributingMenuItems}} | Consumption forecast: forecastUnits × recipeQty → daysOfStock → risk tier (≤2: critical, ≤5: high, ≤10: medium, ≤20: low, else: none) | Demand forecast (generateDemandForecast) × Recipe.components × Product.currentStock | tenant | validated branch | `runInventoryAgent`, `POST /api/ai/inventory-agent/recommend`, routes.inventoryDemand | unit tested | PRODUCTION |
| **Expiry risk** | `getExpiryRiskTool` | restaurantId [branchId] [horizonDays] | {alerts: {itemId, itemName, currentStock, expiryDate, daysUntilExpiry, severity, canPromote, recommendedActions}} | DaysToExpiry = (expiryDate - now) → risk tier (≤2: critical, ≤5: critical, ≤10: warning, ≤20: warning, else: none) | Product.expiryDate (oldest batch) | tenant | validated branch | `runInventoryAgent`, `POST /api/ai/inventory-agent/recommend` | unit tested | PRODUCTION |
| **Wastage analysis** | `getWastageTool` | restaurantId [days] | {topItems: [{name, qty, unit, cost}], items: [{name, unit, qty, cost, prevQty, prevCost}]} | Aggregation of InventoryEvent.type='waste' over window; prevWindow comparison for spike detection | InventoryEvent.find({type:'waste', restaurantId, eventDate}) | tenant | optional branch | recommendationContext.deterministicInsights(), routes.inventoryEvents | unit tested | PRODUCTION |
| **Overstock detection** | `deriveSurplusItems` (recommendationContext) | products[] | {productId, productName, currentStock, maxStock, surplusQuantity, unit, expiryRisk} | currentStock >= maxStock * 0.8 AND not (currentStock <= minStock) | Product.currentStock, Product.maxStock | tenant | N/A (aggregate) | recommendationContext part of public API | not separately tested | PRODUCTION |
| **Ingredient consumption forecast** | `generateIngredientConsumptionForecasts` | {restaurantId, branchId, forecastPeriod, lookbackDays} | {IngredientConsumptionForecast[]} with stockout/expiry/overstock risk | forecastUnits × recipeQuantity → predicted consumption → daysOfStock → risk tiers | Demand forecast (generateBatchForecasts) × Recipe.components × Product.inventory | tenant | optional branch | routes.inventoryDemand.getReorderSuggestionsHandler, inventoryAgent | not separately tested | PRODUCTION |
| **Reorder suggestions** | `getReorderSuggestionsHandler` | restaurantId | {ingredientId, ingredientName, currentStock, minStock, predictedConsumption7d, recommendedReorderQty, daysOfSupply} | predictedConsumption7d + currentStock < minStock → reorder needed | Recent bills (30d) × Recipe.components × Product.inventory | tenant | N/A | routes.inventoryDemand | not separately tested | PRODUCTION |

**Key observation**: All intelligence is generated from **deterministic services** that read authoritative DB state. No ML/LLM directly calculates stock quantities, expiry dates, or reorder levels.

---

## H. Existing Inventory ML

The existing demand forecasting system is **STATISTICAL/DETERMINISTIC**, NOT ML-POWERED in the current implementation:

- **Service**: `demandForecastingService.ts`
- **Methods**: `generateDemandForecast()`, `generateBatchForecasts()`, `generateCategoryForecasts()`, `generateAllCategoryForecasts()`
- **Algorithm**: 
  - Historical comparable periods (same day-of-week, same time-slot)
  - Trend analysis (linear regression on recent periods)
  - Day-of-week and time-of-day patterns
  - Seasonality where sufficient data exists (12+ months)
  - Festival/holiday effects
- **No model inference** in this module
- **FUTURE ML**: A trained demand model can replace the heuristics behind `generateDemandForecast` without changing the `ForecastResult` contract
- **Output includes**: `confidence` (HIGH/MEDIUM/LOW/INSUFFICIENT_DATA), `confidenceScore` (0-100), `dataSufficiency`, `factors`, `explainability` (primaryDriver, supportingFactors, caveats)

**How Inventory Agent could consume ML safely:**
- Demand forecasts are consumed as **predictions**, not facts
- The inventory forecasting service (`inventoryDemandForecastingService.generateIngredientConsumptionForecasts()`) already slots demand forecasts in via the `generateBatchForecasts()` call
- Confidence levels and data sufficiency reports gate what the agent can reasonably claim
- The agent should never claim a product will sell without evidence — it should report the confidence level

**Distinction documented:**
- Current stock: authoritative DB state
- Demand forecast: prediction (with confidence bounds)
- Expiry date: authoritative DB state
- Stockout risk: derived/predictive signal (from forecast + current stock)
- The inventory agent already correctly treats stockout/expiry risk as derived signals, not facts

---

## I. Existing Inventory AI Tools

Four inventory tools are already registered in the shared tool registry:

| Tool | File | Input Schema | Output Schema | Access | Tenant Handling | Branch Handling | Source | Production Callers |
|------|------|-------------|--------------|--------|----------------|----------------|--------|-------------------|
| **getInventoryStatus** | `ai/tools/inventory/getInventoryStatusTool.ts` | {branchId?: string} | {available, reason, items?: [{id, name, category, currentStock, minStock, maxStock, unit, price, averageCost}], generatedAt} | read | validated via `ctx.tenant.restaurantId`; branchId validated via `resolveBranchScope(restaurantId, branchId)` | validated branch belongs to tenant | `services/recommendationContext.buildInventoryContext` | `runInventoryAgent`, `POST /api/ai/inventory-agent/recommend` |
| **getStockoutRisk** | `ai/tools/inventory/getStockoutRiskTool.ts` | {branchId?, horizonDays?: 1-30} | {available, reason, alerts?: [{itemId, itemName, currentStock, predictedDepletionDate, daysUntilDepletion, severity, recommendedReorderQty, contributingMenuItems}], generatedAt} | read | validated via `ctx.tenant.restaurantId`; branchId validated | validated branch belongs to tenant | `services/inventoryDemandForecastingService.generateStockoutAlerts` | `runInventoryAgent`, `POST /api/ai/inventory-agent/recommend`, routes.inventoryDemand |
| **getExpiryRisk** | `ai/tools/inventory/getExpiryRiskTool.ts` | {branchId?, horizonDays?: 1-90} | {available, reason, alerts?: [{itemId, itemName, currentStock, expiryDate, daysUntilExpiry, severity, canPromote, recommendedActions}], generatedAt} | read | validated via `ctx.tenant.restaurantId`; branchId validated | validated branch belongs to tenant | `services/inventoryDemandForecastingService.generateExpiryAlerts` | `runInventoryAgent`, `POST /api/ai/inventory-agent/recommend` |
| **getWastage** | `ai/tools/inventory/getWastageTool.ts` | {days?: 7-180} | {available, reason, topItems?: [{name, qty, unit, cost}], items?: [{name, unit, qty, cost, prevQty, prevCost}], generatedAt} | read | validated via `ctx.tenant.restaurantId` | N/A (aggregate across branches) | `modules/recipes.services.costIntelligenceCore.metrics` | `runInventoryAgent`, recommendationContext |

**All four tools:**
- Are **read-only** (`access: 'read'`)
- Are **tenant-scoped** (restaurantId from ToolContext, never from model)
- Have **branch validation** (must belong to tenant, otherwise TOOL_TENANT_MISMATCH error)
- Are **sourced from authoritative services** — no duplicated logic
- Are **production-ready** with schema validation, timeouts, and explicit error codes

**Missing tools** (not currently registered, but the existing 4 cover the core evidence space):
- `getDemandForecast` — already exists in `ai/tools/ml/` (marketing agent uses it)
- No tool needed for recipe consumption — already covered by existing services
- No tool needed for FIFO/FEFO — internal inventory engine logic

---

## J. Tool Registry Architecture

The shared tool registry architecture is **well-established** and can support the Inventory Agent without modification:

```
Agent Policy
    ↓ (resolveAllowedTools — fail-closed)
Tool Resolver (filters by allow-list)
    ↓ (executeTool — validated schema in/out, timeout clamp)
Tool Executor
    ↓ (injects ctx.tenant from JWT, never from model)
Shared Tool Registry (single registry for all agents)
    ↓ (list — used to build agent tool catalogs)
Agent Tool Catalog
```

**Key properties:**
- **One registry** serves all agents (marketing, inventory, others)
- **Agents never register their own tools** — their policy only references names from the registry
- **Policy-based allow-listing**: `resolveAllowedTools(policy.allowedTools)` returns only the tools the agent may call
- **Fail-closed**: If a tool name is not in the allow-list, it is rejected at the policy check stage
- **Tenant injection**: `ctx.tenant` comes from `tenantContextFromRequest` (JWT-derived), never from the model
- **Output validation**: `tool.outputSchema.safeParse()` after execution ensures malformed outputs are caught
- **Timeout enforcement**: `withTimeout()` + deadlineAt clamp prevents slow tools from overrunning the run

**Architectural violations identified (audit-only, not to fix):**
- Some direct imports exist: `inventoryAgent.ts` imports tool definitions directly from `../tools/inventory/...` rather than from the registry. However, these are **read-only tool definitions** and the actual execution goes through the shared executor. The marketing agent similarly imports tool definitions directly. This is noted as an architectural pattern but does not violate the separation because:
  - The tools are shared registry entries
  - The definitions are just Zod schemas + execute functions
  - The actual runtime usage goes through `executeTool()` which validates against the registry entry
  
  **However**, the correct pattern is for the agent policy to reference tool **names**, and the loop resolves them from the registry. The direct imports in inventoryAgent.ts are a convenience — they don't bypass the registry or execute path.

**No write tools** exist for inventory in the agent layer. All tools are `access: 'read'`. Write actions (purchase orders, stock adjustments) go through existing deterministic APIs with role-based authorization.

---

## K. Existing Agent/LLM Infrastructure Reusable for Inventory

The shared AI foundation that can be reused **without modification**:

| Infrastructure | File | What It Does | Reusable for Inventory? |
|---------------|------|-------------|------------------------|
| **Bounded agent loop** | `ai/agents/loop/agentLoop.ts` | LLM plans → policy validates → execute through ToolExecutor → observations fed back → LLM decides next step → stop on budget/sufficient evidence | YES — same pattern as marketing agent Phase 1 |
| **Tool registry** | `ai/tools/registry/` | Single registry; tools registered once; agents reference names; policy-based allow-listing | YES — inventory tools already registered |
| **Policy system** | `ai/agents/policies/marketingAgentPolicy.ts` + `resolveAllowedTools()` | Fail-closed allow-list of tool names; each agent has its own policy | YES — needs inventory-specific policy |
| **Tenant context** | `ai/shared/tenantContext.ts` (conceptual) | `tenantContextFromRequest()` extracts restaurantId from JWT; never from model | YES — same pattern |
| **AgentRunContext** | `shared/agentRunContext.ts` (conceptual) | `createAgentRun()`, `recordAgentRun()`, `recordLlmUsage()` — observability per run | YES — same structure |
| **Observability** | `observability/agentUsage/` | AIUsageLog per LLM call; audit row per agent run; latency, tokens, cost, success/failure | YES — can reuse |
| **LLM client** | `shared/llmClient.ts` | `generateJsonWithMeta()`, `isLlmConfigured()`, token usage tracking | YES — same interface |
| **AI cost config** | `services/aiCostConfig.ts` | Per-model pricing (input/output per 1K tokens); `calculateCost()` | YES — same cost tracking |
| **Agent run entry point** | `ai/agents/marketingAgent.ts` | `runMarketingAgentDeterministic()` → optional `runBoundedAgentLoop()` with `agentic: true` flag | YES — inventory agent can follow same pattern |

**What would need to be created (MINIMAL):**
1. **Inventory agent policy** — a list of allowed tool names (e.g., `['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage']`)
2. **Optional: agentic mode flag** on the inventory agent route — when `agentic: true`, the bounded loop runs first, then the deterministic agent result is returned alongside investigation trace
3. **Inventory-specific prompt** — the system prompt from `agentLoop.ts` is generic; the policy's allowedTools list and the objective string make it inventory-aware

**What MUST NOT be changed:**
- No new inventory tools needed — the 4 existing ones provide sufficient evidence
- No new data models needed — everything already exists
- No modifications to authoritative services — the LLM layer only READS tool outputs
- No modifications to the tool registry — inventory tools already registered

---

## L. Inventory API Routes

| Method | Path | Auth | Role | Tenant Source | Branch Source | Service | Read/Write | Side Effects | Approval | Audit | Test Coverage |
|--------|------|------|------|--------------|---------------|---------|------------|-------------|----------|-------|--------------|
| **POST** | `/api/ai/inventory-agent/recommend` | requireAuth | owner/manager/super_admin | `req.user.restaurantId` (JWT) | validated via `resolveBranchScope()` | `runInventoryAgent()` → 4 inventory tools | READ-only | Emits result summary; NO inventory mutation | N/A (advisory) | inventory feature flag | not seen |
| **GET** | `/api/inventory-events` | requireAuth | (all staff can view) | `req.user.restaurantId` | optional `branchId` query | `inventoryEventService.list/`findOneAndDelete` | READ (Owner/Manager write) | Records/removes events | Owner/Manager approval for write | `requireFeature('inventory')` | unit tested |
| **POST** | `/api/inventory-events` | requireAuth | Owner/Manager | `req.user.restaurantId` | optional from body | `inventoryEventService.create` | WRITE | Creates inventory event (waste/adjustment) | Owner/Manager role required | `requireFeature('inventory')` | unit tested |
| **DELETE** | `/api/inventory-events/:id` | requireAuth | Owner/Manager | `req.user.restaurantId` | from params | `InventoryEvent.findOneAndDelete` | WRITE | Deletes event (undo) | Owner/Manager role required | `requireFeature('inventory')` | unit tested |
| **POST** | `/api/products/:id/stock` | requireAuth | Owner/Manager/Inventory | `req.user.restaurantId` | from params | `productsController.adjustProductStock` | WRITE | Changes Product.currentStock | Role: Owner/Manager/Inventory + feature flag | `requireFeature('inventory')` | unit tested |
| **POST** | `/api/inventory-demand/predict` | requireAuth | (any authenticated) | `req.user.restaurantId` | from body | `predictIngredientConsumptionHandler` | READ | Generates demand forecast → ingredient consumption | N/A | not seen |
| **GET** | `/api/inventory-demand/stockout-risks` | requireAuth | (any authenticated) | `req.user.restaurantId` | N/A | `getStockoutRisksHandler` | READ | Generates stockout risk assessment | N/A | not seen |
| **GET** | `/api/inventory-demand/reorder-suggestions` | requireAuth | (any authenticated) | `req.user.restaurantId` | N/A | `getReorderSuggestionsHandler` | READ | Generates reorder suggestions | N/A | not seen |
| **GET** | `/api/ai/inventory-agent/routes` | — | — | — | — | — | — | — | — | — | — |

**Natural place for Inventory Agent exposure:** `POST /api/ai/inventory-agent/recommend` already exists and is designed as the read-only surface. No parallel API needed.

---

## M. Inventory Frontend

**Current frontend inventory surfaces** (from exploration):
- **Admin dashboard** (`admin-dashboard/`): React-based, likely includes inventory views
- **Customer site**: Minimal inventory exposure
- **Restaurant POS terminal** (Electron): Core operational UI

**Inventory UI elements identified:**
- Stock tables displaying `currentStock`, `minStock`, `maxStock`, `unit`
- Expiry/batch tracking UI (from Product details view)
- Purchase order management
- Bill generation with stock deduction
- Reorder suggestions (from `GET /api/inventory-demand/reorder-suggestions`)
- Stockout risk alerts (from `GET /api/inventory-demand/stockout-risks`)

**Natural places for future Inventory Intelligence:**
1. **Recommendation panel** alongside stock table — shows expiry risks, wastage hotspots, reorder urgency
2. **Proactive alerts** banner when items approach expiry or fall below minStock
3. **Task-driven assistant** — owner clicks "What should I do?" and the Inventory Agent provides a grounded recommendation
4. **Event-triggered agent** — e.g., "Send me an inventory brief each morning" as a scheduled job

**Existing AI/assistant UI:** None currently visible in the frontend. The AI platform surface is primarily backend-facing (routes at `/api/ai/...`).

**Suggested frontend integration points (not to implement):**
- Panel in product detail view: "Inventory Intelligence" toggle
- Morning brief banner: "2 items at risk, 1 overstocked — view recommendations"
- Reorder UI enhancement: "Agent-recommended reorder quantity" alongside manual entry

---

## N. Schedulers / Events

| Scheduler/Event | File/Location | Trigger | Frequency | Useful Future Triggers |
|----------------|--------------|---------|-----------|-----------------------|
| **Marketing scheduler** | (not found in direct search; referenced in admin) | — | — | — |
| **Learning scheduler** | (not found) | — | — | — |
| **Stock change events** | `inventoryEventService` | Manual recording via API or voice intake | On-demand | inventory falls below threshold |
| **Bill events** | `billService.ts` (implied) | Every bill generation | Per-bill | automatic stock deduction recorded |
| **Purchase events** | `purchasesController.ts` | Purchase order completion | On-completion | automatic stock addition + averageCost update |
| **Expiry events** | `inventoryDemandForecastingService.generateExpiryAlerts()` | Daily/per-request | Per-request | item approaching expiry |
| **Data sufficiency checks** | `dataSufficiencyService.assessDataSufficiency()` | Periodic or on-demand | On-demand | minimum data thresholds crossed |
| **Promotion optimization** | `promotionOptimizationService` (implied) | On promotion creation | Per-promotion | stockout risk assessment |

**Useful future triggers (alreadyhave infrastructure, just not automated):**
- **Inventory falls below minThreshold** → could trigger `runInventoryAgent()` → owner notification
- **Item approaching expiry** → `getExpiryRiskTool` already computes this; could trigger daily scheduler → alert
- **Stockout risk increases** → `getStockoutRiskTool` already computes this; could trigger scheduler → priority alert
- **Wastage increases** → `getWastageTool` already computes this; could trigger weekly review
- **Demand spike** → `generateDemandForecast` already detects trend; could trigger reorder reassessment
- **Demand drop** → same; could trigger promotions to move stock
- **Purchase received** → `purchasesController` already updates stock; could trigger recalculation
- **Recipe consumption anomaly** → `costIntelligenceCore.variance` already flags theoretical vs actual; could trigger investigation

**No event-driven infrastructure** (e.g., cron, setInterval, message queues) exists for automated inventory intelligence beyond on-demand API calls. The system is **request-driven**, which is actually a strength for an agent — each run is explicit and auditable.

---

## O. Existing Deterministic Actions

| Action | Already Exists? | Authorization | Requires Approval? | Deterministic? | Audited? | Can AI Layer Call Safely? |
|--------|----------------|--------------|-------------------|---------------|----------|--------------------------|
| **Create purchase suggestion** | YES — `runInventoryAgent` produces purchase recommendations with `estimatedCost` and `urgency` | Owner/Manager role (via route `requireRole`) | YES — recommendations are advisory; owner must create purchase order through purchasing API | YES — based on current stock, minStock, forecast | YES — audit log via InventoryEvent if purchase created separately | YES — agent recommends, owner creates |
| **Create purchase order** | NO — separate purchasing service (not in audit scope) | Owner/Manager | YES | N/A (separate system) | N/A | Agent can **suggest** but not create |
| **Update reorder level** | YES — `Product.minStock` and `Product.maxStock` are writable via `POST /products/:id` (Owner/Manager) | Owner/Manager | NO — direct write to product document | YES — just updates numeric fields | YES — full audit trail (updatedAt, isDeleted) | CAN safely call — AI can recommend, owner approves |
| **Transfer stock between branches** | PARTIAL — `Product.branchPrice` exists for pricing; no transfer API seen | Owner/Manager | N/A | N/A | N/A | Not currently supported; could be added as deterministic API |
| **Adjust inventory** | YES — `POST /products/:id/stock` | Owner/Manager/Inventory role | NO — direct mutation | YES — changes currentStock by delta | YES — full audit (InventoryEvent 'adjusted' recorded) | CAN safely call — AI recommends delta, owner approves |
| **Mark wastage** | YES — `POST /api/inventory-events` with type='waste' | Owner/Manager | NO — direct write to InventoryEvent | YES — records observed wastage | YES — full audit (createdAt, refId for undo) | CAN safely call — AI recommends, owner records |
| **Change supplier** | NO — `Product.supplier` field writable via `POST /products/:id` | Owner/Manager | NO | YES | YES | CAN safely call — AI recommends, owner approves |
| **Notify owner** | YES — agent result includes `summary` and `nextActions` strings | N/A (read-only output) | N/A | N/A | N/A | YES — agent output is plain text for owner reading |
| **Create inventory task** | NO — but `nextActions` from `runInventoryAgent` serves this purpose (advisory string list) | N/A | N/A | N/A | N/A | YES — agent produces action list, owner executes |

**Key principle**: The future Inventory Agent should **NEVER directly mutate inventory**. It should only recommend existing deterministic actions, and the owner/manager executes them through the approved APIs.

---

## P. Candidate Inventory Agent Tasks

| Task | Required Tools | Available Evidence | Missing Evidence | Deterministic Services Needed | LLM Reasoning Useful? |
|------|---------------|-------------------|-----------------|------------------------------|----------------------|
| **A. EXPIRY: "Which ingredients are at highest expiry risk this week?"** | `getExpiryRisk` (horizonDays: 7) | Product.expiryDate, currentStock | Branch-specific expiry data not separated (service filters by tenant) | `inventoryDemandForecastingService.generateExpiryAlerts()` | YES — LLM can compare expiry risks across items and explain which are most urgent |
| **B. STOCKOUT: "Which items are likely to cause a stockout soon?"** | `getStockoutRisk` (horizonDays: 14) | currentStock, demand forecast, recipe consumption | Real-time consumption rate vs forecast granularity | `inventoryDemandForecastingService.generateStockoutAlerts()` | YES — LLM can prioritize by severity and explain contributing menu items |
| **C. OVERSTOCK: "Which ingredients are overstocked relative to expected demand?"** | `getInventoryStatus` + `generateIngredientConsumptionForecasts` | currentStock, maxStock, forecast consumption | Demand forecast confidence levels | `inventoryDemandForecastingService.generateOverstockAlerts()`, `deriveSurplusItems()` | YES — LLM can relate overstock to wastage risk and suggest promotions |
| **D. WASTAGE: "Why is wastage increasing?"** | `getWastage` (days: 30/60) | wastage items, costs, prevQty comparison | Root cause (prep portion changes, storage issues, recipe changes) | `costIntelligenceCore.metrics()` | YES — LLM can correlate with cost changes and recipe modifications |
| **E. DEMAND: "Demand is rising for these items; which ingredients should be replenished?"** | `getStockoutRisk` + `generateIngredientConsumptionForecasts` | forecastUnits, recipeQty, currentStock | Actual consumption rates (vs forecast) | `inventoryDemandForecastingService.generateIngredientConsumptionForecasts()` | YES — LLM can compare forecast vs actual and recommend reorder |
| **F. COMBINATION: "Ingredient X is expiring soon but demand is low. What should I do?"** | `getExpiryRisk` + `getStockoutRisk` + `getInventoryStatus` | expiryDate, daysUntilExpiry, stockoutRisk, currentStock | None — all signals available | All three tools + `costIntelligenceCore` | YES — this is exactly the kind of multi-signal reasoning the agent should do |
| **G. CROSS-SIGNAL: "Ingredient A has high stock, low demand, and high wastage. Should I reduce purchasing?"** | `getInventoryStatus` + `generateIngredientConsumptionForecasts` + `getWastage` | currentStock, daysOfStock, wastage items | None — all three signals available | All three tools + `inventoryAwareOptimizationService` | YES — multi-signal synthesis is the agent's strengths |
| **H. BRANCH: "Branch A is low on ingredient X while Branch B has excess."** | `getInventoryStatus` (with branchId) | branch-scoped stock | Branch isolation enforced — agent can only read own tenant's branches | `resolveBranchScope()` validates branch belongs to tenant | YES — LLM can suggest transfer if branch imbalance detected, but transfer API doesn't exist yet |

---

## Q. Existing Signal / Evidence Layer

**No canonical inventory signal layer exists** as a separate schema/ID system. Instead, inventory signals are embedded in the tool outputs:

- **Inventory status signal**: `getInventoryStatusOutput.items[]` — `{id, name, currentStock, minStock, maxStock, unit, price, averageCost}`
- **Stockout risk signal**: `getStockoutRiskOutput.alerts[]` — `{itemId, itemName, currentStock, predictedDepletionDate, daysUntilDepletion, severity, recommendedReorderQuantity, contributingMenuItems}`
- **Expiry risk signal**: `getExpiryRiskOutput.alerts[]` — `{itemId, itemName, currentStock, expiryDate, daysUntilExpiry, severity, canPromote, recommendedActions}`
- **Wastage signal**: `getWastageOutput.topItems[]` / `items[]` — `{name, qty, unit, cost, prevQty, prevCost}`

**No confidence scores, freshness timestamps, or severity fields** are standardized across signals beyond what each tool already produces. Each tool has its own output shape.

**The system already supports the distinction** between:
- **CURRENT FACT**: `Product.currentStock`, `Product.expiryDate` (authoritative DB state)
- **PREDICTION**: forecast-derived daysOfStock, daysUntilDepletion (with confidence levels)
- **HISTORICAL OBSERVATION**: InventoryEvent historical counts (wastage, sold events)
- **STALE DATA**: flagged by `dataSufficiencyService` — e.g., INSUFFICIENT_DATA when < 50 bills

**No signal IDs** or **confidence timestamps** are tracked across runs. Each tool call is stateless and fresh.

---

## R. Existing Memory Capability

**No inventory-specific long-term memory exists** in the current implementation. The memory system (`memory/` directory) was found not to exist.

**What does exist** (general memory infrastructure, not inventory-specific):
- **MemoryManager** concept: tenant-scoped memory with expiry handling (referenced in `agentLoop.ts`)
- **AgentMemoryContext**: `{ episodes, longTerm, priorityStatement, loadedAt, degraded }` — used by the bounded agent loop
- **MemoryEpisodeRecord**: per-episode type, scope, confidence, objective, outcome
- **RestaurantMemoryRecord**: memoryType, branchId, sampleSize, confidence, tags, value, lastValidatedAt

**How memory could influence inventory (not currently implemented):**
- **Ingredient repeatedly expires before use** → long-term memory could flag "this ingredient has high expiry risk" but is NOT currently tracked
- **Supplier lead time is unreliable** → not tracked
- **Branch A consumes ingredient faster** → not tracked across runs
- **Item repeatedly causes wastage** → not tracked
- **Particular stock level is sufficient** → not tracked as reusable memory
- **Seasonal demand pattern** → demand forecasting already detects trends from historical data, but not long-term memory

**The memory infrastructure could be reused** if inventory-specific episodes were recorded:
- `memoryManager.recordEpisode({ type: 'expiry_risk', objective: 'ingredient X expired', confidence: 0.8, ... })`
- But **memory never overrides current tool data** — the agentLoop system explicitly states this in the system prompt (spec §F, rule 8)

---

## S. Observability

**Existing observability for AI agent runs:**

| Feature | Implementation | Inventory Coverage |
|---------|---------------|-------------------|
| **AIUsageLog** | `recordLlmUsage()` in `agentLoop.ts` | Available but not yet used by inventory agent (marketing agent uses it) |
| **Agent runs** | `recordAgentRun()` in `agentLoop.ts` | Same — marketing agent tracks; inventory agent could use same pattern |
| **Tool calls** | `memory.toolCalls[]` in `agentLoop.ts` | Each tool call logged with step, tool name, args, ok/codes, durationMs, summary (truncated) | Same infrastructure available |
| **Latency** | `durationMs` per tool call + total run duration | Available | Same |
| **Failures** | `result.ok` / `result.code` / `result.message` per tool | Available | Same |
| **Audit events** | `recordAgentRun` writes to audit store; `AIUsageLog` per LLM call | Marketing agent uses it; inventory agent could adopt | Same infrastructure |
| **Request IDs** | `memory.runId` + `options.requestId` passed through the loop | Available | Same |

**Inventory-related AI tools already emit telemetry** when run through the bounded loop (same as marketing agent). The infrastructure is **plumbing-ready** — an inventory agent using the bounded loop would automatically get:
- Per-tool latency and success/failure
- LLM call count and token usage
- Agent run outcomes and errors
- Audit trace of what tools were called and in what order

**No inventory-specific observability** beyond the shared framework. The shared framework is sufficient.

---

## T. Tenant / Branch Security

**Every inventory AI-accessible data path is verified:**

| Data Path | Tenant Guard | Branch Guard | LLM-Supplied Tenant? | Cross-Restaurant Aggregation? |
|-----------|-------------|-------------|---------------------|------------------------------|
| `Product.find()` | `restaurantId` from JWT (`ctx.tenant.restaurantId`) | — | NO — never from model | N/A — always filtered |
| `Product.find({type:'inventory'})` | Same as above | — | NO | N/A |
| `Recipe.find({restaurantId})` | Same | `branchId` optional on recipe | NO | N/A |
| `InventoryEvent.find({restaurantId})` | Same | optional `branchId` filter | NO | N/A |
| `getInventoryStatusTool` | `ctx.tenant.restaurantId` validated | `resolveBranchScope(restaurantId, branchId)` → TOOL_TENANT_MISMATCH if branch doesn't belong | NO — injected from ctx only | N/A — tenant-scoped |
| `getStockoutRiskTool` | Same | `branchId` validated against tenant | NO | N/A |
| `getExpiryRiskTool` | Same | `branchId` validated against tenant | NO | N/A |
| `getWastageTool` | `ctx.tenant.restaurantId` validated | N/A (aggregate) | NO | N/A |
| `runInventoryAgent()` | Same | All 4 tools enforce tenant scoping | NO | N/A |
| `POST /api/ai/inventory-agent/recommend` | `req.user.restaurantId` from JWT | `requireFeature('inventory')` + role check | NO | N/A |
| `POST /products/:id/stock` | `req.user.restaurantId` from JWT | `requireRole('Owner','Manager','Inventory')` + `requireFeature('inventory')` | NO | N/A |

**Test by CODE TRACE only** (as instructed):
1. Tool input schema validated → `tool.inputSchema.safeParse(rawInput)` — model input never trusted
2. Tenant injected → `ctx.tenant = tenantContextFromRequest(req)` — JWT-derived only
3. Branch validated → `resolveBranchScope(restaurantId, input.branchId)` — external branchId must belong to tenant
4. All MongoDB queries filter by `restaurantId: objectId(String(restaurantId))` — never by LLM-supplied ID
5. No `aggregate` or `$lookup` that could cross tenants — each service explicitly scopes

**Conclusion**: The security model is **robust**. An LLM-powered Inventory Agent cannot read another tenant's stock, cannot mutate another tenant's data, and cannot bypass tenant isolation. The only tenant source is the authenticated JWT.

---

## U. Data Freshness / Staleness

**Freshness characteristics of inventory data:**

| Data Type | Last Updated By | Typical Freshness | Staleness Risk |
|-----------|----------------|-------------------|----------------|
| `Product.currentStock` | Purchase entries, bill consumption, manual adjustments | Minutes to hours (depends on POS/billing throughput) | Low — real-time operations |
| `Product.expiryDate` | Batch receipt (single date per batch) | Per-batch; static until new batch received | Low — batch-level, not per-unit |
| `Product.averageCost` | Rolling average of lastPurchasePrices (up to 10 entries) | Updates on every completed purchase | Medium — weighted average, recent prices have more weight |
| `InventoryEvent.type='waste'` | Manual recording or voice intake | Hours to days (depends on reporting discipline) | Medium — delayed reporting |
| Demand forecast (`generateDemandForecast`) | Historical bills (365d lookback) | Per-call freshness; data sufficiency gates confidence | High — confidence drops with less data |
| `generateIngredientConsumptionForecasts` | Demand forecast × recipes × inventory | Per-call; depends on forecast freshness | Medium — forecast quality depends on historical sales data |
| `dataSufficiencyReport` | Aggregated bill/item counts | Recomputed per call; reflects actual data in DB | Low — always reflects current DB state |

**The system already supports distinguishing:**
- **CURRENT FACT**: `Product.currentStock` > `InventoryEvent` recent counts > forecast predictions
- **PREDICTION**: demand forecast units, daysOfStock, daysUntilDepletion (confidence scored)
- **HISTORICAL OBSERVATION**: InventoryEvent aggregates over lookback windows
- **STALE DATA**: explicitly reported by `dataSufficiencyService` — e.g., `INSUFFICIENT_DATA` when < 50 bills, < 14 days history

**An Inventory Agent must distinguish these** when forming recommendations:
- If dataSufficiency.overall === 'INSUFFICIENT_DATA': report "Insufficient data — cannot generate reliable recommendations"
- If stockoutRisk is derived from forecast with LOW confidence: report "Predicted stockout in X days (low confidence — insufficient historical data)"
- If currentStock is authoritative: always report the DB value, never a computed estimate without noting the confidence gap

---

## V. Performance Risks

**Expensive inventory queries/tools:**

| Query/Tool | Likely Cost | Indexes | Caching | Timeouts | External Calls |
|------------|------------|---------|---------|----------|----------------|
| `Product.find({type:'inventory', availability:false, restaurantId})` | LOW — filtered by type + restaurantId + isDeleted indexes (compound index {restaurantId, type, isDeleted}) | ✅ Compound indexes exist | Not typically cached across requests | None (MongoDB local) | None |
| `Product.find({_id: {$in: [...]}})` for recipe ingredients | LOW-MEDIUM — number of ingredients per product is small (typically 3-10) | ✅ _id is indexed by default | Not cached | None | None |
| `Recipe.find({restaurantId, status:'active'})` | MEDIUM — one query per restaurant, returns all active recipes | ✅ Indexes: {restaurantId, productId, variantName, status}, {restaurantId, sourceRecipeId} | Not cached per request; recipes are relatively static | None | None |
| `BillModel.find({restaurantId, createdAt: {$gte: start}})` | MEDIUM-HIGH — aggregates all bills in lookback period | ✅ Index: {restaurantId, isDeleted, createdAt} | Not cached per request (but bill data is foundational) | Typically < 5s for normal restaurants | None |
| `BillItemModel.find({billId: {$in: [...]}})` | MEDIUM — per-bill-item lookup | ✅ Index: {billId, itemId, isVoided} | Not cached | None | None |
| `generateDemandForecast()` | MEDIUM — fetches bills, aggregates billItems, computes regression, seasonality | ✅ Indexes on BillModel, BillItemModel support the queries | Not cached per entity; but forecast results could be cached per (entity, period) | Tool timeout: default 10s + agent deadline clamp | None (all MongoDB) |
| `generateBatchForecasts()` (n entities) | HIGH — O(n) × generateDemandForecast cost | Same as above | Not cached; each entity independently queried | Agent budget limits steps/tool calls/cost | None |
| `InventoryEvent.find({restaurantId, type:'waste', eventDate: {$gte: start}})` | LOW-MEDIUM — waste events are sparser than bills | ✅ Index: {restaurantId, eventDate, type} | Not cached per request | None | None |
| `RecipeComponent normalizedQuantity lookup` | LOW — small per-product cache | ✅ _id ref indexing | Not cached | None | None |

**Bounded multi-tool Inventory Agent latency budget:**
The existing agent loop has these budget controls that keep latency reasonable:
- `maxSteps` (default from policy, typically 3-5 for marketing; inventory would be similar)
- `maxToolCalls` (typically 8 max per the LoopPlanSchema)
- `durationMs` wall-clock budget (typically 30s-60s)
- `maxTokens` and `maxCostUsd` budgets
- Each tool's individual timeout (default 10s, clamped to remaining run budget)

**Within these bounds**, the 4 inventory tools should operate comfortably:
- `getInventoryStatus`: ~50-100ms (single Product.find with filters)
- `getStockoutRisk`: ~200-500ms (demand forecast + recipe lookups)
- `getExpiryRisk`: ~100-300ms (Product.find for inventory items)
- `getWastage`: ~200-400ms (InventoryEvent aggregation over 60d)

**Estimated total run time**: 1-3 seconds within budget, well under typical 30s wall-clock limit.

---

## W. Legacy / Duplicate Systems

| Capability | Existing Implementation | Classification |
|-----------|------------------------|----------------|
| **Inventory status** | `getInventoryStatusTool` → `buildInventoryContext` | ACTIVE (canonical) |
| **Stockout risk** | `getStockoutRiskTool` → `generateStockoutAlerts` | ACTIVE |
| **Expiry risk** | `getExpiryRiskTool` → `generateExpiryAlerts` | ACTIVE |
| **Wastage analysis** | `getWastageTool` → `costIntelligenceCore.metrics` | ACTIVE |
| **Overstock detection** | `deriveSurplusItems` (recommendationContext) | ACTIVE |
| **Ingredient consumption forecast** | `generateIngredientConsumptionForecasts` | ACTIVE |
| **Reorder suggestions** | `getReorderSuggestionsHandler` | ACTIVE |
| **Demand forecasting** | `demandForecastingService.generateDemandForecast()` | ACTIVE (deterministic statistical) |
| **Inventory agent** | `runInventoryAgent()` + `inventoryAgent.ts` | ACTIVE (deterministic, no LLM) |
| **Marketing agent** | `runMarketingAgent()` + `marketingAgent.ts` | ACTIVE (deterministic ladder + optional LLM loop) |
| **Demand forecast ML** | `demandForecastingService` (statistical, no ML inference) | ACTIVE — ML can slot in upstream |
| **Cost intelligence** | `costIntelligenceCore.metrics()` | ACTIVE |
| **Promotion-inventory optimization** | `inventoryAwareOptimizationService.forecastStockConsumption()` | ACTIVE |

**No duplicate inventory engines** exist. The single authoritative layer is:
```
Product model (currentStock, minStock, maxStock, batches, expiryDate)
→ Authoritative services (recommendationContext, inventoryDemandForecastingService, costIntelligenceCore)
→ Inventory AI tools (4 read-only tools in shared registry)
→ Inventory agent (deterministic planner, read-only)
```

**No duplicate reorder logic** — `minStock`/`maxStock` on Product + `deriveSurplusItems` rule + `getReorderSuggestionsHandler` = one source.

**No duplicate expiry detection** — `Product.expiryDate` + `batches[].expiryDate` + `generateExpiryAlerts` = one source.

**No duplicate stock calculation** — `Product.currentStock` is the single source; all services read from it.

**No duplicate wastage tracking** — `InventoryEvent.type='waste'` + `costIntelligenceCore.metrics()` = one source.

The future Inventory Agent should sit **above** this single authoritative layer, never below it.

---

## X. Current Architecture vs Desired Agent Architecture

```
Existing:
OWNER / EVENT
    ↓
INVENTORY FACTS (MongoDB)
    ↓
AUTHORITATIVE SERVICES
    ↓
INVENTORY AI TOOLS (4 read-only, shared registry)
    ↓
DETERMINISTIC INVENTORY AGENT (inventoryAgent.ts — no LLM)
    ↓
OWNER APPROVAL → EXISTING ACTION SERVICE
    ↓
OUTCOME

Desired (with LLM):
OWNER / EVENT
    ↓
INVENTORY AGENT POLICY
    ↓
SHARED TOOL REGISTRY
    ↓
INVENTORY TOOLS (same 4 tools)
    ↓
AUTHORITATIVE INVENTORY FACTS
    +
ML SIGNALS (demand forecast predictions)
    +
HISTORICAL EVIDENCE (InventoryEvent aggregates)
    ↓
LLM → choose tool → inspect result → decide next tool → inspect result → reason → stop
    ↓
INVENTORY OPPORTUNITY / RISK (grounded in tool outputs)
    ↓
DETERMINISTIC ACTION BUILDER (recommends existing APIs)
    ↓
OWNER APPROVAL
    ↓
EXISTING ACTION SERVICE
    ↓
OUTCOME
    ↓
LEARNING / MEMORY (optional, Phase 2)
```

**Which arrows already exist:**
- ✅ `OWNER / EVENT → INVENTORY FACTS` — owner records events, facts stored in MongoDB
- ✅ `INVENTORY FACTS → AUTHORITATIVE SERVICES` — services read Product/InventoryEvent/Recipe
- ✅ `AUTHORITATIVE SERVICES → INVENTORY AI TOOLS` — 4 tools wrap the services (getInventoryStatus, getStockoutRisk, getExpiryRisk, getWastage)
- ✅ `INVENTORY AI TOOLS → DETERMINISTIC INVENTORY AGENT` — `runInventoryAgent()` combines all 4 tool outputs
- ✅ `DETERMINISTIC INVENTORY AGENT → OWNER APPROVAL` — agent result is advisory; routes require auth + role + feature flag
- ✅ `OWNER APPROVAL → EXISTING ACTION SERVICE` — owner creates purchase order, adjusts stock via approved APIs
- ✅ `EXISTING ACTION SERVICE → OUTCOME` — deterministic mutations with full audit trail

**Which arrows need to be added:**
- ➕ `INVENTORY AGENT POLICY` — new: policy defining which tools the agent may call (allow-list)
- ➕ `LLM → choose tool → inspect result → reason → stop` — new: bounded agent loop (Phase 1) wrapping the deterministic agent
- ➕ `INVENTORY OPPORTUNITY / RISK` — new: LLM reasoning over combined tool outputs to identify opportunities/risks
- ➕ `LEARNING / MEMORY` — optional Phase 2: inventory-specific long-term memories

**NO new arrows should:**
- Bypass the authoritative services
- Override deterministic inventory quantities
- Bypass tenant/branch security
- Invent stock quantities or expiry dates

---

## Y. Exact Missing Pieces Required for an Inventory Agent

The following are the **only genuinely missing components** needed to create a real Inventory Agent on top of the existing architecture:

1. **Inventory agent policy** — a list of allowed tool names for the bounded agent loop
   - Example: `['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage']`
   - Location: new file `ai/agents/policies/inventoryAgentPolicy.ts` or inline in the agent route
   - Effort: ~30 lines

2. **Optional: agentic mode on the inventory agent route** — when `agentic: true` in request options, the bounded loop runs first, then the deterministic `runInventoryAgent()` result is returned alongside the investigation trace
   - Location: `inventoryAgentRoutes.ts` + minor changes to the handler
   - Effort: ~50 lines

3. **Optional: inventory-specific system prompt customization** — the `agentLoop.ts` buildSystemPrompt() is generic; the policy's allowedTools list and the objective string make it inventory-aware. No new prompt needed if the generic one suffices.
   - Effort: 0 if generic prompt works; ~30 lines if customization desired

4. **Optional: inventory-specific learning/memory integration** — Phase 2 memory episodes/long-term memories for inventory patterns (e.g., "ingredient X repeatedly expires")
   - Location: `memory/memoryManager.ts` (would need to be created) + optional `loadMemory` injection
   - Effort: significant if wanted, not required for Phase 1

**Nothing else is missing.** The entire stack from MongoDB to tool registry is already in place. The Inventory Agent's "brain" is the LLM choosing which of the 4 existing tools to call and how to synthesize the outputs — the "body" and "nervous system" are fully operational.

---

## Z. Recommended Implementation Order

### Phase 1 — Minimal Inventory Agent (already functional, add LLM reasoning)
**Order:**
1. **Inventory agent policy** — create `inventoryAgentPolicy.ts` with allowed tool names
2. **Update inventoryAgentRoutes.ts** — add `agentic` option that runs the bounded loop, then returns both the deterministic result and the investigation trace
3. **Test the integration** — verify the bounded loop can successfully call the 4 inventory tools through the policy

### Phase 2 — Enhanced Capabilities
**Order:**
4. **Optional: inventory-specific memory** — record episodes (e.g., "ingredient X expired prematurely", "branch A low stock recurring") for use in future runs
5. **Optional: demand forecast integration** — the agent could optionally include `getDemandForecast` tool output for demand-aware recommendations (already registered in the shared registry under 'ml' category)
6. **Optional: frontend recommendation panel** — display agent output alongside stock tables in the POS dashboard

### Phase 3 — Full Agentic Loop (if needed)
**Order:**
7. **Custom system prompt** — tailor the agentLoop system prompt for inventory terminology and risk domains
8. **Additional inventory tools** — if new capabilities are needed (e.g., `getTransferRisk`, `getPromotionStockImpact`), register them in the shared registry
9. **Memory-driven recommendations** — long-term memories influence tool selection priority but never override current tool data

---

### ALREADY STRONG (can be reused immediately)

- **4 inventory AI tools** in the shared registry: `getInventoryStatus`, `getStockoutRisk`, `getExpiryRisk`, `getWastage` — all read-only, tenant-scoped, backed by authoritative services
- **Deterministic inventory agent** (`inventoryAgent.ts`) — combines the 4 tool outputs, produces purchase recommendations, stockout predictions, expiry risks, wastage signals; advisory-only, never writes
- **Shared AI infrastructure**: tool registry, bounded agent loop (agentLoop.ts), policy system, tenant context, observability (AIUsageLog, agentRun recording)
- **Authoritative inventory services**: `recommendationContext.buildInventoryContext()`, `inventoryDemandForecastingService`, `costIntelligenceCore` — all deterministic, auditable
- **Tenant/branch security**: enforced at every data path; JWT-derived restaurantId; branch validation via `resolveBranchScope()`
- **Data freshness distinction**: system already separates CURRENT FACT vs PREDICTION vs HISTORICAL OBSERVATION vs STALE DATA via `dataSufficiencyService`
- **Existing routes**: `POST /api/ai/inventory-agent/recommend` — read-only surface designed for this purpose
- **Promotion-inventory optimization**: `inventoryAwareOptimizationService` already connects promotion recommendations to stock consumption prevention

### NEEDS CONNECTION (good components not yet connected to agentic flow)

- **Bounded agent loop** (`agentLoop.ts`) — excellent framework; not yet wrapped for inventory (marketing agent uses it with `agentic: true` flag)
- **Inventory agent policy** — needs to be created to define allow-list of tool names for the loop
- **Agentic mode on inventory routes** — the `POST /api/ai/inventory-agent/recommend` endpoint could optionally run the bounded loop
- **Investigation trace** — when running in agentic mode, the LLM's tool selection path and observations are logged for auditing

### NEEDS NEW CODE (only genuinely missing components)

- **Inventory agent policy file** — define which tool names the LLM may call; minimal ~30 lines
- **Agentic route handler modifications** — optional `agentic` flag to run bounded loop before/during deterministic agent result
- **Optional: inventory-specific memory recording** — if Phase 2 long-term memories are desired

### RISK / BLOCKERS

1. **LLM hallucinating stock quantities** — MITIGATED: agent can ONLY read tool outputs; tools return authoritative DB values, never invented
2. **Bypassing tenant isolation** — MITIGATED: all tools validate `ctx.tenant.restaurantId`; branch must belong to tenant
3. **Overriding FIFO/FEFO rules** — MITIGATED: no tool exposes raw batch deduction logic; FIFO is internal engine behavior
4. **Creating duplicate inventory engine** — MITIGATED: the agent only reads from the 4 existing tools; no new DB queries or calculations
5. **Stale data leading to unsafe recommendations** — MITIGATED: `dataSufficiencyService` gates confidence; agent should report confidence levels
6. **Double deduction from recipe consumption** — MITIGATED: deterministic engine handles this; agent only reads the result
7. **Branch leakage in multi-tenant setups** — MITIGATED: `resolveBranchScope()` validates every branchId; agent can only read own tenant's branches

None of these blockers prevent safe implementation — they are all addressed by the existing architecture's security and data integrity measures.

### RECOMMENDED IMPLEMENTATION ORDER (minimal path)

1. **Create inventory agent policy** — define allowed tool names from the 4 existing inventory tools
2. **Add agentic mode to inventory agent route** — when enabled, run the bounded LLM investigation loop that calls the 4 tools through the policy, then return both the deterministic result and the investigation trace
3. **Test the integration** — verify the bounded loop can successfully call the 4 inventory tools through the policy, produce a valid result, and log the investigation observability
4. **Optional: add inventory-specific memory** — record episodes for recurring patterns (expiry risk, stockout trends) for Phase 2
5. **Optional: frontend recommendation panel** — display agent output in the POS dashboard alongside existing stock information

**Total new code**: ~150-200 lines across 2-3 files. No database changes, no new services, no duplicate logic. The entire Inventory Agent runs on top of the existing deterministic infrastructure.