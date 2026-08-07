# Product Requirements Document (PRD)
## Restaurant POS — Point of Sale & Restaurant Management System

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** July 27, 2026

---

## 1. Executive Summary

The **Restaurant POS** is a comprehensive, offline-first Point of Sale and restaurant management system designed for single and multi-branch restaurant operations. It handles the full order lifecycle — from order creation and kitchen display to billing, payments, and post-sales analytics — all within an intuitive, role-based interface. Delivered as a desktop Electron application with a web-based backend.

---

## 2. Product Vision

Empower restaurant owners and staff with a powerful, all-in-one POS terminal that works reliably even without internet, streamlines every aspect of restaurant operations, and leverages AI to provide actionable business intelligence.

---

## 3. Target Users

| Persona | Description |
|---|---|
| **Owner** | Full system access — manages all features, staff, settings, and financials |
| **Manager** | Operational control over products, customers, reports, staff (configurable via permissions) |
| **Cashier** | Core POS operations — billing, orders, kitchen display |
| **Kitchen Staff** | Views and manages KOT (Kitchen Order Tickets), updates order status |
| **Waiter** | Takes orders, assigns tables, manages guest experience |

---

## 4. Functional Requirements

### 4.1 Authentication & Session Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| AUTH-01 | Owner Registration | First-time setup wizard for creating the initial Owner account | P0 |
| AUTH-02 | Staff Login | PIN-based quick login for cashiers, username/password for managers | P0 |
| AUTH-03 | Role-Based Access | Three roles (Owner, Manager, Cashier) with configurable Manager permissions | P0 |
| AUTH-04 | Session Lock | Lock terminal with current shift close | P0 |
| AUTH-05 | JWT Authentication | Token-based auth with refresh token rotation | P0 |

### 4.2 Dashboard

| ID | Feature | Description | Priority |
|---|---|---|---|
| DASH-01 | Daily Sales Snapshot | Revenue, orders, items sold, discounts, averages | P0 |
| DASH-02 | Payment Breakdown | Cash/UPI/Card/Wallet split with counts | P0 |
| DASH-03 | Category Performance | Revenue and quantity by product category | P0 |
| DASH-04 | Top Items | Best-selling items with quantity and revenue | P0 |
| DASH-05 | Cashier Performance | Orders and revenue per cashier | P0 |
| DASH-06 | Today's Expenses | Total expenses for the day and month | P1 |
| DASH-07 | Quick Navigation | One-click access to daily sales, Z-report, sync panel | P1 |
| DASH-08 | Branch Indicator | Current branch name display for multi-branch setups | P1 |

### 4.3 Order Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| ORD-01 | Create Order | Orders for Dine In, Takeaway, Delivery, Online platforms | P0 |
| ORD-02 | Dine-In Flow | Assign table, manage guest count, assign waiter | P0 |
| ORD-03 | Takeaway Flow | Customer name/phone, preparation tracking, collection | P0 |
| ORD-04 | Online Orders | Integration platforms: Swiggy, Zomato, Uber Eats, Website, Phone Orders | P1 |
| ORD-05 | Order Status Lifecycle | New → Accepted → Preparing → Ready → Served → Waiting Payment → Paid → Closed | P0 |
| ORD-06 | Order Timeline | Complete event history with timestamps and actors | P0 |
| ORD-07 | Hold/Resume | Suspend and recall orders with full item state | P0 |
| ORD-08 | Transfer/Merge/Split | Transfer tables, merge orders, split bills | P1 |
| ORD-09 | Order Cancellation | With reason tracking and refund workflow | P1 |
| ORD-10 | Table Floor Plan | Visual table map with status colors, drag interaction | P0 |

### 4.4 Billing

| ID | Feature | Description | Priority |
|---|---|---|---|
| BIL-01 | Product Grid | Category-filtered product cards with images, code display | P0 |
| BIL-02 | Product Search | Quick search by name or product code/SKU | P0 |
| BIL-03 | Quick Fire Mode | Type product codes rapidly for fast billing | P1 |
| BIL-04 | Variant Selection | Product variants (size, type) with different pricing | P0 |
| BIL-05 | Add-Ons / Modifiers | Category-based add-ons with extra pricing | P1 |
| BIL-06 | Cart Panel | Side panel with item list, quantity controls, notes | P0 |
| BIL-07 | Customer Assignment | Search/link customer for loyalty tracking | P0 |
| BIL-08 | Loyalty Rewards | Apply reward (discount, free item, flat discount) | P0 |
| BIL-09 | Cart Discount | Manual discount application | P1 |
| BIL-10 | Payment Methods | Cash, UPI, Card, Wallet, Split payments | P0 |
| BIL-11 | KOT Preview | Review delta items before sending to kitchen | P0 |
| BIL-12 | KOT Printing | Original, Additional, and Reprint KOTs | P0 |
| BIL-13 | Intermediate Bill | Print running bill for tables | P1 |
| BIL-14 | Final Bill/Receipt | Detailed receipt with GST, discounts, loyalty points | P0 |
| BIL-15 | Auto-Print | Automatic receipt printing after payment | P1 |

