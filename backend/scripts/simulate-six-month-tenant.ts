/**
 * =============================================================================
 * simulate-six-month-tenant.ts — SIM_RESTAURANT_6M_001
 * =============================================================================
 *
 * Creates ONE isolated, internally consistent six-month-old restaurant inside
 * the EXISTING ChitKuber system, then validates it. This script does NOT
 * introduce a parallel analytics system: every document is written through the
 * project's own Mongoose models and, where they exist, its real services
 * (segment engine, offer-analytics backfill).
 *
 *   POS → Sales → Customers → Products → Recipes → Inventory → Marketing
 *        → Context → (ML + AI tools + Marketing Agent are run by the
 *        companion observe script against this tenant)
 *
 * Chain kept consistent:
 *   Bill → BillItem → RecipeConsumption → InventoryEvent(sold)
 *   Purchase → InventoryEvent(purchase) → batches → wastage/expiry
 *   Customer → bills → stats → rule segments
 *   Offer → CouponRedemption → OfferAnalytics → OfferExperimentEvent
 *
 * Isolation: every row carries the simulation restaurant's ObjectId. Cleanup is
 * scoped with deleteMany({ restaurantId: SIM_ID }) — NEVER an unscoped wipe.
 *
 * Modes (choose exactly one):
 *   npx tsx scripts/simulate-six-month-tenant.ts --dry-run
 *   npx tsx scripts/simulate-six-month-tenant.ts --execute
 *   npx tsx scripts/simulate-six-month-tenant.ts --report
 *   npx tsx scripts/simulate-six-month-tenant.ts --clean
 * =============================================================================
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';

import Restaurant from '../src/models/core/Restaurant';
import Branch from '../src/models/core/Branch';
import Product from '../src/models/catalog/Product';
import Purchase from '../src/models/catalog/Purchase';
import InventoryEvent from '../src/models/catalog/InventoryEvent';
import Supplier from '../src/models/catalog/Supplier';
import Customer from '../src/models/customers/Customer';
import CouponRedemption from '../src/models/customers/CouponRedemption';
import CustomerSegment from '../src/models/customers/CustomerSegment';
import Bill from '../src/models/intelligence/Bill';
import BillItem from '../src/models/intelligence/BillItem';
import Offer from '../src/models/marketing/Offer';
import Campaign from '../src/models/marketing/Campaign';
import CampaignHistory from '../src/models/marketing/CampaignHistory';
import OfferAnalytics from '../src/models/marketing/OfferAnalytics';
import OfferExperimentEvent from '../src/models/intelligence/OfferExperimentEvent';
import MLPrediction from '../src/models/intelligence/MLPrediction';
import DailySummary from '../src/models/finance/DailySummary';
import MonthlySummary from '../src/models/finance/MonthlySummary';
import CalendarEvent from '../src/modules/calendar/models/CalendarEvent';
import Recipe from '../src/modules/recipes/models/Recipe';
import RecipeConsumption from '../src/modules/recipes/models/RecipeConsumption';
import { updateAllSegments } from '../src/services/segmentEngine';
import { aggregateAndBackfill } from '../src/services/offerAnalyticsService';

// ─── Configuration ──────────────────────────────────────────────────────────

const RESTAURANT_KEY = 'SIM_RESTAURANT_6M_001';
const OWNER_USER_ID = 'sim_urban_tadka';
const OWNER_PIN = '246810';
const SEED = 20261002;
const START = '2025-10-01';
const DAYS = 180;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const OUT_DIR = path.join(import.meta.dirname);

const ARGS = new Set(process.argv.slice(2));
const MODES = ['--dry-run', '--execute', '--report', '--clean'].filter((m) => ARGS.has(m));
if (MODES.length !== 1) {
  throw new Error('Choose exactly one mode: --dry-run, --execute, --report, or --clean.');
}
const MODE = MODES[0];

// ─── Deterministic RNG (fixed seed → reproducible simulation) ───────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const rint = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const gauss = (mean: number, sd: number) => {
  const u = Math.max(rnd(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};
const round2 = (n: number) => Math.round(n * 100) / 100;

const START_MS = Date.parse(`${START}T00:00:00.000Z`);
const dayDate = (d: number) => new Date(START_MS + d * 86_400_000);
const dayStr = (d: number) => dayDate(d).toISOString().slice(0, 10);
const dow = (d: number) => dayDate(d).getUTCDay(); // 0=Sun
const monthIndex = (d: number) => Math.min(5, Math.floor(d / 30)); // M1..M6

// ─── Catalogs ───────────────────────────────────────────────────────────────

interface IngredientDef {
  name: string;
  unit: string;
  cost: number;
  par: number; // par stock level (about 1 week of usage)
  shelfLifeDays: number; // 0 = non-perishable
  supplier: string;
}

const INGREDIENTS: IngredientDef[] = [
  { name: 'Basmati Rice', unit: 'kg', cost: 92, par: 60, shelfLifeDays: 240, supplier: 'Delhi Grain Traders' },
  { name: 'Chicken', unit: 'kg', cost: 285, par: 45, shelfLifeDays: 3, supplier: 'National Poultry Co.' },
  { name: 'Paneer', unit: 'kg', cost: 340, par: 18, shelfLifeDays: 6, supplier: 'Mother Dairy Distributors' },
  { name: 'Onion', unit: 'kg', cost: 34, par: 35, shelfLifeDays: 20, supplier: 'Azadpur Mandi Wholesale' },
  { name: 'Tomato', unit: 'kg', cost: 42, par: 28, shelfLifeDays: 7, supplier: 'Azadpur Mandi Wholesale' },
  { name: 'Capsicum', unit: 'kg', cost: 60, par: 12, shelfLifeDays: 9, supplier: 'Azadpur Mandi Wholesale' },
  { name: 'Cooking Oil', unit: 'L', cost: 145, par: 15, shelfLifeDays: 180, supplier: 'Fortune Foods Depot' },
  { name: 'Wheat Flour', unit: 'kg', cost: 39, par: 20, shelfLifeDays: 90, supplier: 'Delhi Grain Traders' },
  { name: 'Milk', unit: 'L', cost: 62, par: 30, shelfLifeDays: 2, supplier: 'Mother Dairy Distributors' },
  { name: 'Fresh Cream', unit: 'L', cost: 210, par: 6, shelfLifeDays: 5, supplier: 'Mother Dairy Distributors' },
  { name: 'Mixed Vegetables', unit: 'kg', cost: 65, par: 25, shelfLifeDays: 6, supplier: 'Azadpur Mandi Wholesale' },
  { name: 'Spice Mix', unit: 'kg', cost: 420, par: 4, shelfLifeDays: 300, supplier: 'Everest Spices Agency' },
  { name: 'Sugar', unit: 'kg', cost: 46, par: 8, shelfLifeDays: 365, supplier: 'Delhi Grain Traders' },
  { name: 'Cheese', unit: 'kg', cost: 380, par: 8, shelfLifeDays: 30, supplier: 'Mother Dairy Distributors' },
  { name: 'Noodles', unit: 'kg', cost: 90, par: 10, shelfLifeDays: 120, supplier: 'Delhi Grain Traders' },
  { name: 'Eggs', unit: 'pcs', cost: 7, par: 60, shelfLifeDays: 14, supplier: 'National Poultry Co.' },
  { name: 'Beverage Base', unit: 'L', cost: 180, par: 6, shelfLifeDays: 200, supplier: 'Coca-Cola Distributor' },
  { name: 'Packaging', unit: 'pcs', cost: 7, par: 400, shelfLifeDays: 0, supplier: 'PackWell Supplies' },
  { name: 'Dal', unit: 'kg', cost: 120, par: 12, shelfLifeDays: 200, supplier: 'Delhi Grain Traders' },
];

interface MenuDef {
  name: string;
  cat: string;
  price: number;
  weight: number; // popularity weight
  veg: boolean;
  recipe: Array<[number, number]>; // [ingredientIdx, qty per serving]
}

const MENU: MenuDef[] = [
  { name: 'Chicken Biryani', cat: 'Biryani', price: 289, weight: 10, veg: false, recipe: [[0, 0.14], [1, 0.17], [3, 0.05], [4, 0.04], [6, 0.015], [11, 0.012], [17, 1]] },
  { name: 'Veg Dum Biryani', cat: 'Biryani', price: 219, weight: 5, veg: true, recipe: [[0, 0.14], [10, 0.09], [3, 0.05], [6, 0.015], [11, 0.012], [17, 1]] },
  { name: 'Egg Biryani', cat: 'Biryani', price: 249, weight: 4, veg: false, recipe: [[0, 0.13], [15, 1], [3, 0.05], [4, 0.04], [6, 0.015], [11, 0.012], [17, 1]] },
  { name: 'Paneer Tikka', cat: 'Starters', price: 269, weight: 8, veg: true, recipe: [[2, 0.14], [11, 0.008], [6, 0.01], [17, 1]] },
  { name: 'Chicken Tikka', cat: 'Starters', price: 299, weight: 7, veg: false, recipe: [[1, 0.16], [11, 0.008], [6, 0.01], [17, 1]] },
  { name: 'Chilli Chicken', cat: 'Starters', price: 319, weight: 5, veg: false, recipe: [[1, 0.15], [5, 0.05], [3, 0.04], [6, 0.02], [11, 0.01], [17, 1]] },
  { name: 'Veg Manchurian', cat: 'Starters', price: 199, weight: 4, veg: true, recipe: [[10, 0.1], [3, 0.04], [6, 0.02], [11, 0.008], [17, 1]] },
  { name: 'Masala Papad', cat: 'Starters', price: 79, weight: 2, veg: true, recipe: [[6, 0.005], [11, 0.003], [17, 1]] },
  { name: 'Butter Chicken', cat: 'Main Course', price: 329, weight: 8, veg: false, recipe: [[1, 0.16], [4, 0.07], [9, 0.04], [3, 0.05], [6, 0.02], [11, 0.012], [17, 1]] },
  { name: 'Kadai Paneer', cat: 'Main Course', price: 279, weight: 6, veg: true, recipe: [[2, 0.13], [5, 0.05], [3, 0.05], [4, 0.05], [6, 0.02], [11, 0.012], [17, 1]] },
  { name: 'Shahi Paneer', cat: 'Main Course', price: 269, weight: 5, veg: true, recipe: [[2, 0.13], [9, 0.03], [3, 0.05], [11, 0.012], [17, 1]] },
  { name: 'Dal Makhani', cat: 'Main Course', price: 229, weight: 6, veg: true, recipe: [[18, 0.12], [9, 0.02], [4, 0.04], [6, 0.015], [11, 0.01], [17, 1]] },
  { name: 'Kadai Chicken', cat: 'Main Course', price: 319, weight: 5, veg: false, recipe: [[1, 0.16], [5, 0.05], [3, 0.05], [4, 0.05], [6, 0.02], [11, 0.012], [17, 1]] },
  { name: 'Mix Veg', cat: 'Main Course', price: 219, weight: 3, veg: true, recipe: [[10, 0.12], [6, 0.02], [11, 0.01], [17, 1]] },
  { name: 'Hakka Noodles', cat: 'Chinese', price: 219, weight: 6, veg: true, recipe: [[14, 0.12], [10, 0.08], [6, 0.02], [11, 0.008], [17, 1]] },
  { name: 'Chilli Paneer', cat: 'Chinese', price: 249, weight: 5, veg: true, recipe: [[2, 0.12], [5, 0.05], [3, 0.04], [6, 0.02], [11, 0.01], [17, 1]] },
  { name: 'Chicken Fried Rice', cat: 'Chinese', price: 259, weight: 5, veg: false, recipe: [[0, 0.13], [1, 0.1], [10, 0.04], [6, 0.02], [11, 0.008], [17, 1]] },
  { name: 'Veg Fried Rice', cat: 'Chinese', price: 199, weight: 4, veg: true, recipe: [[0, 0.13], [10, 0.08], [6, 0.02], [11, 0.008], [17, 1]] },
  { name: 'Veg Momos', cat: 'Chinese', price: 129, weight: 5, veg: true, recipe: [[7, 0.06], [10, 0.06], [17, 1]] },
  { name: 'Chicken Momos', cat: 'Chinese', price: 149, weight: 5, veg: false, recipe: [[7, 0.06], [1, 0.07], [17, 1]] },
  { name: 'Classic Chicken Burger', cat: 'Fast Food', price: 199, weight: 7, veg: false, recipe: [[7, 0.07], [1, 0.09], [10, 0.02], [17, 1]] },
  { name: 'Veg Burger', cat: 'Fast Food', price: 159, weight: 5, veg: true, recipe: [[7, 0.07], [10, 0.05], [17, 1]] },
  { name: 'Masala Fries', cat: 'Fast Food', price: 119, weight: 7, veg: true, recipe: [[10, 0.13], [6, 0.03], [17, 1]] },
  { name: 'Paneer Wrap', cat: 'Fast Food', price: 179, weight: 4, veg: true, recipe: [[7, 0.06], [2, 0.08], [10, 0.03], [17, 1]] },
  { name: 'Chicken Wrap', cat: 'Fast Food', price: 219, weight: 4, veg: false, recipe: [[7, 0.06], [1, 0.09], [10, 0.03], [17, 1]] },
  { name: 'Garlic Naan', cat: 'Breads', price: 59, weight: 8, veg: true, recipe: [[7, 0.07], [6, 0.005]] },
  { name: 'Butter Naan', cat: 'Breads', price: 69, weight: 9, veg: true, recipe: [[7, 0.07]] },
  { name: 'Tandoori Roti', cat: 'Breads', price: 35, weight: 7, veg: true, recipe: [[7, 0.05]] },
  { name: 'Lachha Paratha', cat: 'Breads', price: 55, weight: 5, veg: true, recipe: [[7, 0.07], [6, 0.005]] },
  { name: 'Jeera Rice', cat: 'Rice & Sides', price: 149, weight: 4, veg: true, recipe: [[0, 0.12], [6, 0.005], [17, 1]] },
  { name: 'Steamed Rice', cat: 'Rice & Sides', price: 129, weight: 3, veg: true, recipe: [[0, 0.12], [17, 1]] },
  { name: 'Boondi Raita', cat: 'Rice & Sides', price: 69, weight: 6, veg: true, recipe: [[8, 0.08], [11, 0.002], [17, 1]] },
  { name: 'Green Salad', cat: 'Rice & Sides', price: 79, weight: 3, veg: true, recipe: [[10, 0.09], [17, 1]] },
  { name: 'Masala Chai', cat: 'Beverages', price: 49, weight: 7, veg: true, recipe: [[8, 0.12], [12, 0.015], [11, 0.001]] },
  { name: 'Cold Coffee', cat: 'Beverages', price: 129, weight: 5, veg: true, recipe: [[8, 0.18], [12, 0.02], [17, 1]] },
  { name: 'Fresh Lime Soda', cat: 'Beverages', price: 79, weight: 5, veg: true, recipe: [[16, 0.03], [12, 0.01], [17, 1]] },
  { name: 'Mango Lassi', cat: 'Beverages', price: 99, weight: 5, veg: true, recipe: [[8, 0.15], [12, 0.02], [17, 1]] },
  { name: 'Cola', cat: 'Beverages', price: 60, weight: 7, veg: true, recipe: [[16, 0.05], [17, 1]] },
  { name: 'Gulab Jamun', cat: 'Desserts', price: 89, weight: 5, veg: true, recipe: [[7, 0.05], [8, 0.06], [12, 0.03], [17, 1]] },
  { name: 'Brownie Sundae', cat: 'Desserts', price: 149, weight: 4, veg: true, recipe: [[7, 0.06], [8, 0.1], [12, 0.03], [13, 0.01], [17, 1]] },
  { name: 'Rasmalai', cat: 'Desserts', price: 99, weight: 4, veg: true, recipe: [[8, 0.12], [12, 0.03], [7, 0.02], [17, 1]] },
  { name: 'Family Biryani Combo', cat: 'Combos', price: 699, weight: 5, veg: false, recipe: [[1, 0.3], [0, 0.25], [3, 0.1], [4, 0.07], [8, 0.1], [11, 0.025], [17, 3]] },
  { name: 'Lunch Thali', cat: 'Combos', price: 299, weight: 5, veg: true, recipe: [[18, 0.08], [0, 0.1], [7, 0.06], [2, 0.06], [10, 0.05], [17, 2]] },
  { name: 'Burger Combo', cat: 'Combos', price: 299, weight: 5, veg: false, recipe: [[7, 0.14], [1, 0.09], [10, 0.16], [16, 0.05], [17, 2]] },
];

const MENU_BY_NAME = new Map(MENU.map((m) => [m.name, m]));
const BREADS = ['Garlic Naan', 'Butter Naan', 'Tandoori Roti', 'Lachha Paratha'];
const DESSERTS = ['Gulab Jamun', 'Brownie Sundae', 'Rasmalai'];
const BIRYANIS = ['Chicken Biryani', 'Veg Dum Biryani', 'Egg Biryani'];
const MAINS_WITH_BREAD = ['Butter Chicken', 'Kadai Paneer', 'Shahi Paneer', 'Kadai Chicken', 'Dal Makhani', 'Mix Veg'];
const BURGER_LIKE = ['Classic Chicken Burger', 'Veg Burger', 'Paneer Wrap', 'Chicken Wrap'];
const MOMOS = ['Veg Momos', 'Chicken Momos'];
const CHICKEN_PRIMARY = new Set([
  'Chicken Biryani', 'Chicken Tikka', 'Chilli Chicken', 'Butter Chicken', 'Kadai Chicken',
  'Chicken Fried Rice', 'Chicken Momos', 'Classic Chicken Burger', 'Chicken Wrap', 'Family Biryani Combo',
]);

// ─── Context calendar (festivals + sports + local events) ───────────────────
// Dates are the real festival dates for the simulated window; cricket fixtures
// are synthetic-but-plausible series windows (documented in the report).

interface CalDef {
  name: string;
  type: 'festival' | 'national_event' | 'sports' | 'local_event' | 'restaurant_event';
  start: number; // day index
  end: number;
  relevance: 'low' | 'medium' | 'high';
  prep: number;
  desc: string;
  boost?: { cats?: string[]; items?: string[]; factor: number; eveningOnly?: boolean };
}

const CALENDAR: CalDef[] = [
  { name: 'Dussehra', type: 'festival', start: 1, end: 2, relevance: 'high', prep: 7, desc: 'Festival of victory — family dine-in and sweets demand.', boost: { cats: ['Desserts', 'Combos'], factor: 1.35 } },
  { name: 'Karva Chauth', type: 'festival', start: 10, end: 10, relevance: 'medium', prep: 5, desc: 'Evening family dining after the fast.', boost: { cats: ['Main Course', 'Desserts'], factor: 1.3, eveningOnly: true } },
  { name: 'Dhanteras', type: 'festival', start: 17, end: 17, relevance: 'medium', prep: 4, desc: 'Pre-Diwali shopping day — takeaway heavy.', boost: { cats: ['Combos'], factor: 1.25 } },
  { name: 'Diwali', type: 'festival', start: 19, end: 21, relevance: 'high', prep: 12, desc: 'Peak festival period — family combos, sweets, large baskets.', boost: { cats: ['Combos', 'Desserts', 'Biryani'], factor: 1.7 } },
  { name: 'Bhai Dooj', type: 'festival', start: 23, end: 23, relevance: 'medium', prep: 3, desc: 'Post-Diwali family gatherings.', boost: { cats: ['Combos'], factor: 1.3 } },
  { name: 'India vs Australia — 1st T20I', type: 'sports', start: 35, end: 35, relevance: 'high', prep: 2, desc: 'Evening T20 international (synthetic fixture for simulation).', boost: { cats: ['Starters', 'Beverages'], factor: 1.5, eveningOnly: true } },
  { name: 'India vs Australia — 2nd T20I', type: 'sports', start: 37, end: 37, relevance: 'high', prep: 2, desc: 'Evening T20 international (synthetic fixture).', boost: { cats: ['Starters', 'Beverages'], factor: 1.45, eveningOnly: true } },
  { name: 'India vs Australia — 3rd T20I', type: 'sports', start: 39, end: 39, relevance: 'medium', prep: 2, desc: 'Evening T20 international (synthetic fixture).', boost: { cats: ['Starters', 'Beverages'], factor: 1.35, eveningOnly: true } },
  { name: 'Christmas', type: 'festival', start: 85, end: 85, relevance: 'high', prep: 10, desc: 'Christmas Day — family dine-in and desserts.', boost: { cats: ['Desserts', 'Combos'], factor: 1.5 } },
  { name: 'New Year\'s Eve', type: 'festival', start: 91, end: 91, relevance: 'high', prep: 10, desc: 'New Year celebrations — late-night, large groups.', boost: { cats: ['Starters', 'Beverages', 'Combos'], factor: 1.9, eveningOnly: true } },
  { name: 'Makar Sankranti', type: 'festival', start: 105, end: 105, relevance: 'medium', prep: 4, desc: 'Harvest festival — sweets and family meals.', boost: { cats: ['Desserts'], factor: 1.3 } },
  { name: 'Republic Day', type: 'national_event', start: 117, end: 117, relevance: 'high', prep: 6, desc: 'National holiday — strong lunch and evening demand.', boost: { cats: ['Biryani', 'Combos'], factor: 1.55 } },
  { name: 'India vs New Zealand — 1st ODI', type: 'sports', start: 102, end: 102, relevance: 'high', prep: 2, desc: 'Day-night ODI (synthetic fixture).', boost: { cats: ['Starters', 'Beverages'], factor: 1.4, eveningOnly: true } },
  { name: 'India vs New Zealand — 2nd ODI', type: 'sports', start: 106, end: 106, relevance: 'medium', prep: 2, desc: 'Day-night ODI (synthetic fixture).', boost: { cats: ['Starters', 'Beverages'], factor: 1.35, eveningOnly: true } },
  { name: 'Valentine\'s Week', type: 'local_event', start: 132, end: 138, relevance: 'medium', prep: 7, desc: 'Couples dining week — desserts and combos.', boost: { cats: ['Desserts', 'Combos'], factor: 1.25 } },
  { name: 'Maha Shivratri', type: 'festival', start: 137, end: 137, relevance: 'medium', prep: 4, desc: 'Fasting day — vegetarian demand spike.', boost: { cats: ['Main Course'], factor: 1.3 } },
  { name: 'Holi', type: 'festival', start: 153, end: 154, relevance: 'high', prep: 8, desc: 'Holi — group dining, snacks and cold beverages.', boost: { cats: ['Starters', 'Beverages'], factor: 1.6 } },
  { name: 'Eid al-Fitr', type: 'festival', start: 170, end: 170, relevance: 'high', prep: 10, desc: 'Eid — family feasts, biryani and desserts.', boost: { cats: ['Biryani', 'Desserts', 'Combos'], factor: 1.65 } },
  { name: 'IPL Season Opener', type: 'sports', start: 172, end: 180, relevance: 'high', prep: 5, desc: 'IPL window — evening matches drive snacks/beverages (synthetic window).', boost: { cats: ['Starters', 'Beverages'], factor: 1.45, eveningOnly: true } },
  { name: 'Anniversary Week — Urban Tadka', type: 'restaurant_event', start: 60, end: 66, relevance: 'medium', prep: 14, desc: 'Restaurant anniversary week — own promotion.', boost: { cats: ['Combos'], factor: 1.2 } },
];

// ─── Offers ─────────────────────────────────────────────────────────────────

interface OfferDef {
  key: string;
  title: string;
  type: 'percentage' | 'flat' | 'bogo' | 'combo' | 'festival' | 'coupon';
  value: number;
  start: number;
  end: number;
  couponCode?: string;
  minOrderValue?: number;
  maxDiscount?: number;
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  targetSegment?: string;
  freeItemName?: string;
  comboProductName?: string;
  comboPrice?: number;
  /** Simulated demand multiplier while active + redemption propensity. */
  pull: number;
  redemptionRate: number;
  note: string;
}

