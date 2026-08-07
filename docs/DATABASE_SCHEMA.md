# DATABASE_SCHEMA.md — MongoDB Data Models & Schema Reference

## Overview

The backend uses MongoDB with Mongoose object modeling. All entities maintain explicit schemas with indexes optimized for rapid POS transaction lookup, multi-branch isolation, and real-time report aggregation.

---

## 1. Core Data Models

### A. Employee / Staff (`User` Collection)
- `_id`: ObjectId
- `restaurantId`: String (Indexed)
- `branchId`: String (Indexed)
- `name`: String
- `username`: String (Unique)
- `passcode`: String (Hashed or 4-digit PIN)
- `role`: Enum [`Owner`, `Manager`, `Cashier`, `Kitchen`, `Waiter`]
- `status`: Enum [`Active`, `Inactive`]
- `createdAt`, `updatedAt`: Date timestamps

### B. Product & Catalog (`Product` Collection)
- `_id`: ObjectId
- `restaurantId`: String (Indexed)
- `code`: String (Unique SKU / Barcode)
- `name`: String
- `category`: String (Indexed)
- `price`: Number
- `costPrice`: Number
- `taxRate`: Number
- `availability`: Boolean
- `favorite`: Boolean
- `variants`: Array of `{ id, name, price, costPrice }`
- `addOnGroups`: Array of `{ id, name, required, options }`

### C. Bill & Transaction (`Bill` Collection)
- `_id`: ObjectId
- `restaurantId`: String (Indexed)
- `branchId`: String (Indexed)
- `billNumber`: Number (Indexed)
- `orderType`: Enum [`Dine In`, `Takeaway`, `Delivery`, `Swiggy`, `Zomato`, `Uber Eats`]
- `tableNumber`: Number (Optional)
- `items`: Array of Cart items with variant, add-ons, price, tax
- `subtotal`: Number
- `discountAmount`: Number
- `taxAmount`: Number
- `grandTotal`: Number
- `paymentMethod`: Enum [`Cash`, `UPI`, `Card`, `Wallet`, `Split`]
- `splitDetails`: Object (Cash, Card, UPI breakdown)
- `cashierId`: ObjectId / String
- `customerPhone`: String (Optional)
- `status`: Enum [`Paid`, `Refunded`, `Voided`]
- `createdAt`: Date (Indexed)

### D. Loyalty Customer (`Customer` Collection)
- `_id`: ObjectId
- `restaurantId`: String (Indexed)
- `name`: String
- `phone`: String (Indexed)
- `loyaltyPoints`: Number
- `totalSpend`: Number
- `visitCount`: Number
- `rewardsRedeemed`: Array

---

## 2. Indexing Strategy

- Compound index `{ restaurantId: 1, branchId: 1 }` on transactional collections.
- Text indexes on `name` and `code` fields for rapid fuzzy product/customer searching.