### 4.5 Kitchen Display (KDS)

| ID | Feature | Description | Priority |
|---|---|---|---|
| KIT-01 | Order Queue | Real-time list of orders sent to kitchen | P0 |
| KIT-02 | KOT Status Updates | Accept → Preparing → Ready → Served | P0 |
| KIT-03 | Item Cancellation | Cancel individual items from kitchen with reason | P1 |
| KIT-04 | Order Timeline View | View full order event history | P1 |
| KIT-05 | Urgent/Priority Markers | Visual indicators for high-priority orders | P2 |

### 4.6 Product Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| PROD-01 | Product CRUD | Create, read, update, delete menu items | P0 |
| PROD-02 | Categories | Organize products by category with custom colors | P0 |
| PROD-03 | Variants | Size/type variants with different pricing per variant | P0 |
| PROD-04 | Images | Product image upload | P1 |
| PROD-05 | GST Configuration | Per-product GST percentage | P0 |
| PROD-06 | Availability Toggle | Enable/disable individual products | P0 |
| PROD-07 | Product Codes | SKU/codes for barcode scanning and quick-fire input | P1 |
| PROD-08 | Favorites | Toggle favorite products for quick access | P1 |
| PROD-09 | Category Add-ons | Configure add-on items per category | P1 |

### 4.7 Customer Management & Loyalty

| ID | Feature | Description | Priority |
|---|---|---|---|
| CUS-01 | Customer Database | Phone-based customer profiles with name, email, birthday | P0 |
| CUS-02 | Visit Tracking | Automatic visit counting per customer | P0 |
| CUS-03 | Loyalty Points | Points earned per purchase (configurable rate) | P0 |
| CUS-04 | Purchase History | Complete order history per customer | P0 |
| CUS-05 | Reward Redemption | Apply rewards at checkout (percentage, flat, free item) | P0 |
| CUS-06 | Visit Milestones | Bonus rewards at configurable visit thresholds | P1 |
| CUS-07 | Birthday Tracking | Birthday field and potential automated offers | P2 |
| CUS-08 | Customer Blocklist | Block problematic customers | P2 |

### 4.8 Offers Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| OFR-01 | Create Offers | Define discount offers with conditions | P1 |
| OFR-02 | Offer Popup | Contextual offer display during billing | P1 |
| OFR-03 | Auto-Apply Rules | Automatic best-offer selection logic | P2 |

### 4.9 Employee/Staff Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| STF-01 | Employee CRUD | Manage staff profiles with roles | P0 |
| STF-02 | PIN Authentication | Quick 4-digit PIN for cashier login | P0 |
| STF-03 | Role Assignment | Owner, Manager, Cashier roles | P0 |
| STF-04 | Login Sessions | Track staff login/logout sessions | P1 |
| STF-05 | Cashier Shift Closing | End-of-shift with terminal lock | P1 |

### 4.10 Multi-Branch Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| BRA-01 | Branch CRUD | Create and manage multiple branches/locations | P0 |
| BRA-02 | Head Branch | Designate one branch as the head/main branch | P0 |
| BRA-03 | Branch Switching | Quick switch between branches in the title bar | P0 |
| BRA-04 | Per-Branch Settings | Independent settings per branch | P1 |

### 4.11 Reservations & Waiting List

| ID | Feature | Description | Priority |
|---|---|---|---|
| RES-01 | Reservation CRUD | Create/manage table reservations with date/time | P1 |
| RES-02 | Table Assignment | Assign reserved tables to reservations | P1 |
| RES-03 | Status Tracking | Confirmed → Seated → Cancelled → No Show | P1 |
| RES-04 | Waiting List | Walk-in waiting list with estimated wait times | P1 |
| RES-05 | Notification | Alert when table becomes available for waiting guests | P2 |