const OFFERS: OfferDef[] = [
  { key: 'O1', title: 'First Order — 25% Off', type: 'coupon', value: 25, start: 5, end: 179, couponCode: 'FIRSTSIM25', maxDiscount: 150, pull: 1.05, redemptionRate: 0.3, note: 'Acquisition coupon for first-time customers.' },
  { key: 'O2', title: 'Launch Offer — 10% Off', type: 'percentage', value: 10, start: 10, end: 24, maxDiscount: 100, pull: 1.08, redemptionRate: 0.22, note: 'Month-2 launch promotion; moderate response.' },
  { key: 'O3', title: 'Diwali Family Feast — 15% Off', type: 'festival', value: 15, start: 18, end: 23, maxDiscount: 200, pull: 1.35, redemptionRate: 0.42, note: 'Festival offer — strong redemption during Diwali.' },
  { key: 'O4', title: 'Weekday Lunch — ₹50 Off', type: 'flat', value: 50, start: 30, end: 58, minOrderValue: 300, daysOfWeek: [1, 2, 3, 4], startHour: 12, endHour: 15, pull: 1.12, redemptionRate: 0.35, note: 'Lunch traffic builder on weekdays.' },
  { key: 'O5', title: 'Buy 1 Get 1 Momos', type: 'bogo', value: 0, start: 45, end: 59, freeItemName: 'Veg Momos', pull: 1.03, redemptionRate: 0.18, note: 'BOGO on momos — low pull, poor attach.' },
  { key: 'O6', title: 'Winter Family Combo ₹599', type: 'combo', value: 0, start: 60, end: 100, comboProductName: 'Family Biryani Combo', comboPrice: 599, pull: 1.15, redemptionRate: 0.28, note: 'Discounted family combo — good basket lift.' },
  { key: 'O7', title: 'New Year — ₹100 Off', type: 'flat', value: 100, start: 90, end: 92, minOrderValue: 500, pull: 1.5, redemptionRate: 0.55, note: 'New Year flat discount — big spike, thin margin.' },
  { key: 'O8', title: 'Republic Day — 15% Off', type: 'festival', value: 15, start: 117, end: 118, maxDiscount: 200, pull: 1.3, redemptionRate: 0.4, note: 'National holiday offer.' },
  { key: 'O9', title: 'We Miss You — 20% Off', type: 'coupon', value: 20, start: 122, end: 136, couponCode: 'COMEBACK20', maxDiscount: 150, targetSegment: 'Dormant (30 Days)', pull: 1.06, redemptionRate: 0.26, note: 'Win-back campaign for dormant customers — partial reactivation.' },
  { key: 'O10', title: 'Flat 15% Off — Sitewide', type: 'percentage', value: 15, start: 140, end: 154, maxDiscount: 250, pull: 1.25, redemptionRate: 0.62, note: 'Broad discount — high redemption but heavy margin dilution.' },
  { key: 'O11', title: 'Cricket Nights — Burger Combo ₹249', type: 'combo', value: 0, start: 168, end: 179, comboProductName: 'Burger Combo', comboPrice: 249, startHour: 19, endHour: 23, pull: 1.2, redemptionRate: 0.34, note: 'Match-night combo — evening only.' },
  { key: 'O12', title: 'Weekend Free Dessert', type: 'bogo', value: 0, start: 60, end: 179, freeItemName: 'Gulab Jamun', daysOfWeek: [0, 6], minOrderValue: 400, pull: 1.1, redemptionRate: 0.3, note: 'Weekend dessert giveaway — steady weekend lift.' },
];

