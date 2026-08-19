# DATABASE_SCHEMA.md — MongoDB Collections & Models

The backend uses MongoDB with Mongoose. All models live in
`backend/src/models/*.ts`. Most resources are tenant-scoped by
`restaurantId` (and optionally `branchId`).

This document lists the actual collections and the important fields of the
core models. For exact schemas/indexes read the model files — they are the
source of truth.

---

## 1. Core Identity & Tenancy

### Restaurant
`name, slug, phone, address, status, createdAt/updatedAt`

### Branch
`restaurantId, name, address, isHeadOffice, status`

### Employee / User
- `Employee`: `restaurantId, branchId, name, username, password (bcrypt), pin (bcrypt), role (Owner|Manager|Cashier|Kitchen|Waiter), active, permissions`
- `User`: platform user (admin/auth identity)

### Device
`restaurantId, branchId, name, deviceId, status, lastSeen, authorization`

## 2. Catalog & Pricing

### Product
`name, code, price, category, image, gstPercent, taxClassification, taxSource, availability, favorite, restaurantId, branchPrice (Map), isCombo/comboComponentIds/comboPrice, voiceAliases/searchAliases/learnedAliases, currentStock, unit, minStock, maxStock, reorderLevel, averageCost, supplier, storageLocation, barcode, expiryDate, batchNumber, menuConfig {variantConfigurations, modifierConfigurations, addOnConfigurations}`

### ProductVariant
`productId, name, price, branchPrice, sortOrder, active`

### ConfigurationTemplate (menu-config)
`restaurantId, name, type (VARIANT_GROUP|MODIFIER_GROUP|ADD_ON_GROUP), data {selectionMode, required, minSelections, maxSelections, options[{id, name, price, priceDelta, active, sortOrder}]}`

## 3. Orders, Billing & Payments

### Order / OrderItem
Order: `restaurantId, branchId, orderNumber, type (Dine In|Takeaway|Delivery), tableId, status, items[], kotStatus, customer, employee, createdAt`
OrderItem: per-line product snapshot (price at sale, qty, selected config).

### Bill / BillItem
Bill: `restaurantId, branchId, billNumber, orderId, items[], subtotal, discount, gst, netTotal, paymentMethod, paymentDetails, splitDetails, customer, cashier, status (Paid|Refunded|Voided), createdAt`
BillItem: `productId, name, priceAtSale, gstRateAtSale, discountAtSale, quantity, selectedVariant, addOns, customizations, notes`

### Payment
`billId, restaurantId, method, amount, status, reference, gateway (Razorpay)`

### KOTRecord
`orderId, items, status (Pending|Preparing|Ready|Delivered), sentAt, printed, delta`

### RefundRecord / OrderAdjustment
Refunds and post-bill adjustments.

## 4. Customers & Loyalty

### Customer
`restaurantId, name, phone, email, city, state, gstNumber, tags, marketingOptIn, loyaltyPoints, totalSpend, visitCount`

### CustomerVisit / CustomerActivity
Visit history and activity timeline.

### Reward / LoyaltyTier / LoyaltySettings / LoyaltyTransaction
Reward rules, tier thresholds, config, and point ledger.

### CouponRedemption / Referral
Coupon usage and referral tracking.

## 5. Inventory & Recipes

### InventoryEvent
`restaurantId, productId, branchId, delta, type (purchase|sale|waste|adjustment|opening|closing|correction|return), reason, unit, purchasePrice`

### Purchase
`restaurantId, supplierId, items[], total, date`

### Supplier / Vendor
Supplier (ingredient source) and vendor (expense) records.

### Recipe / RecipeVersion / RecipeConsumption
`recipe: productId, name, components[{inventoryItemId, itemName, unit, quantity, wastagePercent, optional}], status, version`
Consumption ties recipe ingredient usage to inventory deductions.

## 6. Offers, Campaigns & Marketing

### Offer / OfferAnalytics
Offer rules (discount types, thresholds, validity), analytics.

### Campaign / CampaignHistory
Campaign runs and history.

### Promotion
Promotion rules for the marketing module.

### MarketingAutomation
Automated campaign triggers.

### CustomerSegment
Segment definitions for targeting.

## 7. Settings, Subscription & Finance

### Settings (RestaurantSettings)
Tenant-scoped settings: `restaurantId, scope (restaurant|branch|device), branchId, deviceId, settings (object), settingsVersion, history[], changeReason, updatedBy` — includes `defaultTaxRate`, `taxRules` (classification → rate), invoice numbering, receipt toggles, business hours, branding.

### Subscription / SubscriptionPlan
Plan entitlements (`features[]`), status, trial, expiry.

### CashLedger / FinanceSettings / Expense / ExpenseCategory / RecurringExpense
Finance records and config.

### Invoice / InvoiceCounter
Invoice numbering.

## 8. AI, Voice & Platform

### AIUsageLog / AiQuotaSnapshot
AI token/usage logging and quota snapshots.

### AdvisorRecommendation
Business advisor output records.

### ReceiptFeedback
Customer feedback on digital receipts.

### HelpView (help-analytics)
Help center view tracking.

### AuditLog
`action, entityType, entityId, performedBy, restaurantId, branchId, details, createdAt` — settings and admin actions.

### LegalDocument / LegalAcceptance
Published legal docs (immutable versions) and per-user acceptance records.

### Table / Floor / WaitingEntry / HeldOrder
Table management, floorplans, waitlist, held orders.

### DailySummary / MonthlySummary / YearlySummary
Rolled-up analytics snapshots.

### BlockedIp / RefreshToken / OtpRequest / Authorization / WebhookEvent
Security and integration records.

---

## 9. Indexing Strategy

- Compound `{ restaurantId, branchId }` indexes on transactional collections.
- Text indexes on product `name` + aliases for fuzzy search.
- Menu-config ref arrays indexed by `templateId` for usage counts.
- Date-indexed `createdAt` on bills/orders for daily/report aggregations.