### 4.12 Expense Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| EXP-01 | Expense Entry | Record expenses with category, amount, vendor, payment method | P1 |
| EXP-02 | Expense Categories | Predefined categories (Ingredients, Salaries, Utilities, Rent, etc.) | P1 |
| EXP-03 | Date Filtering | View expenses by date range | P1 |
| EXP-04 | Recurring Expenses | Mark expenses as recurring | P2 |

### 4.13 Inventory Management

| ID | Feature | Description | Priority |
|---|---|---|---|
| INV-01 | Inventory Dashboard | Overview of stock levels and health | P1 |
| INV-02 | Stock Tracking | Track ingredient/raw material quantities | P1 |
| INV-03 | Supplier Info | Vendor/supplier details per item | P2 |
| INV-04 | AI Inventory Health | AI-powered inventory health scoring | P2 |
| INV-05 | AI Low Stock Predictions | Predict when stock will run out | P2 |
| INV-06 | AI Purchase Recommendations | Smart reorder suggestions | P2 |
| INV-07 | AI Waste Analysis | Analyze and report inventory waste | P2 |
| INV-08 | AI Voice Entry | Voice-controlled inventory updates | P3 |

### 4.14 Reports

| ID | Feature | Description | Priority |
|---|---|---|---|
| REP-01 | Z-Report | End-of-day financial summary | P0 |
| REP-02 | Daily Sales Report | Detailed daily revenue breakdown | P0 |
| REP-03 | Payment Summary | Payment method aggregation | P1 |
| REP-04 | Tax Summary | GST collection report | P1 |
| REP-05 | Item Sales Report | Per-item quantity and revenue | P1 |
| REP-06 | Export | Export reports to CSV/PDF | P2 |

### 4.15 Analytics

| ID | Feature | Description | Priority |
|---|---|---|---|
| ANL-01 | Sales Trends | Revenue charts over time | P1 |
| ANL-02 | Category Analysis | Category performance breakdown | P1 |
| ANL-03 | Hourly/Daily Patterns | Busy hour identification | P2 |
| ANL-04 | AI Daily Summary | AI-generated daily business summary | P2 |
| ANL-05 | AI Weather Recommendations | Weather-based menu/promotion suggestions | P3 |

### 4.16 Finance

| ID | Feature | Description | Priority |
|---|---|---|---|
| FIN-01 | Profit Overview | Revenue vs expenses visualization | P2 |
| FIN-02 | Cash Flow | Cash inflow/outflow tracking | P2 |

### 4.17 Settings

| ID | Feature | Description | Priority |
|---|---|---|---|
| SET-01 | Restaurant Info | Name, address, phone, GSTIN, currency | P0 |
| SET-02 | Receipt Customization | Print size (58mm/80mm), logo, footer, QR code, tax summary | P0 |
| SET-03 | Loyalty Configuration | Points rate, visit milestones, bonus points | P0 |
| SET-04 | Module Toggle | Enable/disable modules (Table service, Kitchen, Loyalty, Delivery, etc.) | P0 |
| SET-05 | AI Feature Toggles | Enable/disable individual AI features | P1 |
| SET-06 | Role Permissions | Configure what roles can access (Manager permissions toggles) | P0 |
| SET-07 | Printer Routing | Route KOT categories to specific printers | P1 |
| SET-08 | Branding | Color scheme, sidebar logo customization | P1 |

### 4.18 Sync & Offline

| ID | Feature | Description | Priority |
|---|---|---|---|
| SYN-01 | Offline-First | Full POS operation without internet | P0 |
| SYN-02 | Background Sync | Automatic data sync when connection is restored | P0 |
| SYN-03 | Conflict Resolution | Handle concurrent edits with last-write-wins strategy | P0 |
| SYN-04 | Sync Status Indicator | Visual online/offline indicator | P0 |
| SYN-05 | Manual Sync Panel | Trigger sync and view sync history | P1 |
| SYN-06 | Activity Feed | Real-time local activity log | P1 |

### 4.19 Onboarding

| ID | Feature | Description | Priority |
|---|---|---|---|
| TR-01 | Guided Tour | Step-by-step interactive tour for new users | P1 |
| TR-02 | First-Time Setup | Initial owner registration and restaurant configuration | P0 |
| TR-03 | Keyboard Shortcuts | Comprehensive keyboard shortcut system with guide | P1 |

---