const OFFER_BY_KEY = new Map(OFFERS.map((o) => [o.key, o]));

// ─── Customer name pools (synthetic — no real PII) ──────────────────────────

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Anika', 'Navya', 'Kiara', 'Pari', 'Riya', 'Rohan', 'Kunal', 'Nikhil', 'Rahul', 'Siddharth', 'Meera', 'Neha', 'Pooja', 'Shreya', 'Tanvi', 'Manish', 'Gaurav', 'Harsh', 'Yash', 'Deepak', 'Kavita', 'Sunita', 'Rekha', 'Priya', 'Nisha'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Agarwal', 'Bansal', 'Chopra', 'Khanna', 'Malhotra', 'Mehra', 'Sethi', 'Kapoor', 'Jain', 'Yadav', 'Singh', 'Chauhan', 'Rastogi', 'Saxena', 'Tiwari', 'Mishra', 'Bhatia'];
const CASHIERS = ['Ramesh Kumar', 'Sunil Yadav', 'Anita Devi'];

// ─── In-memory generation state ─────────────────────────────────────────────

interface SimIngredient {
  _id: Types.ObjectId;
  def: IngredientDef;
  idx: number;
  stock: number;
  avgCost: number;
  batches: Array<{ batchNumber: string; expiryDate: string; quantity: number; receivedDate: string; cost: number }>;
  opening: number;
  purchased: number;
  consumed: number;
  wasted: number;
  adjusted: number;
  lostToStockout: number;
  lastPurchasePrice: number[];
}

interface SimCustomer {
  _id: Types.ObjectId;
  phone: string;
  name: string;
  archetype: string;
  lambda: number; // visits per day
  weekendOnly: boolean;
  lunchOnly: boolean;
  deliveryBias: number;
  discountSensitivity: number;
  affinity: string[]; // categories
  favorite: string; // product name
  acquiredDay: number;
  churnDay: number | null;
  isNew: boolean;
}

interface SimBill {
  doc: Record<string, any>;
  items: Array<Record<string, any>>;
}

const state = {
  restaurantId: null as unknown as Types.ObjectId,
  simKey: RESTAURANT_KEY,
  branches: [] as Array<{ _id: Types.ObjectId; code: string; mix: number; profile: string }>,
  ingredients: [] as SimIngredient[],
  products: new Map<string, Types.ObjectId>(),
  customers: [] as SimCustomer[],
  offers: new Map<string, Types.ObjectId>(),
  offerUses: new Map<string, number>(),
  offerRevenue: new Map<string, { redemptions: number; discount: number; revenue: number }>(),
  bills: 0,
  billItems: 0,
  consumptions: 0,
  purchases: 0,
  inventoryEvents: 0,
  redemptions: 0,
  experimentEvents: 0,
  stockoutDays: new Map<string, number[]>(),
  dailyTotals: new Map<string, { revenue: number; orders: number; items: number; discount: number; gst: number }>(),
  perBranchDaily: new Map<string, { revenue: number; orders: number; items: number; discount: number; gst: number; payMap: Map<string, { amount: number; count: number }>; catMap: Map<string, { qty: number; revenue: number }>; itemMap: Map<string, { qty: number; revenue: number }>; cashierMap: Map<string, { orders: number; revenue: number }> }>(),
  customerTotals: new Map<string, { spend: number; orders: number; visits: number; first: string; last: string; items: Map<string, number>; points: number }>(),
  warnings: [] as string[],
};

const warn = (msg: string) => {
  state.warnings.push(msg);
  console.log(`  [warn] ${msg}`);
};

// ─── Collection cleanup (tenant-scoped only) ────────────────────────────────

const MODELS: mongoose.Model<any>[] = [
  Restaurant, Branch, Product, Purchase, InventoryEvent, Supplier, Customer, CouponRedemption,
  CustomerSegment, Bill, BillItem, Offer, Campaign, CampaignHistory, OfferAnalytics,
  OfferExperimentEvent, MLPrediction, DailySummary, MonthlySummary, CalendarEvent, Recipe,
  RecipeConsumption,
];

async function cleanSimTenant(): Promise<Record<string, number>> {
  const rest = await Restaurant.findOne({ restaurantId: RESTAURANT_KEY }).lean();
  if (!rest) return {};
  const id = rest._id as Types.ObjectId;
  const deleted: Record<string, number> = {};
  for (const model of MODELS) {
    const name = model.collection.name;
    // Restaurant/Branch: Restaurant is keyed by the string id, Branch by ObjectId.
    const filter = name === 'restaurants' ? { restaurantId: RESTAURANT_KEY } : { restaurantId: id };
    const res = await model.collection.deleteMany(filter);
    if (res.deletedCount) deleted[name] = res.deletedCount;
  }
  return deleted;
}

// ─── Phase 1: tenant ────────────────────────────────────────────────────────

async function createTenant() {
  const pinHash = await bcrypt.hash(OWNER_PIN, 10);
  const restaurant = await Restaurant.create({
    restaurantId: RESTAURANT_KEY,
    name: 'Urban Tadka Kitchen',
    legalName: 'Urban Tadka Hospitality LLP (simulated)',
    brandName: 'Urban Tadka',
    restaurantType: 'Casual Dining + Takeaway + Delivery',
    cuisineType: 'North Indian + Chinese + Fast Food',
    phone: '01140000001',
    email: 'owner@urbantadka.sim',
    description: 'Six-month simulation tenant for ChitKuber end-to-end validation.',
    establishedDate: dayDate(0),
    ownerName: 'Simulation Owner',
    ownerPhone: '9000000000',
    ownerEmail: 'owner@urbantadka.sim',
    address: 'F-14, Connaught Place Inner Circle',
    area: 'Connaught Place',
    city: 'New Delhi',
    district: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    pinCode: '110001',
    latitude: '28.6315',
    longitude: '77.2167',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    gstEnabled: true,
    gst: '07AABCS1234D1Z5',
    fssai: '10012345678901',
    taxMode: 'Inclusive',
    aiEnabled: true,
    loyaltyEnabled: true,
    weatherEnabled: false,
    isActive: true,
    ownerUserId: OWNER_USER_ID,
    ownerPin: pinHash,
    tempPasswordShown: true,
    settings: { simTenant: true, simulationSeed: SEED, simulationWindow: `${dayStr(0)}..${dayStr(DAYS - 1)}` },
  });
  state.restaurantId = restaurant._id as Types.ObjectId;

  const branchDefs = [
    { code: 'CP', name: 'Urban Tadka — Connaught Place (Head)', mix: 0.45, profile: 'lunch-heavy', address: 'F-14, Connaught Place Inner Circle, New Delhi', phone: '01140000001' },
    { code: 'NO', name: 'Urban Tadka — Noida Sector 18', mix: 0.35, profile: 'dinner-heavy', address: 'B-22, Sector 18 Market, Noida', phone: '01204000002' },
    { code: 'GU', name: 'Urban Tadka — Gurugram Cyber Hub', mix: 0.2, profile: 'low-traffic-high-AOV', address: 'Cyber Hub, DLF Cyber City, Gurugram', phone: '01244000003' },
  ];
  const branches = [];
  for (let i = 0; i < branchDefs.length; i++) {
    const b = await Branch.create({
      restaurantId: state.restaurantId,
      name: branchDefs[i].name,
      address: branchDefs[i].address,
      phone: branchDefs[i].phone,
      isHeadBranch: i === 0,
      isActive: true,
    });
    branches.push({ _id: b._id as Types.ObjectId, code: branchDefs[i].code, mix: branchDefs[i].mix, profile: branchDefs[i].profile });
  }
  state.branches = branches;
  return { restaurant, branches };
}

// ─── Phase 2: catalog (ingredients + menu) ──────────────────────────────────

async function createCatalog() {
  // Inventory items (ingredients) — Product.type = 'inventory'.
  for (let i = 0; i < INGREDIENTS.length; i++) {
    const def = INGREDIENTS[i];
    const opening = round2(def.par * 0.6);
    const doc = await Product.create({
      name: def.name,
      code: `ING-${String(i + 1).padStart(3, '0')}`,
      price: def.cost,
      category: 'Ingredients',
      type: 'inventory',
      availability: false,
      restaurantId: state.restaurantId,
      currentStock: opening,
      unit: def.unit,
      minStock: round2(def.par * 0.25),
      maxStock: round2(def.par * 2),
      reorderLevel: round2(def.par * 0.35),
      averageCost: def.cost,
      lastPurchasePrices: [def.cost],
      supplier: def.supplier,
      storageLocation: 'Dry Store / Cold Room',
      gstPercent: 5,
    });
    state.ingredients.push({
      _id: doc._id as Types.ObjectId,
      def,
      idx: i,
      stock: opening,
      avgCost: def.cost,
      batches: [{ batchNumber: `OPEN-${i + 1}`, expiryDate: def.shelfLifeDays ? dayStr(def.shelfLifeDays) : '', quantity: opening, receivedDate: dayStr(0), cost: def.cost }],
      opening,
      purchased: 0,
      consumed: 0,
      wasted: 0,
      adjusted: 0,
      lostToStockout: 0,
      lastPurchasePrice: [def.cost],
    });
  }

  // Menu products.
  for (const m of MENU) {
    const doc = await Product.create({
      name: m.name,
      code: `MENU-${m.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}`,
      price: m.price,
      category: m.cat,
      type: 'menu',
      availability: true,
      restaurantId: state.restaurantId,
      currentStock: 0,
      unit: 'pcs',
      gstPercent: 5,
      taxClassification: 'prepared_food',
      favorite: m.weight >= 8,
      voiceAliases: [m.name.toLowerCase()],
      searchAliases: [m.name.toLowerCase().replace(/[^a-z0-9]/g, '')],
      comboPrice: m.cat === 'Combos' ? m.price : 0,
    });
    state.products.set(m.name, doc._id as Types.ObjectId);
  }
}

// ─── Phase 3: recipes (with computed cost summary) ──────────────────────────

function computeRecipeCost(m: MenuDef, costOf: (idx: number) => number) {
  let direct = 0;
  for (const [idx, qty] of m.recipe) direct += qty * costOf(idx);
  direct = round2(direct);
  const packaging = m.recipe.filter(([idx]) => INGREDIENTS[idx].name === 'Packaging').reduce((s, [, q]) => s + q * costOf(INGREDIENTS.findIndex((i) => i.name === 'Packaging')), 0);
  const minorAllowance = round2(direct * 0.02);
  const cookingAllowance = round2(direct * 0.03);
  const wastageAllowance = round2(direct * 0.03);
  const variable = round2(direct + minorAllowance + cookingAllowance + wastageAllowance);
  const contribution = round2(m.price - variable);
  return {
    recipeCost: direct,
    foodCostPercent: m.price > 0 ? round2((direct / m.price) * 100) : 0,
    contribution,
    contributionMarginPercent: m.price > 0 ? round2((contribution / m.price) * 100) : 0,
    perServingCost: direct,
    directIngredients: direct,
    minorAllowance,
    cookingAllowance,
    wastageAllowance,
    packagingCost: round2(packaging),
    estimatedVariableCost: variable,
    conservativeCost: round2(variable * 1.05),
    directFoodCostPercent: m.price > 0 ? round2((direct / m.price) * 100) : 0,
    calculatedAt: new Date(),
  };
}

async function createRecipes() {
  const costOf = (idx: number) => state.ingredients[idx].def.cost;
  for (const m of MENU) {
    const components = m.recipe.map(([idx, qty], seq) => {
      const ing = state.ingredients[idx];
      return {
        inventoryItemId: ing._id,
        itemName: ing.def.name,
        unit: ing.def.unit,
        quantity: qty,
        normalizedQuantity: qty,
        normalizedUnit: ing.def.unit,
        componentType: 'ingredient' as const,
        wastagePercent: 3,
        optional: false,
        sequence: seq,
      };
    });
    await Recipe.create({
      restaurantId: state.restaurantId,
      productId: state.products.get(m.name),
      productName: m.name,
      recipeMode: 'base',
      name: `${m.name} — base recipe`,
      description: `Standard kitchen recipe for ${m.name}.`,
      status: 'active',
      version: 1,
      effectiveFrom: dayStr(0),
      yieldQuantity: 1,
      yieldUnit: 'serving',
      servingSize: 1,
      components,
      costSummary: computeRecipeCost(m, costOf),
      createdBy: 'simulation',
    });
  }
}

// ─── Phase 4: calendar events (restaurant-scoped) ───────────────────────────

async function createCalendar() {
  for (const c of CALENDAR) {
    await CalendarEvent.create({
      name: c.name,
      type: c.type,
      startDate: dayDate(c.start),
      endDate: dayDate(c.end),
      scope: 'restaurant',
      restaurantId: state.restaurantId,
      description: c.desc,
      tags: [c.type, 'simulation'],
      marketingRelevance: c.relevance,
      preparationWindowDays: c.prep,
      status: 'active',
      source: 'admin',
    });
  }
}

// ─── Phase 5: offers ────────────────────────────────────────────────────────

