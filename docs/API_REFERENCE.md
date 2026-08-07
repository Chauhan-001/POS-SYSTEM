# API_REFERENCE.md — Backend REST API Specification

## Overview

Base URL: `http://localhost:3002/api`
All protected endpoints require HTTP Header:
`Authorization: Bearer <JWT_TOKEN>`

---

## 1. Authentication Endpoints

### `POST /api/auth/login`
- **Purpose**: Authenticates cashier/staff via username/pin.
- **Request Body**:
  ```json
  { "username": "admin", "passcode": "1008" }
  ```
- **Response**:
  ```json
  {
    "token": "JWT...",
    "employee": { "id": "...", "name": "Admin", "role": "Owner", "branchId": "b1" }
  }
  ```

---

## 2. Products & Inventory Endpoints

### `GET /api/products`
- **Purpose**: Retrieves all available products for active restaurant/branch.
- **Response**: Array of product objects.

### `POST /api/products`
- **Purpose**: Creates a new product in catalog.

### `PUT /api/products/:id`
- **Purpose**: Updates existing product or price overrides.

---

## 3. Billing & Transactions Endpoints

### `POST /api/bills`
- **Purpose**: Saves a new completed bill.

### `POST /api/bills/sync`
- **Purpose**: Accepts array of buffered offline transactions from POS desktop terminal.
- **Request Body**:
  ```json
  { "bills": [ { "billNumber": 101, ... }, { "billNumber": 102, ... } ] }
  ```

### `GET /api/bills/daily-summary`
- **Purpose**: Calculates daily sales, tax collected, and payment method breakdown for Z-Report.