## 5. Non-Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| NFR-01 | Desktop App | Electron-based desktop application for Windows, macOS, Linux |
| NFR-02 | Offline-First | All core operations work without internet; syncs when online |
| NFR-03 | Performance | Sub-second response for billing operations, smooth animations |
| NFR-04 | Role Security | Strict role enforcement; Owner always has full access, Cashier restricted |
| NFR-05 | Data Persistence | IndexedDB/localStorage for offline data with cloud sync |
| NFR-06 | Receipt Printing | Thermal printer support (58mm and 80mm) via Electron |
| NFR-07 | KOT Printing | Kitchen order ticket printing with category-based routing |
| NFR-08 | Multi-Branch | Branch-level data isolation with head branch consolidation |
| NFR-09 | Scalability | Support 5000+ products, 10000+ daily transactions locally |
| NFR-10 | Packaging | NSIS (Windows), DMG (macOS), AppImage/Deb (Linux) installers |

---

## 6. Technical Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | React 19, TypeScript 5.8 |
| **Build Tool** | Vite 6 |
| **Styling** | Tailwind CSS 4 |
| **Desktop Shell** | Electron (custom main process) |
| **State Management** | React hooks + localStorage/IndexedDB |
| **Routing** | React Router DOM v7 |
| **HTTP Client** | Axios |
| **Charts** | Recharts |
| **Drag & Drop** | dnd-kit |
| **UI Icons** | Lucide React |
| **Animations** | Motion (Framer Motion v12) |
| **Backend** | Node.js + Express |
| **Database** | MongoDB (via Mongoose) |
| **Auth** | JWT with refresh tokens, bcrypt |
| **Testing** | Vitest, Playwright, React Testing Library |
| **E2E Testing** | Playwright |
| **AI Integration** | Google Generative AI |

---

## 7. UI/UX Guidelines

### 7.1 Design Principles
- **Speed-First**: Optimized for rapid order entry — keyboard shortcuts, quick-fire mode, minimal clicks
- **Touch-Friendly**: Large tappable areas for tablet usage
- **Visual Hierarchy**: Color-coded table status, product categories, order priorities
- **Consistency**: Uniform component patterns across all workspaces
- **Offline Awareness**: Clear online/offline status indicator

### 7.2 Layout
- Custom title bar with restaurant name, time, branch selector, online status
- Collapsible sidebar navigation (hidden during billing for maximum space)
- Main content area switching between workspaces
- Right-side cart panel during billing

### 7.3 Workspaces (18 total)

| # | Workspace | Purpose |
|---|---|---|
| 1 | **Dashboard** | Daily sales overview, performance metrics, quick links |
| 2 | **Billing** | Product grid + cart panel — the primary billing interface |
| 3 | **Orders** | Table floor plan, takeaway orders, order management |
| 4 | **Kitchen** | KOT queue with status management |
| 5 | **Products** | Menu management (CRUD, categories, variants) |
| 6 | **Customers** | Customer profiles, loyalty, purchase history |
| 7 | **Offers** | Discount and promotion management |
| 8 | **Reports** | Z-report, daily sales, payment summary |
| 9 | **Staff** | Employee management and role assignment |
| 10 | **Branches** | Multi-branch management |
| 11 | **Reservations** | Table reservations and waiting list |
| 12 | **Expenses** | Expense tracking and categorization |
| 13 | **Analytics** | Sales trends, category analysis, AI insights |
| 14 | **Finance** | Profit/loss and cash flow visualization |
| 15 | **Inventory** | Stock management with AI features |
| 16 | **Receipt History** | Historical receipt lookup |
| 17 | **Settings** | System configuration with module toggles |
| 18 | **More** | Additional tools (help, about, etc.) |

### 7.4 Modal System
- Receipt Preview/Print Modal
- Payment Confirmation Modal
- KOT Preview Modal
- Split Payment Modal
- OTP Verification Modal (for high-value rewards)
- Held Orders Drawer
- Daily Sales Modal
- Activity Feed Modal
- Z-Report Modal
- Sync Panel Modal
- Void Reason Modal
- Add-On Modal (customization options)
- Customer Search Popup
- Confirmation Dialog
- Offers Popup
- Shortcuts Guide
- Guided Tour
- Order Timeline Panel

---

## 8. Architecture