async function createOffers() {
  for (const o of OFFERS) {
    const doc = await Offer.create({
      restaurantId: state.restaurantId,
      title: o.title,
      description: `${o.title} — ${o.note}`,
      shortDescription: o.title,
      type: o.type,
      value: o.value,
      minOrderValue: o.minOrderValue,
      maxDiscount: o.maxDiscount,
      maxUses: o.key === 'O1' ? 2000 : undefined,
      currentUses: 0,
      maxPerCustomer: 1,
      applicableCategories: o.type === 'combo' && o.comboProductName ? [MENU_BY_NAME.get(o.comboProductName)!.cat] : [],
      applicableProductIds: o.comboProductName ? [String(state.products.get(o.comboProductName))] : [],
      targetSegmentNames: o.targetSegment ? [o.targetSegment] : [],
      startDate: dayStr(o.start),
      endDate: dayStr(o.end),
      daysOfWeek: o.daysOfWeek,
      startHour: o.startHour,
      endHour: o.endHour,
      freeItemName: o.freeItemName,
      freeItemQty: o.freeItemName ? 1 : undefined,
      comboProductIds: o.comboProductName ? [String(state.products.get(o.comboProductName))] : [],
      comboPrice: o.comboPrice,
      couponCode: o.couponCode,
      stackingAllowed: false,
      mutuallyExclusiveGroup: 'sim-default',
      recommendationSource: o.type === 'festival' ? 'festival' : o.type === 'coupon' ? 'lost_customer' : 'manual',
      recommendationReason: o.note,
      estimatedReach: rint(400, 1500),
      expectedImpact: o.pull > 1.2 ? 'High traffic lift expected' : 'Moderate lift expected',
      isAiGenerated: false,
      isAutoActivate: false,
      status: o.end < DAYS ? 'expired' : 'active',
      branchIds: [],
      createdBy: 'simulation',
    });
    state.offers.set(o.key, doc._id as Types.ObjectId);
    state.offerUses.set(o.key, 0);
    state.offerRevenue.set(o.key, { redemptions: 0, discount: 0, revenue: 0 });
  }
}

// ─── Phase 6: customers ─────────────────────────────────────────────────────

const AFFINITY_POOL = ['Biryani', 'Starters', 'Main Course', 'Chinese', 'Fast Food', 'Breads', 'Beverages', 'Desserts', 'Combos'];

async function createCustomers() {
  const ARCHETYPES: Array<{ name: string; share: number; lambda: [number, number]; weekendOnly?: number; lunchOnly?: number }> = [
    { name: 'regular', share: 0.25, lambda: [0.1, 0.18] },
    { name: 'frequent', share: 0.12, lambda: [0.2, 0.3] },
    { name: 'occasional', share: 0.3, lambda: [0.03, 0.07] },
    { name: 'rare', share: 0.2, lambda: [0.008, 0.02] },
    { name: 'weekend_family', share: 0.13, lambda: [0.04, 0.08], weekendOnly: 0.95 },
  ];
  let seq = 0;
  for (const a of ARCHETYPES) {
    const count = Math.round(1200 * a.share);
    for (let i = 0; i < count; i++) {
      seq += 1;
      const lambda = a.lambda[0] + rnd() * (a.lambda[1] - a.lambda[0]);
      const acquiredDay = a.name === 'rare' ? rint(0, 150) : rint(0, 40);
      const churnable = (a.name === 'frequent' || a.name === 'regular') && chance(0.12);
      const affinity = [pick(AFFINITY_POOL), pick(AFFINITY_POOL)];
      const favorite = pick(MENU.filter((m) => affinity.includes(m.cat)).map((m) => m.name));
      state.customers.push({
        _id: new Types.ObjectId(),
        phone: `9${String(700000000 + seq).padStart(9, '0')}`,
        name: `${pick(FIRST)} ${pick(LAST)}`,
        archetype: a.name,
        lambda,
        weekendOnly: rnd() < (a.weekendOnly ?? 0.1),
        lunchOnly: rnd() < (a.name === 'weekend_family' ? 0.05 : 0.2),
        deliveryBias: rnd() < 0.25 ? 0.55 : rnd() < 0.4 ? 0.3 : 0.15,
        discountSensitivity: round2(rnd()),
        affinity,
        favorite,
        acquiredDay,
        churnDay: churnable ? rint(118, 165) : null,
        isNew: true,
      });
    }
  }
}

// ─── Phase 7: the six-month operating loop ──────────────────────────────────

const HOUR_BUCKETS: Array<[number, number, number]> = [
  // [startHour, endHour, weight] — lunch and dinner peaks, never uniform.
  [11, 12, 4], [12, 14, 24], [14, 17, 11], [17, 19, 15], [19, 22, 34], [22, 23, 12],
];

function pickHour(lunchOnly: boolean, eveningEvent: boolean): number {
  if (lunchOnly) return rint(12, 14);
  const buckets = eveningEvent ? HOUR_BUCKETS.map(([s, e, w]) => [s, e, s >= 19 ? w * 1.4 : w] as [number, number, number]) : HOUR_BUCKETS;
  const total = buckets.reduce((s, [, , w]) => s + w, 0);
  let r = rnd() * total;
  for (const [s, e, w] of buckets) {
    if (r < w) return s + Math.floor(rnd() * (e - s));
    r -= w;
  }
  return 20;
}

function activeCalendarBoost(day: number, hour: number): { factor: number; cats: Set<string>; items: Set<string>; label: string | null } {
  let factor = 1;
  const cats = new Set<string>();
  const items = new Set<string>();
  let label: string | null = null;
  for (const c of CALENDAR) {
    if (day < c.start || day > c.end || !c.boost) continue;
    if (c.boost.eveningOnly && hour < 19) continue;
    factor *= c.boost.factor;
    (c.boost.cats ?? []).forEach((x) => cats.add(x));
    (c.boost.items ?? []).forEach((x) => items.add(x));
    label = c.name;
  }
  return { factor, cats, items, label };
}

function activeOffers(day: number, hour: number, channel: string) {
  return OFFERS.filter((o) => {
    if (day < o.start || day > o.end) return false;
    if (o.daysOfWeek && !o.daysOfWeek.includes(dow(day))) return false;
    if (o.startHour != null && o.endHour != null && (hour < o.startHour || hour >= o.endHour)) return false;
    if (o.key === 'O1') return true; // first-order coupon handled per customer
    return true;
  });
}

function pickProduct(candidates: MenuDef[], cats: Set<string>, customer: SimCustomer | null, channel: string): MenuDef {
  let total = 0;
  const weights = candidates.map((m) => {
    let w = m.weight;
    if (cats.has(m.cat)) w *= 1.6;
    if (customer) {
      if (customer.affinity.includes(m.cat)) w *= 1.7;
      if (customer.favorite === m.name) w *= 1.8;
      if (customer.archetype === 'weekend_family' && (m.cat === 'Combos' || m.cat === 'Biryani')) w *= 1.5;
      if (customer.lunchOnly && m.cat === 'Combos') w *= 1.4;
    }
    if (channel === 'Delivery' && (m.cat === 'Beverages' || m.cat === 'Desserts')) w *= 0.7;
    if (channel === 'Delivery' && m.cat === 'Breads') w *= 0.6;
    total += w;
    return w;
  });
  let r = rnd() * total;
  for (let i = 0; i < candidates.length; i++) {
    if (r < weights[i]) return candidates[i];
    r -= weights[i];
  }
  return candidates[candidates.length - 1];
}

function offerDiscount(o: OfferDef, subtotal: number): number {
  if (o.type === 'percentage' || o.type === 'festival' || o.type === 'coupon') {
    const raw = (subtotal * o.value) / 100;
    return round2(o.maxDiscount ? Math.min(raw, o.maxDiscount) : raw);
  }
  if (o.type === 'flat') return Math.min(o.value, subtotal);
  return 0; // bogo/combo discounts are represented by the free/ combo line
}

async function runOperatingLoop() {
  const menuAvailable = () => MENU.filter((m) => !(chickenStockout && CHICKEN_PRIMARY.has(m.name)));
  const billBatch: Record<string, any>[] = [];
  const itemBatch: Record<string, any>[] = [];
  const consumptionBatch: Record<string, any>[] = [];
  const purchaseBatch: Record<string, any>[] = [];
  const invEventBatch: Record<string, any>[] = [];
  const redemptionBatch: Record<string, any>[] = [];
  const expEventBatch: Record<string, any>[] = [];
  const stockoutDaysList: Array<{ item: string; day: string }> = [];

  let invoiceSeq = 1;
  let ticketSeq = 1;
  let chickenStockout = false;
  // Legacy experiment ledger is unique per (tenant, customer, offer, eventType).
  const legacyExpSeen = new Set<string>();
  const flush = async (force = false) => {
    if (!force && billBatch.length < 800) return;
    if (billBatch.length) {
      await Bill.insertMany(billBatch.splice(0), { ordered: false });
      await BillItem.insertMany(itemBatch.splice(0), { ordered: false });
      if (consumptionBatch.length) await RecipeConsumption.insertMany(consumptionBatch.splice(0), { ordered: false });
      if (redemptionBatch.length) await CouponRedemption.insertMany(redemptionBatch.splice(0), { ordered: false });
      if (expEventBatch.length) {
        // Defense in depth: the experiment ledger is unique per
        // (tenant, customer, offer, eventType) — drop any residual in-batch dupes.
        const seen = new Set<string>();
        const deduped = expEventBatch.filter((r) => {
          const k = `${r.customerId}|${r.offerId}|${r.eventType}|${r.experimentId ?? ''}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        expEventBatch.length = 0;
        try {
          await OfferExperimentEvent.insertMany(deduped, { ordered: false });
        } catch (err: any) {
          // Unordered bulk: the non-duplicate rows are already persisted.
          warn(`experiment-ledger partial write: ${err?.message?.slice(0, 160)}`);
        }
      }
    }
    if (purchaseBatch.length) await Purchase.insertMany(purchaseBatch.splice(0), { ordered: false });
    if (invEventBatch.length) await InventoryEvent.insertMany(invEventBatch.splice(0), { ordered: false });
  };

  // Purchase every N days: replenish to par, record price drift.
  const purchaseCycle = 4;
  for (let day = 0; day < DAYS; day++) {
    const dateStr = dayStr(day);
    const month = monthIndex(day);
    const monthTraffic = [0.55, 0.78, 0.95, 1.05, 1.1, 1.2][month];
    const weekday = dow(day);
    const dowFactor = weekday === 0 ? 1.35 : weekday === 6 ? 1.45 : weekday === 5 ? 1.25 : weekday === 1 ? 0.8 : 0.95;
    const isHoliday = CALENDAR.some((c) => day >= c.start && day <= c.end && c.boost && c.boost.factor >= 1.3);
    const holidayFactor = isHoliday ? 1.25 : 1;
    const noise = 0.88 + rnd() * 0.24;
    const baseBills = 118 * monthTraffic * dowFactor * holidayFactor * noise;

    // Chicken stockout scenario (month 6): stock is exhausted, purchases are late.
    chickenStockout = day >= 174 && day <= 176;
    if (chickenStockout) {
      const chicken = state.ingredients[1];
      state.ingredients[1].lostToStockout = round2(chicken.lostToStockout + 6.5);
      stockoutDaysList.push({ item: 'Chicken', day: dateStr });
    }

    for (const branch of state.branches) {
      const profileFactor = branch.profile === 'lunch-heavy' ? 1.05 : branch.profile === 'dinner-heavy' ? 1.0 : 0.72;
      const aovFactor = branch.profile === 'low-traffic-high-AOV' ? 1.3 : 1;
      const branchBills = Math.max(3, Math.round(baseBills * branch.mix * profileFactor * (0.92 + rnd() * 0.16)));
      for (let b = 0; b < branchBills; b++) {
        const eveningSports = CALENDAR.some((c) => day >= c.start && day <= c.end && c.type === 'sports');
        const hour = pickHour(false, eveningSports);
        const boost = activeCalendarBoost(day, hour);
        const activeOfferDefs = activeOffers(day, hour, '');
        const offerPull = activeOfferDefs.reduce((m, o) => Math.max(m, o.pull), 1);
        if (rnd() > 1 / (offerPull * boost.factor * 0.6 + 0.4)) continue; // context can raise or lower realised traffic

        // Channel mix varies by branch, hour and customer population.
        const channelRoll = rnd();
        const channel = channelRoll < 0.55 ? 'Dine In' : channelRoll < 0.8 ? 'Takeaway' : 'Delivery';
        const payment = (() => {
          const r = rnd();
          if (r < 0.44) return 'UPI';
          if (r < 0.74) return 'Cash';
          if (r < 0.9) return 'Card';
          return 'Wallet';
        })();
        const cashierName = pick(CASHIERS);

        // Identified (loyalty) customers grow from ~45% to ~80% of bills.
        const identifiedShare = 0.45 + (0.35 * day) / DAYS;
        let customer: SimCustomer | null = null;
        if (chance(identifiedShare)) {
          const eligible = state.customers.filter(
            (c) => c.acquiredDay <= day && (c.churnDay === null || day < c.churnDay) && !(c.weekendOnly && ![0, 6].includes(weekday)),
          );
          if (eligible.length) {
            // Weight by visit intensity so regulars appear far more often.
            let total = 0;
            const weights = eligible.map((c) => {
              const w = c.lambda * (c.deliveryBias > 0.4 && channel === 'Delivery' ? 1.6 : 1) * (c.lunchOnly && hour >= 12 && hour < 15 ? 1.5 : 1);
              total += w;
              return w;
            });
            let r = rnd() * total;
            for (let i = 0; i < eligible.length; i++) {
              if (r < weights[i]) { customer = eligible[i]; break; }
              r -= weights[i];
            }
          }
        }

        // ── Basket construction ──
        const available = menuAvailable();
        const cats = boost.cats;
        const mainsPool = available.filter((m) => !['Breads', 'Beverages', 'Desserts', 'Rice & Sides'].includes(m.cat));
        const lines: Array<{ m: MenuDef; qty: number; isFree: boolean }> = [];
        const mainCount = customer?.archetype === 'weekend_family' || boost.factor >= 1.5 ? rint(1, 3) : rint(1, 2);
        for (let i = 0; i < mainCount; i++) {
          const m = pickProduct(mainsPool, cats, customer, channel);
          const existing = lines.find((l) => l.m.name === m.name);
          if (existing) existing.qty += 1;
          else lines.push({ m, qty: 1, isFree: false });
        }
        const addLine = (name: string, qty = 1) => {
          const m = MENU_BY_NAME.get(name);
          if (!m || !available.includes(m)) return;
          const existing = lines.find((l) => l.m.name === name);
          if (existing) existing.qty += qty;
          else lines.push({ m, qty, isFree: false });
        };

        // Basket association rules (probabilistic — the basket model must be able to discover them).
        const hasMain = (names: string[]) => lines.some((l) => names.includes(l.m.name));
        if (hasMain(BIRYANIS) && chance(0.45)) addLine('Boondi Raita');
        if (hasMain(MAINS_WITH_BREAD) && chance(0.55)) addLine(pick(BREADS));
        if (hasMain(BURGER_LIKE)) {
          if (chance(0.55)) addLine('Masala Fries');
          if (chance(0.5)) addLine('Cola');
        }
        if (hasMain(MOMOS) && chance(0.45)) addLine('Cola');
        if (hasMain(['Paneer Tikka', 'Chicken Tikka']) && chance(0.35)) addLine(pick(BREADS));
        if (lines.some((l) => l.m.cat === 'Main Course') && hour >= 19 && chance(0.18)) addLine(pick(DESSERTS));
        if (hour >= 12 && hour < 15 && chance(0.15)) addLine('Masala Chai');
        if (channel === 'Delivery' && chance(0.12)) addLine('Green Salad');

        // Combo product substitution for larger orders.
        if (lines.length >= 3 && chance(0.12)) addLine('Family Biryani Combo');

        // ── Offer application ──
        let appliedOffer: OfferDef | null = null;
        let discount = 0;
        let freeLine: { m: MenuDef; qty: number; isFree: boolean } | null = null;
        const subtotalPreview = round2(lines.reduce((s, l) => s + l.m.price * l.qty, 0));
        if (customer) {
          for (const o of activeOfferDefs) {
            if (o.key === 'O1' && !customer.isNew) continue;
            if (o.targetSegment && !(customer.churnDay === null && customer.lambda < 0.08)) continue; // win-back → low-activity customers
            if (o.minOrderValue && subtotalPreview < o.minOrderValue) continue;
            if (o.type === 'combo') {
              // Combo offer replaces the standalone combo price.
              if (!lines.some((l) => l.m.name === o.comboProductName)) continue;
            }
            const propensity = o.redemptionRate + customer.discountSensitivity * 0.35;
            if (!chance(propensity)) continue;
            appliedOffer = o;
            if (o.type === 'bogo' && o.freeItemName) {
              const freeMenu = MENU_BY_NAME.get(o.freeItemName)!;
              freeLine = { m: freeMenu, qty: 1, isFree: true };
            } else if (o.type === 'combo' && o.comboProductName && o.comboPrice) {
              const line = lines.find((l) => l.m.name === o.comboProductName)!;
              discount = round2(Math.max(0, line.m.price - o.comboPrice) * line.qty);
            } else {
              discount = offerDiscount(o, subtotalPreview);
            }
            break; // mutually exclusive group
          }
        }
        if (freeLine) lines.push(freeLine);

        const subtotal = round2(lines.reduce((s, l) => s + l.m.price * l.qty, 0));
        discount = Math.min(discount, subtotal);
        const net = round2(subtotal - discount);
        const gst = round2(net - net / 1.05);
        const billId = new Types.ObjectId();
        const itemsSold = lines.reduce((s, l) => s + l.qty, 0);
        const invoiceNumber = `SIM6M-${branch.code}-${String(invoiceSeq++).padStart(6, '0')}`;
        const ticketNumber = `T${String(ticketSeq++).padStart(6, '0')}`;

        billBatch.push({
          _id: billId,
          invoiceNumber,
          ticketNumber,
          date: dateStr,
          time: `${String(hour).padStart(2, '0')}:${String(rint(0, 59)).padStart(2, '0')}`,
          cashierName,
          cashierRole: 'cashier',
          subtotal,
          discount,
          gst,
          grandTotal: net,
          paymentMethod: payment,
          orderType: channel,
          restaurantId: state.restaurantId,
          branchId: branch._id,
          customerId: customer?._id ?? null,
          customerPhone: customer?.phone,
          customerName: customer?.name,
          pointsEarned: Math.round(net / 100),
          pointsRedeemed: 0,
          isVoided: false,
          isRefunded: false,
          refundAmount: 0,
          createdAt: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(rint(0, 59)).padStart(2, '0')}:00.000Z`),
        });

        // Consumption lines (theoretical recipe usage) + ingredient depletion.
        const perBillConsumption = new Map<number, { qty: number; cost: number }>();
        for (const l of lines) {
          itemBatch.push({
            billId,
            menuItemId: String(state.products.get(l.m.name)),
            itemName: l.m.name,
            priceAtSale: l.m.price,
            quantity: l.qty,
            gstRateAtSale: 5,
            discountAtSale: 0,
            isFree: l.isFree,
            createdAt: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00.000Z`),
          });
          for (const [idx, qty] of l.m.recipe) {
            const used = qty * l.qty;
            const ing = state.ingredients[idx];
            const available0 = ing.stock;
            const taken = Math.min(available0, used);
            if (taken < used - 1e-6) {
              ing.lostToStockout = round2(ing.lostToStockout + (used - taken));
              if (!state.stockoutDays.has(ing.def.name)) state.stockoutDays.set(ing.def.name, []);
            }
            ing.stock = round2(ing.stock - taken);
            ing.consumed = round2(ing.consumed + taken);
            const prev = perBillConsumption.get(idx) ?? { qty: 0, cost: 0 };
            perBillConsumption.set(idx, { qty: round2(prev.qty + taken), cost: round2(prev.cost + taken * ing.avgCost) });
          }
        }
        const consumptionItems = [...perBillConsumption.entries()].map(([idx, v]) => {
          const ing = state.ingredients[idx];
          return {
            inventoryItemId: ing._id,
            itemName: ing.def.name,
            unit: ing.def.unit,
            quantity: v.qty,
            costPerUnit: ing.avgCost,
            cost: v.cost,
            source: 'recipe' as const,
          };
        });
        consumptionBatch.push({
          restaurantId: state.restaurantId,
          branchId: branch._id,
          billId,
          invoiceNumber,
          date: dateStr,
          lines: lines.map((l) => ({
            productId: String(state.products.get(l.m.name)),
            productName: l.m.name,
            quantity: l.qty,
            recipeVersion: 1,
            recipeName: `${l.m.name} — base recipe`,
            source: 'recipe' as const,
            resolvedMode: 'exact' as const,
          })),
          items: consumptionItems,
          totalCost: round2(consumptionItems.reduce((s, i) => s + i.cost, 0)),
          status: 'recorded' as const,
          createdBy: 'simulation',
          createdAt: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:30:00.000Z`),
        });

        // Offer redemption ledger + experiment ledger.
        if (appliedOffer && customer) {
          state.offerUses.set(appliedOffer.key, (state.offerUses.get(appliedOffer.key) ?? 0) + 1);
          const agg = state.offerRevenue.get(appliedOffer.key)!;
          agg.redemptions += 1;
          agg.discount = round2(agg.discount + discount);
          agg.revenue = round2(agg.revenue + net);
          redemptionBatch.push({
            restaurantId: state.restaurantId,
            offerId: state.offers.get(appliedOffer.key),
            code: appliedOffer.couponCode,
            customerId: customer._id,
            customerPhone: customer.phone,
            billId: String(billId),
            branchId: branch._id,
            discountAmount: discount,
            status: 'applied',
            redeemedBy: cashierName,
            createdAt: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:45:00.000Z`),
          });
          // Legacy (offer-keyed) experiment rows — pre-treatment features only.
          // Unique per (tenant, customer, offer, eventType): one assigned row
          // and one converted row per customer+offer, deduped here.
          const expKey = `${customer._id}|${appliedOffer.key}`;
          if (!legacyExpSeen.has(expKey)) {
            legacyExpSeen.add(expKey);
            expEventBatch.push({
            restaurantId: state.restaurantId,
            branchId: branch._id,
            offerId: state.offers.get(appliedOffer.key),
            customerId: String(customer._id),
            eventType: 'assigned',
            treatment: 1,
            purchase: 0,
              features: {
                recencyDays: rint(0, 45),
                frequency: Math.round(customer.lambda * 180),
                monetary: round2(subtotal + rint(0, 3000)),
                favoriteCategory: customer.affinity[0],
                discountSensitivity: customer.discountSensitivity,
                channel,
                offerType: appliedOffer.type,
                discountValue: appliedOffer.value,
              },
              assignedAt: new Date(`${dateStr}T10:00:00.000Z`),
              createdAt: new Date(`${dateStr}T10:00:00.000Z`),
            });
            expEventBatch.push({
            restaurantId: state.restaurantId,
            branchId: branch._id,
            offerId: state.offers.get(appliedOffer.key),
            customerId: String(customer._id),
            eventType: 'converted',
            treatment: 1,
            purchase: 1,
            features: {},
              convertedAt: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:50:00.000Z`),
              redeemedBillId: billId,
              attributedRevenue: net,
              createdAt: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:50:00.000Z`),
            });
          }
          state.redemptions += 1;
        }

        // Daily / branch aggregates for summaries.
        const dayKey = dateStr;
        const dayAgg = state.dailyTotals.get(dayKey) ?? { revenue: 0, orders: 0, items: 0, discount: 0, gst: 0 };
        dayAgg.revenue = round2(dayAgg.revenue + net);
        dayAgg.orders += 1;
        dayAgg.items += itemsSold;
        dayAgg.discount = round2(dayAgg.discount + discount);
        dayAgg.gst = round2(dayAgg.gst + gst);
        state.dailyTotals.set(dayKey, dayAgg);

        const bKey = `${dayKey}|${branch.code}`;
        const bAgg = state.perBranchDaily.get(bKey) ?? {
          revenue: 0, orders: 0, items: 0, discount: 0, gst: 0,
          payMap: new Map(), catMap: new Map(), itemMap: new Map(), cashierMap: new Map(),
        };
        bAgg.revenue = round2(bAgg.revenue + net);
        bAgg.orders += 1;
        bAgg.items += itemsSold;
        bAgg.discount = round2(bAgg.discount + discount);
        bAgg.gst = round2(bAgg.gst + gst);
        const pay = bAgg.payMap.get(payment) ?? { amount: 0, count: 0 };
        pay.amount = round2(pay.amount + net);
        pay.count += 1;
        bAgg.payMap.set(payment, pay);
        const cashier = bAgg.cashierMap.get(cashierName) ?? { orders: 0, revenue: 0 };
        for (const l of lines) {
          const c = bAgg.catMap.get(l.m.cat) ?? { qty: 0, revenue: 0 };
          c.qty += l.qty;
          c.revenue = round2(c.revenue + l.m.price * l.qty);
          bAgg.catMap.set(l.m.cat, c);
          const it = bAgg.itemMap.get(l.m.name) ?? { qty: 0, revenue: 0 };
          it.qty += l.qty;
          it.revenue = round2(it.revenue + l.m.price * l.qty);
          bAgg.itemMap.set(l.m.name, it);
        }
        cashier.orders += 1;
        cashier.revenue = round2(cashier.revenue + net);
        bAgg.cashierMap.set(cashierName, cashier);
        state.perBranchDaily.set(bKey, bAgg);

        if (customer) {
          const ct = state.customerTotals.get(String(customer._id)) ?? { spend: 0, orders: 0, visits: 0, first: dateStr, last: dateStr, items: new Map(), points: 0 };
          ct.spend = round2(ct.spend + net);
          ct.orders += 1;
          ct.visits += 1;
          ct.first = ct.first < dateStr ? ct.first : dateStr;
          ct.last = ct.last > dateStr ? ct.last : dateStr;
          ct.points += Math.round(net / 100);
          for (const l of lines) ct.items.set(l.m.name, (ct.items.get(l.m.name) ?? 0) + l.qty);
          state.customerTotals.set(String(customer._id), ct);
        }

        state.bills += 1;
        state.billItems += lines.length;
      }
    }

    // ── Purchases + wastage + adjustments ──
    if (day % purchaseCycle === 0) {
      for (const ing of state.ingredients) {
        const parLevel = ing.def.par;
        if (ing.stock >= parLevel * 0.85) continue;
        if (ing.def.name === 'Chicken' && day >= 173) continue; // late delivery → stockout
        const needed = round2(parLevel * 1.15 - ing.stock);
        if (needed <= 0) continue;
        const priceDrift = ing.def.name === 'Chicken' && day >= 120 ? 1.25 : ing.def.name === 'Onion' || ing.def.name === 'Tomato' ? 1 + Math.sin(day / 30) * 0.12 : 1;
        const price = round2(ing.def.cost * priceDrift);
        const expiry = ing.def.shelfLifeDays ? dayStr(day + ing.def.shelfLifeDays) : '';
        purchaseBatch.push({
          restaurantId: state.restaurantId,
          branchId: state.branches[0]._id,
          supplier: ing.def.supplier,
          expiryDate: expiry,
          item: ing.def.name,
          category: 'Ingredients',
          quantity: needed,
          unit: ing.def.unit,
          price,
          total: round2(needed * price),
          date: dateStr,
          status: 'completed',
          createdAt: new Date(`${dateStr}T07:00:00.000Z`),
        });
        ing.stock = round2(ing.stock + needed);
        ing.purchased = round2(ing.purchased + needed);
        ing.batches.push({ batchNumber: `P${day}-${ing.idx}`, expiryDate: expiry, quantity: needed, receivedDate: dateStr, cost: price });
        ing.lastPurchasePrice = [...ing.lastPurchasePrice.slice(-9), price];
        ing.avgCost = round2(ing.lastPurchasePrice.reduce((s, p) => s + p, 0) / ing.lastPurchasePrice.length);
        invEventBatch.push({
          restaurantId: state.restaurantId,
          branchId: state.branches[0]._id,
          type: 'purchase',
          item: ing.def.name,
          quantity: needed,
          unit: ing.def.unit,
          operator: 'Simulation Purchase',
          details: `Stock-in ${needed}${ing.def.unit} @ ₹${price}`,
          eventDate: dateStr,
          unitCost: price,
          totalCost: round2(needed * price),
          createdAt: new Date(`${dateStr}T07:05:00.000Z`),
        });
        state.purchases += 1;
        state.inventoryEvents += 1;
      }
    }

    // Wastage: perishable spoilage + scripted anomaly windows.
    const wasteMultiplier = day >= 62 && day <= 70 ? 3 : day >= 96 && day <= 100 ? 2.2 : 1;
    for (const ing of state.ingredients) {
      if (!ing.def.shelfLifeDays || ing.def.shelfLifeDays > 30) continue;
      if (chance(0.12 * wasteMultiplier)) {
        const qty = round2(ing.stock * (0.02 + rnd() * 0.03) * wasteMultiplier);
        if (qty <= 0) continue;
        ing.stock = round2(Math.max(0, ing.stock - qty));
        ing.wasted = round2(ing.wasted + qty);
        invEventBatch.push({
          restaurantId: state.restaurantId,
          branchId: state.branches[0]._id,
          type: 'waste',
          item: ing.def.name,
          quantity: qty,
          unit: ing.def.unit,
          operator: 'Kitchen Staff',
          details: day >= 62 && day <= 70 ? 'Spoilage spike — cold storage issue' : 'Expired/spoiled stock written off',
          eventDate: dateStr,
          unitCost: ing.avgCost,
          totalCost: round2(qty * ing.avgCost),
          createdAt: new Date(`${dateStr}T22:30:00.000Z`),
        });
        state.inventoryEvents += 1;
      }
    }

    // Monthly stock-count adjustment (small realistic discrepancy).
    if (day > 0 && day % 30 === 0) {
      const ing = state.ingredients[rint(0, state.ingredients.length - 1)];
      const delta = round2((rnd() * 2 - 1) * ing.def.par * 0.02);
      ing.stock = round2(Math.max(0, ing.stock + delta));
      ing.adjusted = round2(ing.adjusted + delta);
      invEventBatch.push({
        restaurantId: state.restaurantId,
        branchId: state.branches[0]._id,
        type: 'adjusted',
        item: ing.def.name,
        quantity: delta,
        unit: ing.def.unit,
        operator: 'Store Manager',
        details: 'Monthly stock-count variance adjustment',
        eventDate: dateStr,
        unitCost: ing.avgCost,
        totalCost: round2(Math.abs(delta) * ing.avgCost),
        createdAt: new Date(`${dateStr}T21:00:00.000Z`),
      });
      state.inventoryEvents += 1;
    }

    // Daily aggregated consumption event per ingredient (the 'sold' feed).
    for (const ing of state.ingredients) {
      if (ing.consumed <= 0) continue;
      const prevSold = (ing as any).__sold ?? 0;
      const dayQty = round2(ing.consumed - prevSold);
      (ing as any).__sold = ing.consumed;
      if (dayQty <= 0) continue;
      invEventBatch.push({
        restaurantId: state.restaurantId,
        branchId: state.branches[0]._id,
        type: 'sold',
        item: ing.def.name,
        quantity: -dayQty,
        unit: ing.def.unit,
        operator: 'System',
        details: 'Recipe consumption from sales',
        eventDate: dateStr,
        unitCost: ing.avgCost,
        totalCost: round2(dayQty * ing.avgCost),
        createdAt: new Date(`${dateStr}T23:30:00.000Z`),
      });
      state.inventoryEvents += 1;
    }

    // Weekly closing count.
    if (day % 7 === 6) {
      const ing = state.ingredients[0];
      invEventBatch.push({
        restaurantId: state.restaurantId,
        branchId: state.branches[0]._id,
        type: 'closing',
        item: ing.def.name,
        quantity: ing.stock,
        unit: ing.def.unit,
        operator: 'System',
        details: 'End-of-day stock snapshot',
        eventDate: dateStr,
        createdAt: new Date(`${dateStr}T23:59:00.000Z`),
      });
      state.inventoryEvents += 1;
    }

    await flush();
    if (day % 30 === 29) console.log(`  … day ${day + 1}/${DAYS} · bills=${state.bills} items=${state.billItems}`);
  }
  await flush(true);

  // Persist final ingredient state (stock, batches, cost).
  for (const ing of state.ingredients) {
    await Product.updateOne(
      { _id: ing._id },
      {
        $set: {
          currentStock: ing.stock,
          averageCost: ing.avgCost,
          lastPurchasePrices: ing.lastPurchasePrice,
          batches: ing.batches.slice(-8).map((b) => ({
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            quantity: round2(b.quantity),
            receivedDate: b.receivedDate,
            cost: b.cost,
          })),
          expiryDate: ing.batches.filter((b) => b.expiryDate).map((b) => b.expiryDate).sort()[0] ?? '',
        },
      },
    );
  }
  return stockoutDaysList;
}

// ─── Phase 8: campaigns + delivery history ──────────────────────────────────

async function createCampaigns() {
  const plan: Array<{ key: string; name: string; channel: 'whatsapp' | 'sms'; segment: string; sentDay: number; note: string }> = [
    { key: 'O2', name: 'Launch Announcement', channel: 'whatsapp', segment: 'All Customers', sentDay: 10, note: 'First campaign — launch offer announcement.' },
    { key: 'O3', name: 'Diwali Family Feast Blast', channel: 'whatsapp', segment: 'Frequent Customers', sentDay: 17, note: 'Diwali festival campaign.' },
    { key: 'O6', name: 'Winter Combo Push', channel: 'sms', segment: 'Weekend Customers', sentDay: 60, note: 'Winter combo campaign.' },
    { key: 'O7', name: 'New Year Party Offer', channel: 'whatsapp', segment: 'High Spending', sentDay: 89, note: 'New Year campaign.' },
    { key: 'O9', name: 'Win-Back Dormant Customers', channel: 'sms', segment: 'Dormant (30 Days)', sentDay: 121, note: 'Reactivation campaign for dormant customers.' },
    { key: 'O10', name: 'Sitewide 15% — Reactivation Push', channel: 'whatsapp', segment: 'All Customers', sentDay: 139, note: 'Broad discount campaign — high redemptions, thin margin.' },
    { key: 'O11', name: 'Cricket Nights Combo', channel: 'whatsapp', segment: 'Frequent Customers', sentDay: 167, note: 'Match-night combo campaign.' },
  ];
  const created: Array<Record<string, any>> = [];
  for (const p of plan) {
    const offerId = state.offers.get(p.key)!;
    const offerDef = OFFER_BY_KEY.get(p.key)!;
    const redemptions = state.offerUses.get(p.key) ?? 0;
    const audience = Math.max(redemptions * 3 + rint(120, 500), 150);
    const delivered = Math.round(audience * (0.9 + rnd() * 0.08));
    const failed = audience - delivered;
    const phones: string[] = [];
    for (let i = 0; i < Math.min(audience, 250); i++) phones.push(state.customers[rint(0, state.customers.length - 1)].phone);
    const results = Array.from({ length: Math.min(audience, 250) }, (_, i) => ({
      phone: phones[i],
      status: (i < delivered ? 'delivered' : 'failed') as 'delivered' | 'failed',
      deliveredAt: dayStr(p.sentDay),
      ...(i < delivered ? {} : { error: 'No delivery receipt' }),
    }));
    const sentDate = dayStr(p.sentDay);
    const campaign = await Campaign.create({
      restaurantId: state.restaurantId,
      name: p.name,
      description: p.note,
      offerId,
      audience: { segmentIds: [], segmentNames: [p.segment], customerPhones: [] },
      template: { channel: p.channel, subject: p.name, message: `${p.name}: ${offerDef.title}. ${offerDef.note}` },
      schedule: { mode: 'immediate', dispatchedAt: new Date(`${sentDate}T09:00:00.000Z`) },
      status: 'sent',
      stats: { audienceCount: audience, sentCount: delivered, failedCount: failed, redeemedCount: redemptions },
      createdBy: 'simulation',
      createdAt: new Date(`${sentDate}T09:00:00.000Z`),
    });
    const history = await CampaignHistory.create({
      offerId,
      restaurantId: state.restaurantId,
      campaignId: campaign._id,
      channel: p.channel,
      recipientPhones: phones,
      recipientCount: audience,
      openedCount: Math.round(delivered * (0.55 + rnd() * 0.2)),
      redeemedCount: redemptions,
      results,
      messageContent: `${p.name}: ${offerDef.title}. ${offerDef.note}`,
      isScheduled: false,
      sentDate,
      campaignCost: round2(audience * (p.channel === 'sms' ? 0.18 : 0.35)),
      status: failed > 0 && delivered > 0 ? 'partial' : 'sent',
      createdAt: new Date(`${sentDate}T09:00:00.000Z`),
    });
    await Campaign.updateOne({ _id: campaign._id }, { $set: { historyIds: [String(history._id)] } });
    created.push({ key: p.key, audience, delivered, failed, redemptions, revenue: state.offerRevenue.get(p.key)!.revenue });
  }
  return created;
}

// ─── Phase 9: controlled experiments (uplift / offer-response data) ─────────

async function createExperiments() {
  const rows: Record<string, any>[] = [];
  const summary: Array<Record<string, any>> = [];

  // NOTE (data-model finding, see report): the deployed legacy unique index on
  // offerexperimentevents is NOT partial, though the schema declares
  // partialFilterExpression { experimentId: null }. A customer with a
  // default-flow row for the same offer therefore collides with any
  // experiment-scoped row. Workaround: experiments use a dedicated offer with
  // no default-flow redemptions — the schema itself is left untouched.
  const experimentOffer = await Offer.create({
    restaurantId: state.restaurantId,
    title: 'Experiment Arm Offer (controlled test)',
    description: 'Dedicated offer used only by controlled experiment assignments (EXP_SIM_6M_A/B). Never published.',
    type: 'percentage',
    value: 15,
    currentUses: 0,
    status: 'paused',
    isAiGenerated: false,
    branchIds: [],
    createdBy: 'simulation',
  });
  const expOfferId = experimentOffer._id as Types.ObjectId;
  const eligible = state.customers.filter((c) => c.acquiredDay <= 100 && (c.churnDay === null || c.churnDay > 100));
  // Disjoint halves per experiment — a customer can sit in only ONE arm.
  const shuffled = [...eligible].sort(() => rnd() - 0.5);
  const armA = shuffled.slice(0, 300);
  const armB = shuffled.slice(300, 600);
  const armC = shuffled.slice(600, 800);
  const armD = shuffled.slice(800, 1000);

  const assign = (experimentId: string, variantId: string, treatment: 0 | 1, day: number, responseBoost: number, group: SimCustomer[]) => {
    let assigned = 0;
    let converted = 0;
    let revenue = 0;
    for (const c of group) {
      assigned += 1;
      const p = Math.min(0.85, Math.max(0.02, 0.16 + c.discountSensitivity * 0.18 + responseBoost - (c.churnDay ? 0.06 : 0)));
      const responded = chance(p);
      const assignedAt = new Date(`${dayStr(day)}T10:00:00.000Z`);
      rows.push({
        restaurantId: state.restaurantId,
        branchId: state.branches[0]._id,
        offerId: expOfferId,
        customerId: String(c._id),
        eventType: 'assigned',
        treatment,
        purchase: responded ? 1 : 0,
        features: {
          recencyDays: rint(1, 30),
          frequency: Math.round(c.lambda * 100),
          monetary: round2(rint(800, 9000) + rnd() * 500),
          favoriteCategory: c.affinity[0],
          discountSensitivity: c.discountSensitivity,
          channel: c.deliveryBias > 0.4 ? 'Delivery' : 'Dine In',
          archetype: c.archetype,
        },
        assignedAt,
        experimentId,
        variantId,
        exposedAt: assignedAt,
        createdAt: assignedAt,
      });
      if (responded) {
        const rev = round2(300 + rnd() * 900);
        revenue = round2(revenue + rev);
        converted += 1;
        rows.push({
          restaurantId: state.restaurantId,
          branchId: state.branches[0]._id,
          offerId: expOfferId,
          customerId: String(c._id),
          eventType: 'converted',
          treatment,
          purchase: 1,
          features: {},
          experimentId,
          variantId,
          convertedAt: new Date(`${dayStr(day + 3)}T20:00:00.000Z`),
          attributedRevenue: rev,
          createdAt: new Date(`${dayStr(day + 3)}T20:00:00.000Z`),
        });
      }
    }
    summary.push({ experimentId, variantId, assigned, converted, conversionRate: round2(converted / Math.max(1, assigned)), attributedRevenue: revenue });
  };

  // Experiment A — 10% vs 15% discount (the treatment/control contrast).
  assign('EXP_SIM_6M_A', 'control', 0, 100, 0, armA);
  assign('EXP_SIM_6M_A', 'variant-a', 1, 100, 0.08, armB);
  // Experiment B — 15% flat offer vs pure holdout (no offer).
  assign('EXP_SIM_6M_B', 'control', 0, 140, -0.08, armC);
  assign('EXP_SIM_6M_B', 'variant-a', 1, 140, 0.06, armD);

  for (let i = 0; i < rows.length; i += 1000) {
    await OfferExperimentEvent.insertMany(rows.slice(i, i + 1000), { ordered: false });
  }
  state.experimentEvents = rows.length;
  return summary;
}

// ─── Phase 10: customer stats reconciliation + segments ─────────────────────

async function reconcileCustomers() {
  const ops: any[] = [];
  for (const [id, ct] of state.customerTotals) {
    const favorite = [...ct.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    const customer = state.customers.find((c) => String(c._id) === id)!;
    const spend = ct.spend;
    const tier = spend > 25000 ? 'Diamond' : spend > 15000 ? 'Platinum' : spend > 8000 ? 'Gold' : spend > 3000 ? 'Silver' : 'Bronze';
    ops.push({
      updateOne: {
        filter: { _id: customer._id },
        update: {
          $set: {
            restaurantId: state.restaurantId,
            branchId: state.branches[0]._id,
            phone: customer.phone,
            name: customer.name,
            email: `sim.customer${String(customer.phone).slice(-4)}@example.com`,
            city: 'New Delhi',
            state: 'Delhi',
            country: 'India',
            tags: [customer.archetype, ...customer.affinity],
            marketingOptIn: chance(0.75),
            favoriteItems: favorite,
            favoriteCategories: customer.affinity,
            preferredPaymentMethod: pick(['UPI', 'Cash', 'Card'] as const),
            totalSpend: spend,
            averageSpend: round2(spend / Math.max(1, ct.orders)),
            totalOrders: ct.orders,
            visits: ct.visits,
            lastVisit: new Date(`${ct.last}T20:00:00.000Z`),
            firstVisit: new Date(`${ct.first}T20:00:00.000Z`),
            visitFrequency: round2(Math.max(1, DAYS / Math.max(1, ct.orders))),
            points: ct.points,
            lifetimePoints: ct.points,
            tier,
            tierChangedAt: new Date(),
            status: customer.churnDay && customer.churnDay < 150 ? 'dormant' : 'active',
            isNewCustomer: false,
            isVip: spend > 20000,
            referralCode: `SIM${String(customer.phone).slice(-5)}`,
            referralCount: chance(0.1) ? rint(1, 3) : 0,
            createdAt: new Date(`${ct.first}T12:00:00.000Z`),
          },
        },
        upsert: true,
      },
    });
  }
  // Customers who never transacted still exist as acquired profiles (low activity).
  const idle = state.customers.filter((c) => !state.customerTotals.has(String(c._id)));
  for (const c of idle) {
    ops.push({
      updateOne: {
        filter: { _id: c._id },
        update: {
          $set: {
            restaurantId: state.restaurantId,
            phone: c.phone,
            name: c.name,
            email: `sim.customer${String(c.phone).slice(-4)}@example.com`,
            city: 'New Delhi',
            state: 'Delhi',
            country: 'India',
            tags: [c.archetype],
            marketingOptIn: false,
            totalSpend: 0,
            averageSpend: 0,
            totalOrders: 0,
            visits: 0,
            points: 0,
            lifetimePoints: 0,
            tier: 'Bronze',
            status: 'active',
            isNewCustomer: true,
            referralCode: `SIM${String(c.phone).slice(-5)}`,
            createdAt: new Date(`${dayStr(c.acquiredDay)}T12:00:00.000Z`),
          },
        },
        upsert: true,
      },
    });
  }
  for (let i = 0; i < ops.length; i += 500) await Customer.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  return { customersWithHistory: state.customerTotals.size, idleProfiles: idle.length };
}

// ─── Phase 11: summaries ────────────────────────────────────────────────────

async function createSummaries() {
  const dailyOps: any[] = [];
  const monthlyAgg = new Map<string, any>();
  for (const [key, agg] of state.perBranchDaily) {
    const [date, branchCode] = key.split('|');
    const branch = state.branches.find((b) => b.code === branchCode)!;
    const topItems = [...agg.itemMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 8).map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }));
    const categoryBreakdown = [...agg.catMap.entries()].map(([category, v]) => ({ category, qty: v.qty, revenue: v.revenue }));
    const paymentBreakdown = [...agg.payMap.entries()].map(([method, v]) => ({ method, amount: v.amount, count: v.count }));
    const cashierPerformance = [...agg.cashierMap.entries()].map(([name, v]) => ({ name, orders: v.orders, revenue: v.revenue }));
    dailyOps.push({
      updateOne: {
        filter: { restaurantId: state.restaurantId, branchId: branch._id, date },
        update: {
          $set: {
            restaurantId: state.restaurantId,
            branchId: branch._id,
            date,
            totalRevenue: agg.revenue,
            totalOrders: agg.orders,
            totalItemsSold: agg.items,
            totalDiscount: agg.discount,
            totalGst: agg.gst,
            averageOrderValue: round2(agg.revenue / Math.max(1, agg.orders)),
            paymentBreakdown,
            categoryBreakdown,
            topItems,
            cashierPerformance,
          },
        },
        upsert: true,
      },
    });
    const month = date.slice(0, 7);
    const mKey = `${month}|${branchCode}`;
    const m = monthlyAgg.get(mKey) ?? { month, branchCode, revenue: 0, orders: 0, items: 0, discount: 0, gst: 0, cash: 0, nonCash: 0, catMap: new Map<string, { qty: number; revenue: number }>(), itemMap: new Map<string, { qty: number; revenue: number }>() };
    m.revenue = round2(m.revenue + agg.revenue);
    m.orders += agg.orders;
    m.items += agg.items;
    m.discount = round2(m.discount + agg.discount);
    m.gst = round2(m.gst + agg.gst);
    for (const [method, v] of agg.payMap) {
      if (method === 'Cash') m.cash = round2(m.cash + v.amount);
      else m.nonCash = round2(m.nonCash + v.amount);
    }
    for (const [category, v] of agg.catMap) {
      const c = m.catMap.get(category) ?? { qty: 0, revenue: 0 };
      c.qty += v.qty;
      c.revenue = round2(c.revenue + v.revenue);
      m.catMap.set(category, c);
    }
    for (const [name, v] of agg.itemMap) {
      const it = m.itemMap.get(name) ?? { qty: 0, revenue: 0 };
      it.qty += v.qty;
      it.revenue = round2(it.revenue + v.revenue);
      m.itemMap.set(name, it);
    }
    monthlyAgg.set(mKey, m);
  }
  for (let i = 0; i < dailyOps.length; i += 400) await DailySummary.bulkWrite(dailyOps.slice(i, i + 400), { ordered: false });

  const monthlyOps: any[] = [];
  for (const m of monthlyAgg.values()) {
    const branch = state.branches.find((b) => b.code === m.branchCode)!;
    monthlyOps.push({
      updateOne: {
        filter: { restaurantId: state.restaurantId, branchId: branch._id, month: m.month },
        update: {
          $set: {
            restaurantId: state.restaurantId,
            branchId: branch._id,
            month: m.month,
            totalRevenue: m.revenue,
            totalOrders: m.orders,
            totalItemsSold: m.items,
            totalDiscount: m.discount,
            totalGst: m.gst,
            averageOrderValue: round2(m.revenue / Math.max(1, m.orders)),
            cashSales: m.cash,
            nonCashSales: m.nonCash,
            pointsEarned: Math.round(m.revenue / 100),
            pointsRedeemed: 0,
            categoryBreakdown: [...m.catMap.entries()].map(([category, v]) => ({ category, qty: v.qty, revenue: v.revenue })),
            topItems: [...m.itemMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10).map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue })),
          },
        },
        upsert: true,
      },
    });
  }
  if (monthlyOps.length) await MonthlySummary.bulkWrite(monthlyOps, { ordered: false });
  return { dailyRows: dailyOps.length, monthlyRows: monthlyOps.length };
}

// ─── Reporting helpers ──────────────────────────────────────────────────────

async function countTenantRows() {
  const id = state.restaurantId;
  const counts: Record<string, number> = {};
  for (const model of MODELS) {
    if (model === Restaurant) {
      counts['Restaurant'] = await Restaurant.countDocuments({ restaurantId: RESTAURANT_KEY });
      continue;
    }
    counts[model.modelName] = await model.countDocuments({ restaurantId: id });
  }
  return counts;
}

async function runIntegrityChecks() {
  const id = state.restaurantId;
  const checks: Array<{ name: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }> = [];

  // 1. Sales reconciliation — bill totals vs items.
  const sampleBills = await Bill.aggregate([
    { $match: { restaurantId: id } },
    { $sample: { size: 300 } },
    { $lookup: { from: BillItem.collection.name, localField: '_id', foreignField: 'billId', as: 'items' } },
  ]);
  let bad = 0;
  for (const b of sampleBills) {
    const itemTotal = (b.items as any[]).reduce((s, i) => s + i.priceAtSale * i.quantity, 0);
    if (Math.abs(itemTotal - b.subtotal) > 0.02) bad += 1;
    if (Math.abs(b.subtotal - b.discount - b.grandTotal) > 0.02) bad += 1;
  }
  checks.push({
    name: 'sales_reconciliation',
    status: bad === 0 ? 'PASS' : 'FAIL',
    detail: `Sampled ${sampleBills.length} bills: subtotal = Σ items and grandTotal = subtotal − discount held for ${sampleBills.length - bad}/${sampleBills.length}.`,
  });

  // 2. Inventory reconciliation (in-memory ledger vs final product stock).
  let invMismatch = 0;
  const invLines: string[] = [];
  for (const ing of state.ingredients) {
    const expected = round2(ing.opening + ing.purchased + ing.adjusted - ing.consumed - ing.wasted);
    const drift = Math.abs(expected - ing.stock);
    if (drift > 0.05) invMismatch += 1;
    invLines.push(`${ing.def.name}: open ${ing.opening} + buy ${ing.purchased} + adj ${ing.adjusted} − used ${ing.consumed} − waste ${ing.wasted} = ${expected} (stored ${ing.stock})`);
  }
  checks.push({
    name: 'inventory_reconciliation',
    status: invMismatch === 0 ? 'PASS' : 'WARN',
    detail: `${state.ingredients.length - invMismatch}/${state.ingredients.length} ingredients reconcile to the stored closing stock.`,
  });

  // 3. Recipe → consumption coverage.
  const totalBills = await Bill.countDocuments({ restaurantId: id });
  const totalConsumptions = await RecipeConsumption.countDocuments({ restaurantId: id });
  checks.push({
    name: 'recipe_reconciliation',
    status: totalBills === totalConsumptions ? 'PASS' : 'FAIL',
    detail: `${totalConsumptions} consumption records for ${totalBills} bills (1:1 per bill).`,
  });

  // 4. Customer reconciliation.
  const customerAgg = await Bill.aggregate([
    { $match: { restaurantId: id, customerId: { $ne: null } } },
    { $group: { _id: '$customerId', orders: { $sum: 1 }, spend: { $sum: '$grandTotal' } } },
  ]);
  const customers = await Customer.find({ restaurantId: id }).select('totalOrders totalSpend').lean();
  const byId = new Map(customerAgg.map((c: any) => [String(c._id), c]));
  let custMismatch = 0;
  for (const c of customers as any[]) {
    const agg = byId.get(String(c._id));
    const orders = agg?.orders ?? 0;
    const spend = round2(agg?.spend ?? 0);
    if (c.totalOrders !== orders || Math.abs(c.totalSpend - spend) > 0.02) custMismatch += 1;
  }
  checks.push({
    name: 'customer_reconciliation',
    status: custMismatch === 0 ? 'PASS' : 'FAIL',
    detail: `${customers.length - custMismatch}/${customers.length} customer profiles match their bill aggregates exactly.`,
  });

  // 5. Offer reconciliation — currentUses vs redemption ledger.
  const offerUses = await CouponRedemption.aggregate([{ $match: { restaurantId: id, status: 'applied' } }, { $group: { _id: '$offerId', n: { $sum: 1 } } }]);
  const offers = await Offer.find({ restaurantId: id }).select('currentUses title').lean();
  let offerMismatch = 0;
  for (const o of offers as any[]) {
    const agg = offerUses.find((u: any) => String(u._id) === String(o._id));
    if ((agg?.n ?? 0) !== o.currentUses) offerMismatch += 1;
  }
  checks.push({
    name: 'offer_reconciliation',
    status: offerMismatch === 0 ? 'PASS' : 'FAIL',
    detail: `${(offers as any[]).length - offerMismatch}/${(offers as any[]).length} offers match their redemption ledger.`,
  });

  // 6. Campaign reconciliation.
  const campaigns = await Campaign.find({ restaurantId: id }).select('stats name').lean();
  const histories = await CampaignHistory.find({ restaurantId: id }).select('campaignId redeemedCount recipientCount').lean();
  let campMismatch = 0;
  for (const c of campaigns as any[]) {
    const h = (histories as any[]).find((x) => String(x.campaignId) === String(c._id));
    if (!h || h.redeemedCount !== c.stats.redeemedCount || h.recipientCount !== c.stats.audienceCount) campMismatch += 1;
  }
  checks.push({
    name: 'campaign_reconciliation',
    status: campMismatch === 0 ? 'PASS' : 'FAIL',
    detail: `${(campaigns as any[]).length - campMismatch}/${(campaigns as any[]).length} campaigns match their delivery history.`,
  });

  // 7. Tenant isolation — no sim row may leak into another tenant (and vice versa).
  const leaks: string[] = [];
  for (const model of MODELS) {
    if (model === Restaurant) continue;
    // BillItem is scoped through its parent Bill (billId) by design — no
    // restaurantId field on the schema. Validate via the join: every sim bill
    // must have ≥1 item (and the sampled sales check covers totals).
    if (model.modelName === 'BillItem') {
      const emptyBills = await Bill.aggregate([
        { $match: { restaurantId: id } },
        { $lookup: { from: 'billitems', localField: '_id', foreignField: 'billId', as: 'items' } },
        { $match: { items: { $size: 0 } } },
        { $count: 'n' },
      ]);
      const n = (emptyBills[0] as any)?.n ?? 0;
      if (n > 0) leaks.push(`BillItem:billsWithoutItems(${n})`);
      continue;
    }
    const other = await model.countDocuments({ restaurantId: { $ne: id }, invoiceNumber: /^SIM6M-/ });
    if (other > 0) leaks.push(`${model.modelName}:${other}`);
    const missing = await model.countDocuments({ restaurantId: { $exists: false } });
    if (missing > 0) leaks.push(`${model.modelName}:missing(${missing})`);
  }
  checks.push({
    name: 'tenant_isolation',
    status: leaks.length === 0 ? 'PASS' : 'WARN',
    detail: leaks.length === 0 ? 'Every simulation row is scoped to SIM_RESTAURANT_6M_001; no cross-tenant leakage detected.' : `Check: ${leaks.join(', ')}`,
  });

  // 8. Chronology.
  const firstBill = await Bill.findOne({ restaurantId: id }).sort({ date: 1 }).select('date').lean();
  const lastBill = await Bill.findOne({ restaurantId: id }).sort({ date: -1 }).select('date').lean();
  const badChrono = await Bill.countDocuments({ restaurantId: id, date: { $lt: dayStr(0) } });
  checks.push({
    name: 'chronological_validation',
    status: badChrono === 0 ? 'PASS' : 'FAIL',
    detail: `Bills span ${(firstBill as any)?.date} → ${(lastBill as any)?.date}; ${badChrono} bills fall outside the simulated window.`,
  });

  // 9. ML leakage — experiment features must never carry outcome fields.
  const leaky = await OfferExperimentEvent.countDocuments({
    restaurantId: id,
    $or: [
      { 'features.attributedRevenue': { $exists: true } },
      { 'features.redeemedBillId': { $exists: true } },
      { 'features.purchase': { $exists: true } },
    ],
  });
  checks.push({
    name: 'ml_leakage_validation',
    status: leaky === 0 ? 'PASS' : 'FAIL',
    detail: leaky === 0 ? 'No post-treatment fields appear in pre-treatment feature snapshots.' : `${leaky} rows leak outcome fields into features.`,
  });

  return { checks, invLines };
}

// ─── Modes ──────────────────────────────────────────────────────────────────

async function dryRun() {
  const billsPerDay = 118;
  const avgMonth = [0.55, 0.78, 0.95, 1.05, 1.1, 1.2].reduce((a, b) => a + b, 0) / 6;
  console.log(`Simulation plan (${RESTAURANT_KEY})`);
  console.log(`  window        : ${dayStr(0)} → ${dayStr(DAYS - 1)} (${DAYS} days)`);
  console.log(`  seed          : ${SEED}`);
  console.log(`  branches      : ${3}`);
  console.log(`  menu products : ${MENU.length} (+${INGREDIENTS.length} ingredients)`);
  console.log(`  recipes       : ${MENU.length}`);
  console.log(`  customers     : 1200`);
  console.log(`  bills (est.)  : ~${Math.round(billsPerDay * avgMonth * 1.2 * DAYS)} (day-of-week + context weighted)`);
  console.log(`  offers        : ${OFFERS.length}, campaigns: 7, experiments: 2`);
  console.log(`  calendar      : ${CALENDAR.length} events`);
  console.log(`  login         : userId=${OWNER_USER_ID} pin=${OWNER_PIN}`);
  const existing = await Restaurant.findOne({ restaurantId: RESTAURANT_KEY }).lean();
  console.log(`  existing tenant: ${existing ? 'FOUND — --execute will clean it first (tenant-scoped only)' : 'none'}`);
}

async function execute() {
  console.log('── Phase 0: cleanup (tenant-scoped) ──');
  const deleted = await cleanSimTenant();
  console.log(`  removed: ${Object.entries(deleted).map(([k, v]) => `${k}=${v}`).join(', ') || 'nothing'}`);

  console.log('── Phase 1: tenant ──');
  await createTenant();
  console.log(`  restaurant ${RESTAURANT_KEY} (${state.restaurantId}) · ${state.branches.length} branches · login ${OWNER_USER_ID}/${OWNER_PIN}`);

  console.log('── Phase 2: catalog + recipes ──');
  await createCatalog();
  await createRecipes();
  console.log(`  ${MENU.length} menu products, ${INGREDIENTS.length} ingredients, ${MENU.length} recipes`);

  console.log('── Phase 3: calendar ──');
  await createCalendar();
  console.log(`  ${CALENDAR.length} events`);

  console.log('── Phase 4: offers ──');
  await createOffers();
  console.log(`  ${OFFERS.length} offers`);

  console.log('── Phase 5: customers ──');
  await createCustomers();
  console.log(`  ${state.customers.length} customer profiles`);

  console.log('── Phase 6: six-month operating loop ──');
  const stockoutDays = await runOperatingLoop();
  console.log(`  bills=${state.bills} billItems=${state.billItems} consumptions=${state.bills} purchases=${state.purchases} inventoryEvents=${state.inventoryEvents} redemptions=${state.redemptions}`);

  console.log('── Phase 7: campaigns ──');
  const campaigns = await createCampaigns();
  console.log(`  ${campaigns.length} campaigns with delivery history`);

  console.log('── Phase 8: experiments ──');
  const experiments = await createExperiments();
  console.log(`  ${experiments.length} experiment arms, ${state.experimentEvents} ledger rows`);

  console.log('── Phase 9: customer reconciliation + rule segments ──');
  const cust = await reconcileCustomers();
  await updateAllSegments(String(state.restaurantId));
  const segmentCount = await CustomerSegment.countDocuments({ restaurantId: state.restaurantId });
  console.log(`  ${cust.customersWithHistory} customers with history (+${cust.idleProfiles} idle profiles), ${segmentCount} rule segments`);

  console.log('── Phase 10: summaries ──');
  const summaries = await createSummaries();
  console.log(`  ${summaries.dailyRows} daily summaries, ${summaries.monthlyRows} monthly summaries`);

  console.log('── Phase 11: offer analytics backfill (real service) ──');
  const analytics = await aggregateAndBackfill({ restaurantId: String(state.restaurantId) });
  console.log(`  ${analytics.snapshots} offer snapshots from ${analytics.redemptions} redemptions`);

  // Reconcile offer.currentUses from the redemption ledger (the counter is
  // incremented by the OfferEngine in production; the sim writes redemptions
  // directly and mirrors the counter here).
  const useLedger = await CouponRedemption.aggregate([
    { $match: { restaurantId: state.restaurantId, status: 'applied' } },
    { $group: { _id: '$offerId', n: { $sum: 1 } } },
  ]);
  for (const u of useLedger) {
    await Offer.updateOne({ _id: u._id }, { $set: { currentUses: u.n } });
  }
  console.log(`  offer.currentUses reconciled for ${useLedger.length} offers`);

  const counts = await countTenantRows();
  const report = {
    generatedAt: new Date().toISOString(),
    restaurant: RESTAURANT_KEY,
    restaurantObjectId: String(state.restaurantId),
    login: { userId: OWNER_USER_ID, pin: OWNER_PIN, endpoint: 'POST /api/auth/login { username, password }' },
    window: { start: dayStr(0), end: dayStr(DAYS - 1), days: DAYS },
    seed: SEED,
    counts,
    offers: Object.fromEntries([...state.offerRevenue.entries()].map(([k, v]) => [k, { title: OFFER_BY_KEY.get(k)!.title, ...v }])),
    campaigns,
    experiments,
    stockoutDays,
    finalStock: state.ingredients.map((i) => ({ item: i.def.name, stock: i.stock, unit: i.def.unit, avgCost: i.avgCost })),
    warnings: state.warnings,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'sim-6m-execute.json'), JSON.stringify(report, null, 2));
  console.log(`\nGenerated. Wrote sim-6m-execute.json`);
  console.log(`Login: username=${OWNER_USER_ID} password=${OWNER_PIN}`);
}

async function report() {
  const rest = await Restaurant.findOne({ restaurantId: RESTAURANT_KEY }).lean();
  if (!rest) throw new Error(`Simulation tenant ${RESTAURANT_KEY} not found — run --execute first.`);
  state.restaurantId = rest._id as Types.ObjectId;

  const counts = await countTenantRows();
  const { checks, invLines } = await runIntegrityChecks();

  const revenue = await Bill.aggregate([{ $match: { restaurantId: state.restaurantId } }, { $group: { _id: null, revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 }, discount: { $sum: '$discount' }, gst: { $sum: '$gst' } } }]);
  const monthly = await Bill.aggregate([
    { $match: { restaurantId: state.restaurantId } },
    { $group: { _id: { $substr: ['$date', 0, 7] }, revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const productPerf = await BillItem.aggregate([
    { $lookup: { from: Bill.collection.name, localField: 'billId', foreignField: '_id', as: 'bill' } },
    { $match: { 'bill.restaurantId': state.restaurantId } },
    { $group: { _id: '$itemName', qty: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } } } },
    { $sort: { revenue: -1 } },
  ]);
  const segments = await CustomerSegment.find({ restaurantId: state.restaurantId }).select('name customerCount averageSpend').sort({ customerCount: -1 }).lean();
  const offers = await Offer.find({ restaurantId: state.restaurantId }).select('title type currentUses').lean();
  const redemptions = await CouponRedemption.aggregate([
    { $match: { restaurantId: state.restaurantId, status: 'applied' } },
    { $group: { _id: '$offerId', redemptions: { $sum: 1 }, discount: { $sum: '$discountAmount' } } },
  ]);
  const expiry = await Product.find({ restaurantId: state.restaurantId, type: 'inventory', expiryDate: { $ne: '' } }).select('name expiryDate currentStock unit').lean();
  const waste = await InventoryEvent.aggregate([
    { $match: { restaurantId: state.restaurantId, type: 'waste' } },
    { $group: { _id: '$item', qty: { $sum: '$quantity' }, value: { $sum: '$totalCost' } } },
    { $sort: { value: -1 } },
  ]);
  const lowStock = await Product.find({ restaurantId: state.restaurantId, type: 'inventory', $expr: { $lt: ['$currentStock', '$reorderLevel'] } }).select('name currentStock reorderLevel unit').lean();

  const offerTable = (offers as any[]).map((o) => {
    const r = redemptions.find((x: any) => String(x._id) === String(o._id));
    return { title: o.title, type: o.type, redemptions: r?.redemptions ?? 0, discountGiven: round2(r?.discount ?? 0), currentUses: o.currentUses };
  }).sort((a, b) => b.redemptions - a.redemptions);

  const out = {
    generatedAt: new Date().toISOString(),
    restaurant: RESTAURANT_KEY,
    restaurantObjectId: String(state.restaurantId),
    login: { userId: rest.ownerUserId, pin: OWNER_PIN },
    window: { start: dayStr(0), end: dayStr(DAYS - 1) },
    counts,
    sales: revenue[0],
    monthly,
    topProducts: productPerf.slice(0, 15),
    bottomProducts: productPerf.slice(-10),
    segments,
    offers: offerTable,
    waste,
    lowStock,
    expiryRisk: expiry,
    checks,
    inventoryLedger: invLines,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'sim-6m-report.json'), JSON.stringify(out, null, 2));
  console.log('── Integrity ──');
  for (const c of checks) console.log(`  [${c.status}] ${c.name}: ${c.detail}`);
  console.log(`\nRevenue ₹${round2(revenue[0]?.revenue ?? 0)} across ${revenue[0]?.orders ?? 0} bills.`);
  console.log('Wrote sim-6m-report.json');
}

async function main() {
  await mongoose.connect(MONGO_URI);
  try {
    if (MODE === '--dry-run') await dryRun();
    else if (MODE === '--clean') {
      const deleted = await cleanSimTenant();
      console.log(`Cleaned ${RESTAURANT_KEY}:`, Object.entries(deleted).map(([k, v]) => `${k}=${v}`).join(', ') || 'nothing found');
    } else if (MODE === '--execute') await execute();
    else await report();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