```
┌──────────────────────────────────────────────────┐
│              Electron Shell                      │
│  ┌────────────────────────────────────────────┐  │
│  │           React Application               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐  │  │
│  │  │Workspaces│ │  Modals  │ │  Hooks   │  │  │
│  │  ├──────────┤ ├──────────┤ ├──────────┤  │  │
│  │  │  Cart /  │ │  KOT /   │ │ POS State│  │  │
│  │  │ Billing  │ │ Kitchen  │ │ Mgmt     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘  │  │
│  │  ┌────────────────────────────────────┐   │  │
│  │  │   Sync Engine (Offline-First)      │   │  │
│  │  └────────────────────────────────────┘   │  │
│  │  ┌────────────────────────────────────┐   │  │
│  │  │   localStorage / IndexedDB         │   │  │
│  │  └────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────────┘
                   │ HTTP/REST (when online)
┌──────────────────▼───────────────────────────────┐
│             Backend (Express)                    │
│  ┌────────┐ ┌────────────┐ ┌────────────────┐   │
│  │ Auth   │ │Controllers │ │ Validation     │   │
│  │ + JWT  │ │ + Services │ │ (Zod schemas)  │   │
│  └────────┘ └────────────┘ └────────────────┘   │
│  ┌──────────────────────────────────────────┐    │
│  │        MongoDB (Mongoose Models)         │    │
│  │  Restaurant, Branch, Product, Order,     │    │
│  │  Bill, Customer, Employee, Table, ...    │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## 9. Data Models

| Entity | Description | Key Fields |
|---|---|---|
| **Restaurant** | Top-level tenant | name, address, status, plan |
| **Branch** | Restaurant location | name, address, isHeadBranch, isActive |
| **Product** | Menu item | name, price, category, gstPercent, variants, code, image |
| **ProductVariant** | Size/type variant | name, price |
| **Order** | Full order lifecycle | type, status, tableId, items, kotRecords, timeline |
| **Bill** | Completed transaction | invoiceNumber, items, subtotal, gst, grandTotal, paymentMethod |
| **Customer** | Loyalty profile | phone, name, points, visits, purchaseHistory |
| **Employee** | Staff account | username, name, role, pin, status |
| **Table** | Restaurant table | number, capacity, status, section |
| **TakeawayOrder** | Takeaway delivery | customerName, status, paymentStatus |
| **KOTRecord** | Kitchen ticket | kotNumber, type, status, items |
| **TimelineEvent** | Order history | type, description, timestamp, actor |
| **HeldOrder** | Suspended order | items, customer, type, timestamp |
| **Reward** | Loyalty reward | title, pointsRequired, type, value |
| **Reservation** | Table reservation | customerName, date, time, guestCount, status |
| **WaitingEntry** | Walk-in waitlist | customerName, guestCount, estimatedWaitMinutes |
| **Expense** | Business expense | category, amount, description, date, paymentMethod |
| **DailySales** | Sales summary | revenue, orders, items, paymentBreakdown, categoryBreakdown |
| **SystemSettings** | Config | restaurantName, gstin, currency, printSize, brandingColor, moduleSettings, rolePermissions |

---

## 10. AI Features

| Feature | Description | Backend |
|---|---|---|
| **AI Daily Summary** | AI-generated business performance summary for the day | Google Generative AI |
| **AI Inventory Health** | Health scoring for inventory items based on usage patterns | Google Generative AI |
| **AI Purchase Recommendations** | Smart reorder suggestions based on historical consumption | Google Generative AI |
| **AI Low Stock Predictions** | Predict when items will run out of stock | Google Generative AI |
| **AI Waste Analysis** | Analyze inventory waste patterns and suggest improvements | Google Generative AI |
| **AI Voice Entry** | Voice-controlled inventory data entry | Google Generative AI |
| **AI Weather Recommendations** | Weather-based menu and promotion suggestions | Google Generative AI |
| **AI Closing Assistant** | End-of-day closing checklist and assistant | Google Generative AI |

---

## 11. Future Considerations

| Feature | Description | Priority |
|---|---|---|
| Online ordering website | Customer-facing web ordering portal | P3 |
| QR code ordering | Scan-to-order at table | P2 |
| Delivery fleet management | Track delivery personnel and orders | P3 |
| Social media integration | Instagram/Facebook menu display | P3 |
| Advanced analytics dashboard | Deeper business intelligence with drill-downs | P2 |
| Mobile companion app | Staff management and basic reporting on mobile | P3 |
| Accounting software integration | Export to Tally, QuickBooks, Zoho | P3 |
| Payment gateway integration | Direct online payment processing | P2 |
| Vendor management | Supplier ordering and invoice management | P3 |
| Shift scheduling | Employee shift planning and time tracking | P3 |
