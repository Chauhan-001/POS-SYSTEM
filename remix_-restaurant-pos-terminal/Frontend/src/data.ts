/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, Customer, LoyaltyReward, Employee, SystemSettings, Bill, VisitMilestone, CartItem, DailySales, ActivityEntry } from './types';

// ============================================================
// SEED PRODUCTS — 30+ items across 7 categories with variants
// ============================================================
export const DEFAULT_PRODUCTS: Product[] = [
  // ---- PIZZAS ----
  {
    id: 'p_pizza_01', code: 'PZ01', name: 'Margherita Pizza', price: 299,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_pizza_02', code: 'PZ02', name: 'Pepperoni Pizza', price: 399,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
    variants: [
      { name: 'Regular 10"', price: 399 },
      { name: 'Large 14"', price: 599 },
    ],
  },
  {
    id: 'p_pizza_03', code: 'PZ03', name: 'BBQ Chicken Pizza', price: 449,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_pizza_04', code: 'PZ04', name: 'Veggie Supreme Pizza', price: 349,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1604917877934-07d8d248d396?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'Regular 10"', price: 349 },
      { name: 'Large 14"', price: 549 },
    ],
  },
  {
    id: 'p_pizza_05', code: 'PZ05', name: 'Paneer Tikka Pizza', price: 399,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1513106580091-1fd30908cb92?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },

  // ---- BURGERS ----
  {
    id: 'p_burger_01', code: 'BG01', name: 'Classic Cheeseburger', price: 249,
    category: 'Burgers', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
    variants: [
      { name: 'Single Patty', price: 249 },
      { name: 'Double Patty', price: 349 },
    ],
  },
  {
    id: 'p_burger_02', code: 'BG02', name: 'Crispy Chicken Burger', price: 279,
    category: 'Burgers', image: 'https://images.unsplash.com/photo-1606755962773-d324e0a130db?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_burger_03', code: 'BG03', name: 'Veggie Delight Burger', price: 199,
    category: 'Burgers', image: 'https://images.unsplash.com/photo-1520072959219-c595dc870360?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_burger_04', code: 'BG04', name: 'BBQ Bacon Burger', price: 329,
    category: 'Burgers', image: 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },

  // ---- PASTA & ITALIAN ----
  {
    id: 'p_pasta_01', code: 'PS01', name: 'Spaghetti Carbonara', price: 349,
    category: 'Pasta', image: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_pasta_02', code: 'PS02', name: 'Penne Arrabbiata', price: 299,
    category: 'Pasta', image: 'https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_pasta_03', code: 'PS03', name: 'Alfredo Pasta', price: 329,
    category: 'Pasta', image: 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'Regular', price: 329 },
      { name: 'Large', price: 449 },
    ],
  },
  {
    id: 'p_pasta_04', code: 'PS04', name: 'Baked Lasagna', price: 449,
    category: 'Pasta', image: 'https://images.unsplash.com/photo-1574894709920-11b28e7367e3?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },

  // ---- BEVERAGES ----
  {
    id: 'p_bev_01', code: 'BV01', name: 'Fresh Lime Soda', price: 99,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_bev_02', code: 'BV02', name: 'Classic Vanilla Shake', price: 199,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'Regular', price: 199 },
      { name: 'Large', price: 279 },
    ],
  },
  {
    id: 'p_bev_03', code: 'BV03', name: 'Oreo Thick Shake', price: 249,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_bev_04', code: 'BV04', name: 'Mango Smoothie', price: 179,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_bev_05', code: 'BV05', name: 'Iced Tea (Lemon)', price: 89,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- DESSERTS ----
  {
    id: 'p_dessert_01', code: 'DS01', name: 'Chocolate Lava Cake', price: 249,
    category: 'Desserts', image: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_dessert_02', code: 'DS02', name: 'Tiramisu', price: 299,
    category: 'Desserts', image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_dessert_03', code: 'DS03', name: 'Ice Cream Sundae', price: 179,
    category: 'Desserts', image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'Vanilla', price: 179 },
      { name: 'Chocolate', price: 199 },
      { name: 'Strawberry', price: 189 },
    ],
  },
  {
    id: 'p_dessert_04', code: 'DS04', name: 'Gulab Jamun (4 pcs)', price: 149,
    category: 'Desserts', image: 'https://images.unsplash.com/photo-1661569181528-2633a6815fa7?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- APPETIZERS / SIDES ----
  {
    id: 'p_app_01', code: 'AP01', name: 'French Fries', price: 149,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'Regular', price: 149 },
      { name: 'Large', price: 199 },
    ],
  },
  {
    id: 'p_app_02', code: 'AP02', name: 'Onion Rings', price: 179,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1639024471283-03518883512d?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_app_03', code: 'AP03', name: 'Garlic Bread', price: 129,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1619535860434-ba1d8fa1251d?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_app_04', code: 'AP04', name: 'Chicken Wings (6 pcs)', price: 299,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1608039829572-e2b0242dcd44?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'BBQ Glaze', price: 299 },
      { name: 'Spicy Peri-Peri', price: 319 },
      { name: 'Honey Garlic', price: 329 },
    ],
  },
  {
    id: 'p_app_05', code: 'AP05', name: 'Spring Rolls (6 pcs)', price: 199,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1606525437817-0055ae15d6e7?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- COMBO OFFERS ----
  {
    id: 'p_combo_01', code: 'CB01', name: 'Lunch Combo', price: 499,
    category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_combo_02', code: 'CB02', name: 'Pizza Combo', price: 599,
    category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_combo_03', code: 'CB03', name: 'Family Feast', price: 999,
    category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- ADDITIONAL APPETIZERS ----
  {
    id: 'p_app_06', code: 'AP06', name: 'Chicken Tikka (6 pcs)', price: 349,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_app_07', code: 'AP07', name: 'Nachos Supreme', price: 249,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_app_08', code: 'AP08', name: 'Mozzarella Sticks (6 pcs)', price: 219,
    category: 'Appetizers', image: 'https://images.unsplash.com/photo-1531749668029-2db88e4276a1?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- ADDITIONAL BEVERAGES ----
  {
    id: 'p_bev_06', code: 'BV06', name: 'Cappuccino Coffee', price: 149,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_bev_07', code: 'BV07', name: 'Hot Chocolate', price: 179,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_bev_08', code: 'BV08', name: 'Strawberry Shake', price: 219,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_bev_09', code: 'BV09', name: 'Mango Lassi', price: 129,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_bev_10', code: 'BV10', name: 'Cold Coffee', price: 159,
    category: 'Beverages', image: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- ADDITIONAL PIZZAS ----
  {
    id: 'p_pizza_06', code: 'PZ06', name: 'Hawaiian Pizza', price: 379,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?w=300&q=80',
    gstPercent: 5, availability: true,
    variants: [
      { name: 'Regular 10"', price: 379 },
      { name: 'Large 14"', price: 579 },
    ],
  },
  {
    id: 'p_pizza_07', code: 'PZ07', name: 'Farmhouse Pizza', price: 429,
    category: 'Pizzas', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },

  // ---- ADDITIONAL BURGERS ----
  {
    id: 'p_burger_05', code: 'BG05', name: 'Mushroom Swiss Burger', price: 299,
    category: 'Burgers', image: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_burger_06', code: 'BG06', name: 'Spicy Jalapeño Burger', price: 279,
    category: 'Burgers', image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- ADDITIONAL DESSERTS ----
  {
    id: 'p_dessert_05', code: 'DS05', name: 'Brownie with Ice Cream', price: 279,
    category: 'Desserts', image: 'https://images.unsplash.com/photo-1564355808539-22e2d1e8b695?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_dessert_06', code: 'DS06', name: 'New York Cheesecake', price: 329,
    category: 'Desserts', image: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- RICE & BIRYANI (NEW CATEGORY) ----
  {
    id: 'p_rice_01', code: 'RB01', name: 'Chicken Biryani', price: 349,
    category: 'Rice & Biryani', image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_rice_02', code: 'RB02', name: 'Veg Biryani', price: 279,
    category: 'Rice & Biryani', image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_rice_03', code: 'RB03', name: 'Egg Fried Rice', price: 199,
    category: 'Rice & Biryani', image: 'https://images.unsplash.com/photo-1603133872120-5c5e7c1c0e44?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- ADDITIONAL COMBOS ----
  {
    id: 'p_combo_04', code: 'CB04', name: 'Student Combo', price: 399,
    category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1520072959219-c595dc870360?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_combo_05', code: 'CB05', name: 'Party Platter (4 Pax)', price: 1499,
    category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- SALADS (NEW CATEGORY) ----
  {
    id: 'p_salad_01', code: 'SL01', name: 'Caesar Salad', price: 249,
    category: 'Salads', image: 'https://images.unsplash.com/photo-1546793665-c74683f339c1?w=300&q=80',
    gstPercent: 5, availability: true, favorite: true,
  },
  {
    id: 'p_salad_02', code: 'SL02', name: 'Greek Salad', price: 279,
    category: 'Salads', image: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=300&q=80',
    gstPercent: 5, availability: true,
  },
  {
    id: 'p_salad_03', code: 'SL03', name: 'Chicken Caesar Salad', price: 329,
    category: 'Salads', image: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=300&q=80',
    gstPercent: 5, availability: true,
  },

  // ---- SOUPS ----
  { id: 'p_soup_01', code: 'SO01', name: 'Tomato Basil Soup', price: 149, category: 'Soups', image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_soup_02', code: 'SO02', name: 'Hot & Sour Soup', price: 169, category: 'Soups', image: 'https://images.unsplash.com/photo-1603541830401-37e423ae8b2b?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_soup_03', code: 'SO03', name: 'Cream of Mushroom', price: 179, category: 'Soups', image: 'https://images.unsplash.com/photo-1586997434709-87a857c2e0c9?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_soup_04', code: 'SO04', name: 'Sweet Corn Soup', price: 139, category: 'Soups', image: 'https://images.unsplash.com/photo-1585110396000-c9ffd4e4b308?w=300&q=80', gstPercent: 5, availability: true },

  // ---- WRAPS & ROLLS ----
  { id: 'p_wrap_01', code: 'WR01', name: 'Chicken Shawarma Wrap', price: 249, category: 'Wraps & Rolls', image: 'https://images.unsplash.com/photo-1565299507177-bcac0b3f0d8a?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_wrap_02', code: 'WR02', name: 'Paneer Kathi Roll', price: 219, category: 'Wraps & Rolls', image: 'https://images.unsplash.com/photo-1626132647523-66f5bf380027?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_wrap_03', code: 'WR03', name: 'Egg Wrap', price: 179, category: 'Wraps & Rolls', image: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=300&q=80', gstPercent: 5, availability: true },

  // ---- INDIAN MAIN COURSE ----
  { id: 'p_indian_01', code: 'IC01', name: 'Butter Chicken (Half)', price: 349, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_indian_02', code: 'IC02', name: 'Dal Makhani', price: 249, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_indian_03', code: 'IC03', name: 'Paneer Butter Masala', price: 299, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_indian_04', code: 'IC04', name: 'Chicken Curry', price: 299, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_indian_05', code: 'IC05', name: 'Palak Paneer', price: 269, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1618449840665-9ed506d73a34?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_indian_06', code: 'IC06', name: 'Naan (Butter)', price: 49, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_indian_07', code: 'IC07', name: 'Roti (Tandoori)', price: 35, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1587459420077-07ab57ed3d22?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_indian_08', code: 'IC08', name: 'Chicken Korma', price: 329, category: 'Indian Main Course', image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=300&q=80', gstPercent: 5, availability: true },

  // ---- MORE BEVERAGES ----
  { id: 'p_bev_11', code: 'BV11', name: 'Masala Chai', price: 69, category: 'Beverages', image: 'https://images.unsplash.com/photo-1563822249366-3efb23b8e0c9?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_bev_12', code: 'BV12', name: 'Fresh Orange Juice', price: 149, category: 'Beverages', image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_bev_13', code: 'BV13', name: 'Watermelon Juice', price: 119, category: 'Beverages', image: 'https://images.unsplash.com/photo-1523371292516-6b284784cc89?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_bev_14', code: 'BV14', name: 'Coke / Sprite (Can)', price: 55, category: 'Beverages', image: 'https://images.unsplash.com/photo-1629203851122-3726ec8cb81c?w=300&q=80', gstPercent: 5, availability: true },
  { id: 'p_bev_15', code: 'BV15', name: 'Mineral Water (1L)', price: 40, category: 'Beverages', image: 'https://images.unsplash.com/photo-1580927752452-89d86da3fa0a?w=300&q=80', gstPercent: 5, availability: true },

  // ---- MORE DESSERTS ----
  { id: 'p_dessert_07', code: 'DS07', name: 'Rasmalai', price: 179, category: 'Desserts', image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_dessert_08', code: 'DS08', name: 'Kheer (Rice Pudding)', price: 149, category: 'Desserts', image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&q=80', gstPercent: 5, availability: true },

  // ---- MORE COMBO OFFERS ----
  { id: 'p_combo_06', code: 'CB06', name: 'Indian Thali', price: 399, category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=300&q=80', gstPercent: 5, availability: true, favorite: true },
  { id: 'p_combo_07', code: 'CB07', name: 'Date Night Special (2 Pax)', price: 1299, category: 'Combo Offers', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=300&q=80', gstPercent: 5, availability: true },
];

// ============================================================
// SEED LOYALTY REWARDS
// ============================================================
export const DEFAULT_REWARDS: LoyaltyReward[] = [
  {
    id: 'rew_01', title: 'Free Garlic Bread', pointsRequired: 100,
    type: 'item', value: 129, minBillAmount: 300, isLargeReward: false,
    rewardItemId: 'p_app_03', rewardItemName: 'Garlic Bread',
  },
  {
    id: 'rew_02', title: '₹100 Off', pointsRequired: 200,
    type: 'flat', value: 100, minBillAmount: 500, isLargeReward: false,
  },
  {
    id: 'rew_03', title: 'Free Chocolate Lava Cake', pointsRequired: 150,
    type: 'item', value: 249, minBillAmount: 400, isLargeReward: false,
    rewardItemId: 'p_dessert_01', rewardItemName: 'Chocolate Lava Cake',
  },
  {
    id: 'rew_04', title: '15% Discount', pointsRequired: 350,
    type: 'percentage', value: 15, minBillAmount: 800, isLargeReward: true,
  },
  {
    id: 'rew_05', title: '₹250 Off', pointsRequired: 500,
    type: 'flat', value: 250, minBillAmount: 1000, isLargeReward: true,
  },
  {
    id: 'rew_06', title: 'Free Classic Cheeseburger', pointsRequired: 120,
    type: 'item', value: 249, minBillAmount: 350, isLargeReward: false,
    rewardItemId: 'p_burger_01', rewardItemName: 'Classic Cheeseburger',
  },
  {
    id: 'rew_07', title: '25% Discount', pointsRequired: 700,
    type: 'percentage', value: 25, minBillAmount: 1200, isLargeReward: true,
  },
  {
    id: 'rew_08', title: 'Free Large Pizza', pointsRequired: 450,
    type: 'item', value: 599, minBillAmount: 900, isLargeReward: true,
    rewardItemId: 'p_pizza_04', rewardItemName: 'Veggie Supreme Pizza',
  },
  {
    id: 'rew_09', title: 'Free French Fries', pointsRequired: 80,
    type: 'item', value: 149, minBillAmount: 250, isLargeReward: false,
    rewardItemId: 'p_app_01', rewardItemName: 'French Fries',
  },
  {
    id: 'rew_10', title: '10% Discount', pointsRequired: 250,
    type: 'percentage', value: 10, minBillAmount: 600, isLargeReward: false,
  },
  {
    id: 'rew_11', title: 'Free Chicken Wings', pointsRequired: 200,
    type: 'item', value: 299, minBillAmount: 500, isLargeReward: false,
    rewardItemId: 'p_app_04', rewardItemName: 'Chicken Wings (6 pcs)',
  },
  {
    id: 'rew_12', title: 'Free Chicken Biryani', pointsRequired: 180,
    type: 'item', value: 349, minBillAmount: 450, isLargeReward: false,
    rewardItemId: 'p_rice_01', rewardItemName: 'Chicken Biryani',
  },
  {
    id: 'rew_13', title: '₹500 Off', pointsRequired: 1000,
    type: 'flat', value: 500, minBillAmount: 2000, isLargeReward: true,
  },
];

// ============================================================
// SEED CUSTOMERS — 8 regulars with purchase history
// ============================================================
const sampleBillItem = (prod: Product, qty: number): CartItem => ({
  id: `${prod.id}_none`,
  product: prod,
  quantity: qty,
  price: prod.price,
});

export const DEFAULT_CUSTOMERS: Customer[] = [
  {
    phone: '9876543210', name: 'Aarav Mehta', email: 'aarav.mehta@email.com',
    isNew: false, visits: 12, points: 450, birthday: '1992-04-15',
    lastVisit: '2026-07-18', notes: 'Prefers window seating. Allergic to peanuts.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_001', invoiceNumber: 'INV-2026-1001', ticketNumber: 'TK-1001', date: '2026-07-18', grandTotal: 847, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[0], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
      { id: 'hist_002', invoiceNumber: 'INV-2026-1005', ticketNumber: 'TK-1005', date: '2026-07-10', grandTotal: 1298, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[20], 2), sampleBillItem(DEFAULT_PRODUCTS[14], 1)],
        pointsEarned: 13, pointsRedeemed: 100, redeemedRewardTitle: 'Free Garlic Bread' },
      { id: 'hist_041', invoiceNumber: 'INV-2026-1071', ticketNumber: 'TK-1071', date: '2026-07-05', grandTotal: 801, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[9], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 1), sampleBillItem(DEFAULT_PRODUCTS[15], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '8765432109', name: 'Priya Kapoor', email: 'priya.k@email.com',
    isNew: false, visits: 8, points: 320, lastVisit: '2026-07-19',
    notes: 'Regular lunch customer. Loves spicy food.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_003', invoiceNumber: 'INV-2026-1002', ticketNumber: 'TK-1002', date: '2026-07-19', grandTotal: 578, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[7], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 1), sampleBillItem(DEFAULT_PRODUCTS[19], 1)],
        pointsEarned: 6, pointsRedeemed: 0 },
      { id: 'hist_004', invoiceNumber: 'INV-2026-1008', ticketNumber: 'TK-1008', date: '2026-07-05', grandTotal: 1499, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[25], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 2)],
        pointsEarned: 15, pointsRedeemed: 0 },
      { id: 'hist_042', invoiceNumber: 'INV-2026-1072', ticketNumber: 'TK-1072', date: '2026-06-29', grandTotal: 779, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[25], 1), sampleBillItem(DEFAULT_PRODUCTS[45], 1), sampleBillItem(DEFAULT_PRODUCTS[36], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '7654321098', name: 'Vikram Singh', email: 'vikram.s@email.com',
    isNew: false, visits: 15, points: 680, birthday: '1988-11-03',
    lastVisit: '2026-07-17',
    notes: 'VIP customer. Prefers corner booth. Owner knows him.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_005', invoiceNumber: 'INV-2026-1003', ticketNumber: 'TK-1003', date: '2026-07-17', grandTotal: 2348, itemsCount: 6, items: [sampleBillItem(DEFAULT_PRODUCTS[3], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 3), sampleBillItem(DEFAULT_PRODUCTS[26], 1), sampleBillItem(DEFAULT_PRODUCTS[12], 1)],
        pointsEarned: 23, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off' },
      { id: 'hist_022', invoiceNumber: 'INV-2026-1027', ticketNumber: 'TK-1027', date: '2026-07-08', grandTotal: 843, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[59], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2), sampleBillItem(DEFAULT_PRODUCTS[60], 1), sampleBillItem(DEFAULT_PRODUCTS[67], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
      { id: 'hist_033', invoiceNumber: 'INV-2026-1063', ticketNumber: 'TK-1063', date: '2026-07-01', grandTotal: 1076, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[30], 1), sampleBillItem(DEFAULT_PRODUCTS[72], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
        pointsEarned: 11, pointsRedeemed: 100, redeemedRewardTitle: '₹100 Off' },
    ],
  },
  {
    phone: '6543210987', name: 'Ananya Gupta', email: 'ananya.g@email.com',
    isNew: false, visits: 3, points: 85, lastVisit: '2026-07-15',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_006', invoiceNumber: 'INV-2026-1010', ticketNumber: 'TK-1010', date: '2026-07-15', grandTotal: 448, itemsCount: 2, items: [sampleBillItem(DEFAULT_PRODUCTS[1], 1), sampleBillItem(DEFAULT_PRODUCTS[14], 1)],
        pointsEarned: 4, pointsRedeemed: 0 },
      { id: 'hist_023', invoiceNumber: 'INV-2026-1028', ticketNumber: 'TK-1028', date: '2026-07-06', grandTotal: 669, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[0], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 1), sampleBillItem(DEFAULT_PRODUCTS[16], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
      { id: 'hist_034', invoiceNumber: 'INV-2026-1064', ticketNumber: 'TK-1064', date: '2026-07-02', grandTotal: 823, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[49], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '5432109876', name: 'Rahul Verma', email: 'rahul.v@email.com',
    isNew: false, visits: 7, points: 240, lastVisit: '2026-07-14',
    notes: 'Frequently orders delivery. Lives in Sector 12.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_007', invoiceNumber: 'INV-2026-1012', ticketNumber: 'TK-1012', date: '2026-07-14', grandTotal: 678, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[5], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[16], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
      { id: 'hist_024', invoiceNumber: 'INV-2026-1029', ticketNumber: 'TK-1029', date: '2026-07-06', grandTotal: 840, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[6], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[70], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
      { id: 'hist_035', invoiceNumber: 'INV-2026-1065', ticketNumber: 'TK-1065', date: '2026-06-28', grandTotal: 923, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[25], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 1)],
        pointsEarned: 9, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '4321098765', name: 'Sneha Patel', email: 'sneha.p@email.com',
    isNew: false, visits: 20, points: 920, birthday: '1995-07-22',
    lastVisit: '2026-07-12',
    notes: 'Frequent diner. Has a history of billing disputes. BLOCKED until resolved.',
    isBlocked: true,
    purchaseHistory: [
      { id: 'hist_008', invoiceNumber: 'INV-2026-1015', ticketNumber: 'TK-1015', date: '2026-07-12', grandTotal: 1876, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[26], 1), sampleBillItem(DEFAULT_PRODUCTS[19], 2), sampleBillItem(DEFAULT_PRODUCTS[10], 1)],
        pointsEarned: 19, pointsRedeemed: 0 },
      { id: 'hist_025', invoiceNumber: 'INV-2026-1030', ticketNumber: 'TK-1030', date: '2026-07-04', grandTotal: 888, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[11], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2), sampleBillItem(DEFAULT_PRODUCTS[35], 1)],
        pointsEarned: 9, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '3210987654', name: 'Arjun Nair', email: 'arjun.n@email.com',
    isNew: false, visits: 5, points: 180, lastVisit: '2026-07-11',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_009', invoiceNumber: 'INV-2026-1018', ticketNumber: 'TK-1018', date: '2026-07-11', grandTotal: 598, itemsCount: 2, items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
        pointsEarned: 6, pointsRedeemed: 0 },
      { id: 'hist_026', invoiceNumber: 'INV-2026-1031', ticketNumber: 'TK-1031', date: '2026-07-03', grandTotal: 691, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[5], 1), sampleBillItem(DEFAULT_PRODUCTS[23], 1), sampleBillItem(DEFAULT_PRODUCTS[14], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
      { id: 'hist_036', invoiceNumber: 'INV-2026-1066', ticketNumber: 'TK-1066', date: '2026-06-25', grandTotal: 769, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[8], 1), sampleBillItem(DEFAULT_PRODUCTS[32], 1), sampleBillItem(DEFAULT_PRODUCTS[68], 1)],
        pointsEarned: 8, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '2109876543', name: 'Diya Sharma', email: 'diya.s@email.com',
    isNew: false, visits: 10, points: 410, birthday: '2000-12-10',
    lastVisit: '2026-07-09',
    notes: 'College student. Loves desserts. Often orders with friends.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_010', invoiceNumber: 'INV-2026-1020', ticketNumber: 'TK-1020', date: '2026-07-09', grandTotal: 897, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[18], 2), sampleBillItem(DEFAULT_PRODUCTS[14], 2), sampleBillItem(DEFAULT_PRODUCTS[6], 1)],
        pointsEarned: 9, pointsRedeemed: 150, redeemedRewardTitle: 'Free Chocolate Lava Cake' },
      { id: 'hist_027', invoiceNumber: 'INV-2026-1032', ticketNumber: 'TK-1032', date: '2026-07-01', grandTotal: 944, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[20], 2), sampleBillItem(DEFAULT_PRODUCTS[15], 2)],
        pointsEarned: 9, pointsRedeemed: 0 },
      { id: 'hist_037', invoiceNumber: 'INV-2026-1067', ticketNumber: 'TK-1067', date: '2026-06-22', grandTotal: 866, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[42], 1), sampleBillItem(DEFAULT_PRODUCTS[33], 1), sampleBillItem(DEFAULT_PRODUCTS[72], 2)],
        pointsEarned: 9, pointsRedeemed: 0 },
    ],
  },

  // ---- ADDITIONAL CUSTOMERS ----
  {
    phone: '9988776655', name: 'Kavita Joshi', email: 'kavita.j@email.com',
    isNew: false, visits: 25, points: 1250, birthday: '1985-03-28',
    lastVisit: '2026-07-20',
    notes: 'Very loyal customer. Orders every weekend. Prefers family seating.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_011', invoiceNumber: 'INV-2026-1022', ticketNumber: 'TK-1022', date: '2026-07-20', grandTotal: 2156, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[44], 2), sampleBillItem(DEFAULT_PRODUCTS[45], 1), sampleBillItem(DEFAULT_PRODUCTS[40], 1), sampleBillItem(DEFAULT_PRODUCTS[33], 1)],
        pointsEarned: 22, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off' },
      { id: 'hist_012', invoiceNumber: 'INV-2026-1016', ticketNumber: 'TK-1016', date: '2026-07-13', grandTotal: 1847, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[29], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 1)],
        pointsEarned: 18, pointsRedeemed: 0 },
      { id: 'hist_043', invoiceNumber: 'INV-2026-1073', ticketNumber: 'TK-1073', date: '2026-07-06', grandTotal: 2432, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[48], 1), sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[34], 2)],
        pointsEarned: 24, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off' },
    ],
  },
  {
    phone: '8877665544', name: 'Rohan Desai', email: 'rohan.d@email.com',
    isNew: false, visits: 6, points: 190, lastVisit: '2026-07-16',
    notes: 'Office worker nearby. Orders delivery for lunch frequently.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_013', invoiceNumber: 'INV-2026-1017', ticketNumber: 'TK-1017', date: '2026-07-16', grandTotal: 618, itemsCount: 2, items: [sampleBillItem(DEFAULT_PRODUCTS[37], 1), sampleBillItem(DEFAULT_PRODUCTS[30], 1)],
        pointsEarned: 6, pointsRedeemed: 0 },
      { id: 'hist_028', invoiceNumber: 'INV-2026-1033', ticketNumber: 'TK-1033', date: '2026-07-07', grandTotal: 669, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[56], 1), sampleBillItem(DEFAULT_PRODUCTS[37], 1), sampleBillItem(DEFAULT_PRODUCTS[46], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
      { id: 'hist_038', invoiceNumber: 'INV-2026-1068', ticketNumber: 'TK-1068', date: '2026-06-30', grandTotal: 594, itemsCount: 2, items: [sampleBillItem(DEFAULT_PRODUCTS[27], 1), sampleBillItem(DEFAULT_PRODUCTS[71], 1)],
        pointsEarned: 6, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '7766554433', name: 'Meera Iyer', email: 'meera.i@email.com',
    isNew: false, visits: 18, points: 760, birthday: '1990-09-15',
    lastVisit: '2026-07-15',
    notes: 'Vegetarian. Loves paneer dishes and salads.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_014', invoiceNumber: 'INV-2026-1019', ticketNumber: 'TK-1019', date: '2026-07-15', grandTotal: 1347, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[46], 2), sampleBillItem(DEFAULT_PRODUCTS[47], 1)],
        pointsEarned: 13, pointsRedeemed: 100, redeemedRewardTitle: 'Free Garlic Bread' },
      { id: 'hist_015', invoiceNumber: 'INV-2026-1011', ticketNumber: 'TK-1011', date: '2026-07-08', grandTotal: 876, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[37], 1), sampleBillItem(DEFAULT_PRODUCTS[34], 1), sampleBillItem(DEFAULT_PRODUCTS[40], 1)],
        pointsEarned: 9, pointsRedeemed: 0 },
      { id: 'hist_044', invoiceNumber: 'INV-2026-1074', ticketNumber: 'TK-1074', date: '2026-07-01', grandTotal: 899, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[61], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2), sampleBillItem(DEFAULT_PRODUCTS[55], 1), sampleBillItem(DEFAULT_PRODUCTS[50], 1)],
        pointsEarned: 9, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '6655443322', name: 'Sunil Thakur', email: 'sunil.t@email.com',
    isNew: false, visits: 4, points: 110, lastVisit: '2026-07-14',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_016', invoiceNumber: 'INV-2026-1021', ticketNumber: 'TK-1021', date: '2026-07-14', grandTotal: 748, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[36], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[18], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
      { id: 'hist_029', invoiceNumber: 'INV-2026-1034', ticketNumber: 'TK-1034', date: '2026-07-05', grandTotal: 691, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[3], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[36], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
      { id: 'hist_039', invoiceNumber: 'INV-2026-1069', ticketNumber: 'TK-1069', date: '2026-06-20', grandTotal: 720, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[62], 1), sampleBillItem(DEFAULT_PRODUCTS[65], 3), sampleBillItem(DEFAULT_PRODUCTS[60], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '5544332211', name: 'Neha Gupta', email: 'neha.g@email.com',
    isNew: false, visits: 22, points: 1100, birthday: '1993-11-07',
    lastVisit: '2026-07-13',
    notes: 'Long-time customer. BLOCKED due to frequent order cancellations and refund demands.',
    isBlocked: true,
    purchaseHistory: [
      { id: 'hist_017', invoiceNumber: 'INV-2026-1023', ticketNumber: 'TK-1023', date: '2026-07-13', grandTotal: 2350, itemsCount: 6, items: [sampleBillItem(DEFAULT_PRODUCTS[42], 2), sampleBillItem(DEFAULT_PRODUCTS[24], 3), sampleBillItem(DEFAULT_PRODUCTS[33], 1)],
        pointsEarned: 24, pointsRedeemed: 0 },
      { id: 'hist_030', invoiceNumber: 'INV-2026-1035', ticketNumber: 'TK-1035', date: '2026-07-07', grandTotal: 989, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[39], 1), sampleBillItem(DEFAULT_PRODUCTS[31], 1), sampleBillItem(DEFAULT_PRODUCTS[35], 1)],
        pointsEarned: 10, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '4433221100', name: 'Aditya Khanna', email: 'aditya.k@email.com',
    isNew: false, visits: 9, points: 380, lastVisit: '2026-07-12',
    notes: 'Regular weekend diner. Brings family. Prefers the corner table.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_018', invoiceNumber: 'INV-2026-1024', ticketNumber: 'TK-1024', date: '2026-07-12', grandTotal: 1588, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[38], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 2)],
        pointsEarned: 16, pointsRedeemed: 150, redeemedRewardTitle: 'Free Chocolate Lava Cake' },
      { id: 'hist_031', invoiceNumber: 'INV-2026-1036', ticketNumber: 'TK-1036', date: '2026-07-04', grandTotal: 1096, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[38], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 2)],
        pointsEarned: 11, pointsRedeemed: 0 },
      { id: 'hist_040', invoiceNumber: 'INV-2026-1070', ticketNumber: 'TK-1070', date: '2026-06-27', grandTotal: 1245, itemsCount: 4, items: [sampleBillItem(DEFAULT_PRODUCTS[39], 1), sampleBillItem(DEFAULT_PRODUCTS[30], 1), sampleBillItem(DEFAULT_PRODUCTS[18], 1), sampleBillItem(DEFAULT_PRODUCTS[37], 1)],
        pointsEarned: 12, pointsRedeemed: 100, redeemedRewardTitle: 'Free Garlic Bread' },
    ],
  },
  {
    phone: '3322110099', name: 'Pooja Reddy', email: 'pooja.r@email.com',
    isNew: false, visits: 14, points: 560, birthday: '1997-06-19',
    lastVisit: '2026-07-11',
    notes: 'Regular customer. Frequently orders Chicken Biryani and Garlic Bread.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_019', invoiceNumber: 'INV-2026-1025', ticketNumber: 'TK-1025', date: '2026-07-11', grandTotal: 967, itemsCount: 3, items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2), sampleBillItem(DEFAULT_PRODUCTS[15], 1)],
        pointsEarned: 10, pointsRedeemed: 0 },
      { id: 'hist_020', invoiceNumber: 'INV-2026-1014', ticketNumber: 'TK-1014', date: '2026-07-04', grandTotal: 1835, itemsCount: 5, items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[26], 2), sampleBillItem(DEFAULT_PRODUCTS[14], 2)],
        pointsEarned: 18, pointsRedeemed: 0 },
      { id: 'hist_045', invoiceNumber: 'INV-2026-1075', ticketNumber: 'TK-1075', date: '2026-06-26', grandTotal: 788, itemsCount: 6, items: [sampleBillItem(DEFAULT_PRODUCTS[66], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2), sampleBillItem(DEFAULT_PRODUCTS[21], 1), sampleBillItem(DEFAULT_PRODUCTS[67], 2)],
        pointsEarned: 8, pointsRedeemed: 0 },
    ],
  },
  {
    phone: '8877001122', name: 'Karan Malhotra', email: 'karan.m@email.com',
    isNew: false, visits: 2, points: 45, lastVisit: '2026-07-10',
    notes: 'New customer. Tried the Family Feast and loved it.',
    isBlocked: false,
    purchaseHistory: [
      { id: 'hist_021', invoiceNumber: 'INV-2026-1026', ticketNumber: 'TK-1026', date: '2026-07-10', grandTotal: 1049, itemsCount: 1, items: [sampleBillItem(DEFAULT_PRODUCTS[29], 1)],
        pointsEarned: 10, pointsRedeemed: 0 },
      { id: 'hist_032', invoiceNumber: 'INV-2026-1037', ticketNumber: 'TK-1037', date: '2026-07-02', grandTotal: 659, itemsCount: 2, items: [sampleBillItem(DEFAULT_PRODUCTS[27], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
        pointsEarned: 7, pointsRedeemed: 0 },
    ],
  },
];

// ============================================================
// SEED EMPLOYEES — 5 across all roles
// ============================================================
export const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'emp_owner', username: 'owner', name: 'Rajesh Kumar', role: 'Owner', pin: '1111', status: 'Active', lastLogin: '2026-07-20 09:15 AM' },
  { id: 'emp_manager', username: 'manager', name: 'Vansh Patel', role: 'Manager', pin: '2222', status: 'Active', lastLogin: '2026-07-20 08:30 AM' },
  { id: 'emp_cashier1', username: 'cashier', name: 'Ravi Singh', role: 'Cashier', pin: '3333', status: 'Active', lastLogin: '2026-07-20 10:00 AM' },
  { id: 'emp_cashier2', username: 'priya', name: 'Priya Sharma', role: 'Cashier', pin: '4444', status: 'Active', lastLogin: '2026-07-19 02:00 PM' },
  { id: 'emp_cashier3', username: 'amit', name: 'Amit Verma', role: 'Cashier', pin: '5555', status: 'Inactive', lastLogin: '2026-07-15 11:30 AM' },

  // ---- ADDITIONAL EMPLOYEES ----
  { id: 'emp_cashier4', username: 'neha', name: 'Neha Kapoor', role: 'Cashier', pin: '6666', status: 'Active', lastLogin: '2026-07-20 10:45 AM' },
  { id: 'emp_cashier5', username: 'deepak', name: 'Deepak Yadav', role: 'Cashier', pin: '7777', status: 'Active', lastLogin: '2026-07-19 09:00 AM' },
  { id: 'emp_manager2', username: 'sunita', name: 'Sunita Rao', role: 'Manager', pin: '8888', status: 'Active', lastLogin: '2026-07-20 07:45 AM' },
  { id: 'emp_chef1', username: 'chef', name: 'Arvind Singh', role: 'Manager', pin: '9999', status: 'Active', lastLogin: '2026-07-20 06:30 AM' },
];

// ============================================================
// VISIT MILESTONES
// ============================================================
const DEFAULT_VISIT_MILESTONES: VisitMilestone[] = [
  { id: 'milestone_5', visits: 5, rewardItemId: 'p_app_03', rewardItemName: 'Garlic Bread' },
  { id: 'milestone_10', visits: 10, rewardItemId: 'p_dessert_01', rewardItemName: 'Chocolate Lava Cake' },
  { id: 'milestone_15', visits: 15, rewardItemId: 'p_burger_01', rewardItemName: 'Classic Cheeseburger' },    { id: 'milestone_20', visits: 20, rewardItemId: 'p_combo_02', rewardItemName: 'Pizza Combo' },
  { id: 'milestone_25', visits: 25, rewardItemId: 'p_combo_05', rewardItemName: 'Party Platter (4 Pax)' },
  { id: 'milestone_30', visits: 30, rewardItemId: 'p_rice_01', rewardItemName: 'Chicken Biryani' },
];

// ============================================================
// DEFAULT SYSTEM SETTINGS — fully configured
// ============================================================
export const DEFAULT_SETTINGS: SystemSettings = {
  restaurantName: 'The Royal Bistro & Pizzeria',
  gstin: '27AAAAA1111A1Z1',
  address: 'Shop No. 12, Ground Floor, Fluent Horizon Plaza, Opp. Metro Station, Mumbai 400001',
  phone: '+91 22 2200 4400',
  currency: 'INR',
  currencySymbol: '₹',
  defaultTaxRate: 5,
  loyaltyPointsPerDollar: 1,
  pointsNeededForOneUnitCurrency: 10,
  visitThresholdForBonus: 5,
  bonusPointsPerVisit: 15,
  printSize: '80mm',
  brandingColor: '#004ac6',
  autoPrintReceipt: true,
  otpSimulationEnabled: true,
  visitMilestones: DEFAULT_VISIT_MILESTONES,
  invoicePrefix: 'INV-',
  invoiceStartingNumber: 1024,
  invoiceSuffix: '-26',
  showCustomerNameOnReceipt: true,
  showLoyaltyPointsOnReceipt: true,
  showQrCodeOnReceipt: true,
  showDiscountBreakdownOnReceipt: true,
  printCategoryHeaders: true,
  showItemModifiers: true,
  showOrderTime: true,
  showTableNumber: true,
  printerRoutingRules: [
    { id: 'rule_kitchen', categoryGroup: 'All Food Items', destinationPrinter: 'Kitchen (192.168.1.150)' },
    { id: 'rule_beverage', categoryGroup: 'Beverages', destinationPrinter: 'Beverage Station (192.168.1.151)' },
  ],
  sidebarLogoUrl: '',
  printLogoOnReceipt: true,
  roundOffTotal: true,
  groupItemsInKOT: true,
  kotFooterNote: 'Cook with passion! Serve with love!',
  receiptFooterMessage: '🎉 THANK YOU FOR DINING WITH US! 🎉\nVisit again for more delicious moments!',
  receiptFooterImageUrl: '',
  showTaxSummaryOnReceipt: true,
  showLoyaltyPointsEarnedOnReceipt: true,
  moduleSettings: {
    enableTableService: true,
    enableWaiterManagement: true,
    enableReservations: false,
    enableQROrdering: false,
    enableDeliveryModule: true,
    enableOnlineOrders: true,
    enableKitchenDisplay: true,
    enableLoyalty: true,
  },
};

// ============================================================
// SEED HISTORICAL BILLS — for Reports & Dashboard
// ============================================================
export const DEFAULT_BILLS: Bill[] = [
  {
    id: 'bill_seed_01', invoiceNumber: 'INV-2026-1001', ticketNumber: 'TK-1001',
    date: '2026-07-18', time: '12:35:22 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[0], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 1)],
    subtotal: 727, discount: 0, gst: 36, grandTotal: 763,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '9876543210', customerName: 'Aarav Mehta',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_02', invoiceNumber: 'INV-2026-1002', ticketNumber: 'TK-1002',
    date: '2026-07-19', time: '01:15:45 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[7], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 1), sampleBillItem(DEFAULT_PRODUCTS[19], 1)],
    subtotal: 578, discount: 0, gst: 29, grandTotal: 607,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '8765432109', customerName: 'Priya Kapoor',
    pointsEarned: 6, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_03', invoiceNumber: 'INV-2026-1003', ticketNumber: 'TK-1003',
    date: '2026-07-17', time: '08:25:10 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[3], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 3), sampleBillItem(DEFAULT_PRODUCTS[26], 1), sampleBillItem(DEFAULT_PRODUCTS[12], 1)],
    subtotal: 2598, discount: 250, gst: 130, grandTotal: 2478,
    paymentMethod: 'Split', orderType: 'Dine In',
    customerPhone: '7654321098', customerName: 'Vikram Singh',
    splitDetails: { cashAmount: 1000, cardAmount: 1478, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 23, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off',
  },
  {
    id: 'bill_seed_04', invoiceNumber: 'INV-2026-1004', ticketNumber: 'TK-1004',
    date: '2026-07-16', time: '07:45:30 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[20], 1), sampleBillItem(DEFAULT_PRODUCTS[14], 1)],
    subtotal: 847, discount: 0, gst: 42, grandTotal: 889,
    paymentMethod: 'Card', orderType: 'Takeaway',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_05', invoiceNumber: 'INV-2026-1005', ticketNumber: 'TK-1005',
    date: '2026-07-15', time: '12:10:05 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[28], 1), sampleBillItem(DEFAULT_PRODUCTS[5], 2)],
    subtotal: 997, discount: 129, gst: 50, grandTotal: 918,
    paymentMethod: 'UPI', orderType: 'Delivery',
    customerPhone: '5432109876', customerName: 'Rahul Verma',
    pointsEarned: 9, pointsRedeemed: 100, redeemedRewardTitle: 'Free Garlic Bread',
  },
  {
    id: 'bill_seed_06', invoiceNumber: 'INV-2026-1006', ticketNumber: 'TK-1006',
    date: '2026-07-14', time: '09:30:15 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[18], 2), sampleBillItem(DEFAULT_PRODUCTS[8], 1)],
    subtotal: 1146, discount: 0, gst: 57, grandTotal: 1203,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '2109876543', customerName: 'Diya Sharma',
    pointsEarned: 12, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_07', invoiceNumber: 'INV-2026-1007', ticketNumber: 'TK-1007',
    date: '2026-07-13', time: '08:00:00 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[11], 1), sampleBillItem(DEFAULT_PRODUCTS[25], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 2)],
    subtotal: 1356, discount: 0, gst: 68, grandTotal: 1424,
    paymentMethod: 'Wallet', orderType: 'Swiggy',
    pointsEarned: 14, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_08', invoiceNumber: 'INV-2026-1008', ticketNumber: 'TK-1008',
    date: '2026-07-12', time: '02:20:00 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[29], 1), sampleBillItem(DEFAULT_PRODUCTS[6], 2), sampleBillItem(DEFAULT_PRODUCTS[21], 1)],
    subtotal: 1396, discount: 0, gst: 70, grandTotal: 1466,
    paymentMethod: 'Split', orderType: 'Dine In',
    customerPhone: '4321098765', customerName: 'Sneha Patel',
    splitDetails: { cashAmount: 800, cardAmount: 666, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 15, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_09', invoiceNumber: 'INV-2026-1009', ticketNumber: 'TK-1009',
    date: '2026-07-11', time: '11:45:30 AM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 2)],
    subtotal: 757, discount: 0, gst: 38, grandTotal: 795,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '3210987654', customerName: 'Arjun Nair',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_10', invoiceNumber: 'INV-2026-1010', ticketNumber: 'TK-1010',
    date: '2026-07-10', time: '07:55:10 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[1], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 2), sampleBillItem(DEFAULT_PRODUCTS[15], 1)],
    subtotal: 696, discount: 0, gst: 35, grandTotal: 731,
    paymentMethod: 'Cash', orderType: 'Zomato',
    pointsEarned: 7, pointsRedeemed: 0,
  },

  // ---- ADDITIONAL HISTORICAL BILLS (seeded for richer reports) ----
  {
    id: 'bill_seed_11', invoiceNumber: 'INV-2026-1011', ticketNumber: 'TK-1011',
    date: '2026-07-09', time: '01:20:33 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[37], 1), sampleBillItem(DEFAULT_PRODUCTS[34], 1), sampleBillItem(DEFAULT_PRODUCTS[40], 1)],
    subtotal: 837, discount: 0, gst: 42, grandTotal: 879,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '7766554433', customerName: 'Meera Iyer',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_12', invoiceNumber: 'INV-2026-1012', ticketNumber: 'TK-1012',
    date: '2026-07-08', time: '08:45:10 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[3], 2), sampleBillItem(DEFAULT_PRODUCTS[24], 1), sampleBillItem(DEFAULT_PRODUCTS[15], 2)],
    subtotal: 1426, discount: 0, gst: 71, grandTotal: 1497,
    paymentMethod: 'Card', orderType: 'Dine In',
    pointsEarned: 15, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_13', invoiceNumber: 'INV-2026-1013', ticketNumber: 'TK-1013',
    date: '2026-07-07', time: '12:15:00 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[31], 1), sampleBillItem(DEFAULT_PRODUCTS[9], 1)],
    subtotal: 997, discount: 0, gst: 50, grandTotal: 1047,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '9988776655', customerName: 'Kavita Joshi',
    pointsEarned: 10, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_14', invoiceNumber: 'INV-2026-1014', ticketNumber: 'TK-1014',
    date: '2026-07-06', time: '07:30:22 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[5], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 2)],
    subtotal: 1154, discount: 129, gst: 51, grandTotal: 1076,
    paymentMethod: 'Split', orderType: 'Dine In',
    customerPhone: '4433221100', customerName: 'Aditya Khanna',
    splitDetails: { cashAmount: 500, cardAmount: 576, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 11, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_15', invoiceNumber: 'INV-2026-1015', ticketNumber: 'TK-1015',
    date: '2026-07-05', time: '01:50:45 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[47], 1), sampleBillItem(DEFAULT_PRODUCTS[7], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
    subtotal: 577, discount: 0, gst: 29, grandTotal: 606,
    paymentMethod: 'UPI', orderType: 'Delivery',
    pointsEarned: 6, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_16', invoiceNumber: 'INV-2026-1016', ticketNumber: 'TK-1016',
    date: '2026-07-04', time: '09:10:30 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[26], 2), sampleBillItem(DEFAULT_PRODUCTS[14], 2)],
    subtotal: 1196, discount: 0, gst: 60, grandTotal: 1256,
    paymentMethod: 'Wallet', orderType: 'Swiggy',
    customerPhone: '3322110099', customerName: 'Pooja Reddy',
    pointsEarned: 13, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_17', invoiceNumber: 'INV-2026-1017', ticketNumber: 'TK-1017',
    date: '2026-07-03', time: '12:40:15 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[27], 1), sampleBillItem(DEFAULT_PRODUCTS[35], 1)],
    subtotal: 698, discount: 0, gst: 35, grandTotal: 733,
    paymentMethod: 'Card', orderType: 'Takeaway',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_18', invoiceNumber: 'INV-2026-1018', ticketNumber: 'TK-1018',
    date: '2026-07-02', time: '08:05:55 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[38], 1), sampleBillItem(DEFAULT_PRODUCTS[16], 1), sampleBillItem(DEFAULT_PRODUCTS[40], 1)],
    subtotal: 758, discount: 0, gst: 38, grandTotal: 796,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '8877001122', customerName: 'Karan Malhotra',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_19', invoiceNumber: 'INV-2026-1019', ticketNumber: 'TK-1019',
    date: '2026-07-01', time: '07:25:40 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[46], 1), sampleBillItem(DEFAULT_PRODUCTS[10], 1), sampleBillItem(DEFAULT_PRODUCTS[33], 2)],
    subtotal: 886, discount: 0, gst: 44, grandTotal: 930,
    paymentMethod: 'UPI', orderType: 'Zomato',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_20', invoiceNumber: 'INV-2026-1020', ticketNumber: 'TK-1020',
    date: '2026-06-30', time: '12:30:10 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[30], 1), sampleBillItem(DEFAULT_PRODUCTS[43], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
    subtotal: 647, discount: 0, gst: 32, grandTotal: 679,
    paymentMethod: 'Cash', orderType: 'Dine In',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_21', invoiceNumber: 'INV-2026-1021', ticketNumber: 'TK-1021',
    date: '2026-06-28', time: '09:15:20 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[49], 1), sampleBillItem(DEFAULT_PRODUCTS[39], 1)],
    subtotal: 608, discount: 0, gst: 30, grandTotal: 638,
    paymentMethod: 'Card', orderType: 'Dine In',
    pointsEarned: 6, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_22', invoiceNumber: 'INV-2026-1022', ticketNumber: 'TK-1022',
    date: '2026-06-26', time: '01:10:33 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[45], 1), sampleBillItem(DEFAULT_PRODUCTS[41], 1), sampleBillItem(DEFAULT_PRODUCTS[14], 1)],
    subtotal: 747, discount: 0, gst: 37, grandTotal: 784,
    paymentMethod: 'Split', orderType: 'Takeaway',
    splitDetails: { cashAmount: 400, cardAmount: 384, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_23', invoiceNumber: 'INV-2026-1023', ticketNumber: 'TK-1023',
    date: '2026-06-24', time: '08:50:00 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[42], 2), sampleBillItem(DEFAULT_PRODUCTS[24], 3)],
    subtotal: 1605, discount: 250, gst: 80, grandTotal: 1435,
    paymentMethod: 'UPI', orderType: 'Delivery',
    customerPhone: '5544332211', customerName: 'Neha Gupta',
    pointsEarned: 14, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off',
  },
  {
    id: 'bill_seed_24', invoiceNumber: 'INV-2026-1024', ticketNumber: 'TK-1024',
    date: '2026-06-22', time: '07:00:15 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[38], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 2)],
    subtotal: 1254, discount: 249, gst: 63, grandTotal: 1068,
    paymentMethod: 'Split', orderType: 'Dine In',
    customerPhone: '4433221100', customerName: 'Aditya Khanna',
    splitDetails: { cashAmount: 600, cardAmount: 468, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 11, pointsRedeemed: 150, redeemedRewardTitle: 'Free Chocolate Lava Cake',
  },
  {
    id: 'bill_seed_25', invoiceNumber: 'INV-2026-1025', ticketNumber: 'TK-1025',
    date: '2026-06-20', time: '12:25:45 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[0], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 1)],
    subtotal: 537, discount: 0, gst: 27, grandTotal: 564,
    paymentMethod: 'Cash', orderType: 'Dine In',
    pointsEarned: 6, pointsRedeemed: 0,
  },

  // ---- BILLS MATCHING NEW PURCHASE HISTORY (hist_022–hist_045) ----
  {
    id: 'bill_seed_26', invoiceNumber: 'INV-2026-1027', ticketNumber: 'TK-1027',
    date: '2026-07-08', time: '08:15:30 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[59], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2), sampleBillItem(DEFAULT_PRODUCTS[60], 1), sampleBillItem(DEFAULT_PRODUCTS[67], 1)],
    subtotal: 765, discount: 0, gst: 38, grandTotal: 843,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '7654321098', customerName: 'Vikram Singh',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_27', invoiceNumber: 'INV-2026-1063', ticketNumber: 'TK-1063',
    date: '2026-07-01', time: '07:45:00 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[30], 1), sampleBillItem(DEFAULT_PRODUCTS[72], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
    subtotal: 976, discount: 100, gst: 49, grandTotal: 1076,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '7654321098', customerName: 'Vikram Singh',
    pointsEarned: 11, pointsRedeemed: 100, redeemedRewardTitle: '₹100 Off',
  },
  {
    id: 'bill_seed_28', invoiceNumber: 'INV-2026-1028', ticketNumber: 'TK-1028',
    date: '2026-07-06', time: '01:30:15 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[0], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 1), sampleBillItem(DEFAULT_PRODUCTS[16], 1)],
    subtotal: 607, discount: 0, gst: 30, grandTotal: 669,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '6543210987', customerName: 'Ananya Gupta',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_29', invoiceNumber: 'INV-2026-1064', ticketNumber: 'TK-1064',
    date: '2026-07-02', time: '12:10:45 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[49], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
    subtotal: 747, discount: 0, gst: 37, grandTotal: 823,
    paymentMethod: 'UPI', orderType: 'Takeaway',
    customerPhone: '6543210987', customerName: 'Ananya Gupta',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_30', invoiceNumber: 'INV-2026-1029', ticketNumber: 'TK-1029',
    date: '2026-07-06', time: '08:05:22 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[6], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[70], 1)],
    subtotal: 762, discount: 0, gst: 38, grandTotal: 840,
    paymentMethod: 'UPI', orderType: 'Delivery',
    customerPhone: '5432109876', customerName: 'Rahul Verma',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_31', invoiceNumber: 'INV-2026-1065', ticketNumber: 'TK-1065',
    date: '2026-06-28', time: '08:30:00 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[25], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 1)],
    subtotal: 837, discount: 0, gst: 42, grandTotal: 923,
    paymentMethod: 'Cash', orderType: 'Delivery',
    customerPhone: '5432109876', customerName: 'Rahul Verma',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_32', invoiceNumber: 'INV-2026-1030', ticketNumber: 'TK-1030',
    date: '2026-07-04', time: '03:15:30 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[11], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2), sampleBillItem(DEFAULT_PRODUCTS[35], 1)],
    subtotal: 806, discount: 0, gst: 40, grandTotal: 888,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '4321098765', customerName: 'Sneha Patel',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_33', invoiceNumber: 'INV-2026-1031', ticketNumber: 'TK-1031',
    date: '2026-07-03', time: '01:45:10 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[5], 1), sampleBillItem(DEFAULT_PRODUCTS[23], 1), sampleBillItem(DEFAULT_PRODUCTS[14], 1)],
    subtotal: 627, discount: 0, gst: 31, grandTotal: 691,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '3210987654', customerName: 'Arjun Nair',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_34', invoiceNumber: 'INV-2026-1066', ticketNumber: 'TK-1066',
    date: '2026-06-25', time: '08:20:00 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[8], 1), sampleBillItem(DEFAULT_PRODUCTS[32], 1), sampleBillItem(DEFAULT_PRODUCTS[68], 1)],
    subtotal: 697, discount: 0, gst: 35, grandTotal: 769,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '3210987654', customerName: 'Arjun Nair',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_35', invoiceNumber: 'INV-2026-1032', ticketNumber: 'TK-1032',
    date: '2026-07-01', time: '04:30:25 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[20], 2), sampleBillItem(DEFAULT_PRODUCTS[15], 2)],
    subtotal: 856, discount: 0, gst: 43, grandTotal: 944,
    paymentMethod: 'Wallet', orderType: 'Dine In',
    customerPhone: '2109876543', customerName: 'Diya Sharma',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_36', invoiceNumber: 'INV-2026-1067', ticketNumber: 'TK-1067',
    date: '2026-06-22', time: '05:10:30 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[42], 1), sampleBillItem(DEFAULT_PRODUCTS[33], 1), sampleBillItem(DEFAULT_PRODUCTS[72], 2)],
    subtotal: 786, discount: 0, gst: 39, grandTotal: 866,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '2109876543', customerName: 'Diya Sharma',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_37', invoiceNumber: 'INV-2026-1073', ticketNumber: 'TK-1073',
    date: '2026-07-06', time: '08:45:00 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[48], 1), sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[34], 2)],
    subtotal: 2206, discount: 250, gst: 110, grandTotal: 2432,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '9988776655', customerName: 'Kavita Joshi',
    pointsEarned: 24, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off',
  },
  {
    id: 'bill_seed_38', invoiceNumber: 'INV-2026-1033', ticketNumber: 'TK-1033',
    date: '2026-07-07', time: '01:10:15 PM',
    cashierName: 'Neha Kapoor', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[56], 1), sampleBillItem(DEFAULT_PRODUCTS[37], 1), sampleBillItem(DEFAULT_PRODUCTS[46], 1)],
    subtotal: 607, discount: 0, gst: 30, grandTotal: 669,
    paymentMethod: 'UPI', orderType: 'Delivery',
    customerPhone: '8877665544', customerName: 'Rohan Desai',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_39', invoiceNumber: 'INV-2026-1068', ticketNumber: 'TK-1068',
    date: '2026-06-30', time: '12:55:40 PM',
    cashierName: 'Deepak Yadav', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[27], 1), sampleBillItem(DEFAULT_PRODUCTS[71], 1)],
    subtotal: 539, discount: 0, gst: 27, grandTotal: 594,
    paymentMethod: 'Cash', orderType: 'Delivery',
    customerPhone: '8877665544', customerName: 'Rohan Desai',
    pointsEarned: 6, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_40', invoiceNumber: 'INV-2026-1074', ticketNumber: 'TK-1074',
    date: '2026-07-01', time: '01:20:30 PM',
    cashierName: 'Sunita Rao', cashierRole: 'Manager',
    items: [sampleBillItem(DEFAULT_PRODUCTS[61], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2), sampleBillItem(DEFAULT_PRODUCTS[55], 1), sampleBillItem(DEFAULT_PRODUCTS[50], 1)],
    subtotal: 815, discount: 0, gst: 41, grandTotal: 899,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '7766554433', customerName: 'Meera Iyer',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_41', invoiceNumber: 'INV-2026-1034', ticketNumber: 'TK-1034',
    date: '2026-07-05', time: '08:10:20 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[3], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 1), sampleBillItem(DEFAULT_PRODUCTS[36], 1)],
    subtotal: 627, discount: 0, gst: 31, grandTotal: 691,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '6655443322', customerName: 'Sunil Thakur',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_42', invoiceNumber: 'INV-2026-1069', ticketNumber: 'TK-1069',
    date: '2026-06-20', time: '08:35:15 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[62], 1), sampleBillItem(DEFAULT_PRODUCTS[65], 3), sampleBillItem(DEFAULT_PRODUCTS[60], 1)],
    subtotal: 653, discount: 0, gst: 33, grandTotal: 720,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '6655443322', customerName: 'Sunil Thakur',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_43', invoiceNumber: 'INV-2026-1035', ticketNumber: 'TK-1035',
    date: '2026-07-07', time: '03:25:40 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[39], 1), sampleBillItem(DEFAULT_PRODUCTS[31], 1), sampleBillItem(DEFAULT_PRODUCTS[35], 1)],
    subtotal: 897, discount: 0, gst: 45, grandTotal: 989,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '5544332211', customerName: 'Neha Gupta',
    pointsEarned: 10, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_44', invoiceNumber: 'INV-2026-1036', ticketNumber: 'TK-1036',
    date: '2026-07-04', time: '08:00:10 PM',
    cashierName: 'Neha Kapoor', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[38], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 2)],
    subtotal: 995, discount: 0, gst: 50, grandTotal: 1096,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '4433221100', customerName: 'Aditya Khanna',
    pointsEarned: 11, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_45', invoiceNumber: 'INV-2026-1070', ticketNumber: 'TK-1070',
    date: '2026-06-27', time: '07:50:30 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[39], 1), sampleBillItem(DEFAULT_PRODUCTS[30], 1), sampleBillItem(DEFAULT_PRODUCTS[18], 1), sampleBillItem(DEFAULT_PRODUCTS[37], 1)],
    subtotal: 1186, discount: 100, gst: 59, grandTotal: 1245,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '4433221100', customerName: 'Aditya Khanna',
    pointsEarned: 12, pointsRedeemed: 100, redeemedRewardTitle: 'Free Garlic Bread',
  },
  {
    id: 'bill_seed_46', invoiceNumber: 'INV-2026-1037', ticketNumber: 'TK-1037',
    date: '2026-07-02', time: '02:15:00 PM',
    cashierName: 'Deepak Yadav', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[27], 1), sampleBillItem(DEFAULT_PRODUCTS[13], 1)],
    subtotal: 598, discount: 0, gst: 30, grandTotal: 659,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '8877001122', customerName: 'Karan Malhotra',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_47', invoiceNumber: 'INV-2026-1071', ticketNumber: 'TK-1071',
    date: '2026-07-05', time: '01:55:20 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[9], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 1), sampleBillItem(DEFAULT_PRODUCTS[15], 1)],
    subtotal: 727, discount: 0, gst: 36, grandTotal: 801,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '9876543210', customerName: 'Aarav Mehta',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_48', invoiceNumber: 'INV-2026-1072', ticketNumber: 'TK-1072',
    date: '2026-06-29', time: '01:30:00 PM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[25], 1), sampleBillItem(DEFAULT_PRODUCTS[45], 1), sampleBillItem(DEFAULT_PRODUCTS[36], 1)],
    subtotal: 707, discount: 0, gst: 35, grandTotal: 779,
    paymentMethod: 'Cash', orderType: 'Dine In',
    customerPhone: '8765432109', customerName: 'Priya Kapoor',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_seed_49', invoiceNumber: 'INV-2026-1075', ticketNumber: 'TK-1075',
    date: '2026-06-26', time: '08:10:45 PM',
    cashierName: 'Sunita Rao', cashierRole: 'Manager',
    items: [sampleBillItem(DEFAULT_PRODUCTS[66], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2), sampleBillItem(DEFAULT_PRODUCTS[21], 1), sampleBillItem(DEFAULT_PRODUCTS[67], 2)],
    subtotal: 714, discount: 0, gst: 36, grandTotal: 788,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '3322110099', customerName: 'Pooja Reddy',
    pointsEarned: 8, pointsRedeemed: 0,
  },

  // ---- TODAY'S BILLS (2026-07-21) for instant Reports data ----
  {
    id: 'bill_today_01', invoiceNumber: 'INV-2026-1101', ticketNumber: 'TK-1101',
    date: '2026-07-21', time: '09:15:30 AM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[0], 2), sampleBillItem(DEFAULT_PRODUCTS[4], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 2)],
    subtotal: 1346, discount: 0, gst: 67, grandTotal: 1413,
    paymentMethod: 'UPI', orderType: 'Dine In',
    customerPhone: '9876543210', customerName: 'Aarav Mehta',
    pointsEarned: 14, pointsRedeemed: 0,
  },
  {
    id: 'bill_today_02', invoiceNumber: 'INV-2026-1102', ticketNumber: 'TK-1102',
    date: '2026-07-21', time: '10:30:00 AM',
    cashierName: 'Neha Kapoor', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[5], 1), sampleBillItem(DEFAULT_PRODUCTS[22], 2)],
    subtotal: 647, discount: 0, gst: 32, grandTotal: 679,
    paymentMethod: 'Cash', orderType: 'Takeaway',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_today_03', invoiceNumber: 'INV-2026-1103', ticketNumber: 'TK-1103',
    date: '2026-07-21', time: '11:45:15 AM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2), sampleBillItem(DEFAULT_PRODUCTS[15], 1)],
    subtotal: 1196, discount: 129, gst: 53, grandTotal: 1120,
    paymentMethod: 'Card', orderType: 'Delivery',
    customerPhone: '9988776655', customerName: 'Kavita Joshi',
    pointsEarned: 11, pointsRedeemed: 100, redeemedRewardTitle: 'Free Garlic Bread',
  },
  {
    id: 'bill_today_04', invoiceNumber: 'INV-2026-1104', ticketNumber: 'TK-1104',
    date: '2026-07-21', time: '12:20:40 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[3], 1), sampleBillItem(DEFAULT_PRODUCTS[26], 2), sampleBillItem(DEFAULT_PRODUCTS[14], 2)],
    subtotal: 1345, discount: 0, gst: 67, grandTotal: 1412,
    paymentMethod: 'Split', orderType: 'Dine In',
    customerPhone: '3322110099', customerName: 'Pooja Reddy',
    splitDetails: { cashAmount: 700, cardAmount: 712, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 14, pointsRedeemed: 0,
  },
  {
    id: 'bill_today_05', invoiceNumber: 'INV-2026-1105', ticketNumber: 'TK-1105',
    date: '2026-07-21', time: '01:05:50 PM',
    cashierName: 'Deepak Yadav', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[7], 1), sampleBillItem(DEFAULT_PRODUCTS[17], 1), sampleBillItem(DEFAULT_PRODUCTS[18], 1)],
    subtotal: 1007, discount: 0, gst: 50, grandTotal: 1057,
    paymentMethod: 'UPI', orderType: 'Swiggy',
    customerPhone: '8765432109', customerName: 'Priya Kapoor',
    pointsEarned: 11, pointsRedeemed: 0,
  },
  {
    id: 'bill_today_06', invoiceNumber: 'INV-2026-1106', ticketNumber: 'TK-1106',
    date: '2026-07-21', time: '02:30:25 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[46], 1), sampleBillItem(DEFAULT_PRODUCTS[10], 1), sampleBillItem(DEFAULT_PRODUCTS[40], 1)],
    subtotal: 847, discount: 0, gst: 42, grandTotal: 889,
    paymentMethod: 'Wallet', orderType: 'Zomato',
    pointsEarned: 9, pointsRedeemed: 0,
  },
  {
    id: 'bill_today_07', invoiceNumber: 'INV-2026-1107', ticketNumber: 'TK-1107',
    date: '2026-07-21', time: '04:15:00 PM',
    cashierName: 'Sunita Rao', cashierRole: 'Manager',
    items: [sampleBillItem(DEFAULT_PRODUCTS[38], 2), sampleBillItem(DEFAULT_PRODUCTS[22], 2), sampleBillItem(DEFAULT_PRODUCTS[16], 1)],
    subtotal: 1454, discount: 100, gst: 68, grandTotal: 1422,
    paymentMethod: 'Card', orderType: 'Dine In',
    customerPhone: '4433221100', customerName: 'Aditya Khanna',
    pointsEarned: 14, pointsRedeemed: 100, redeemedRewardTitle: '₹100 Off',
  },

  // ---- YESTERDAY'S BILLS (2026-07-20) for richer 7-day trends ----
  {
    id: 'bill_yest_01', invoiceNumber: 'INV-2026-1081', ticketNumber: 'TK-1081',
    date: '2026-07-20', time: '10:00:00 AM',
    cashierName: 'Priya Sharma', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[59], 1), sampleBillItem(DEFAULT_PRODUCTS[64], 2)],
    subtotal: 657, discount: 0, gst: 33, grandTotal: 690,
    paymentMethod: 'Cash', orderType: 'Dine In',
    pointsEarned: 7, pointsRedeemed: 0,
  },
  {
    id: 'bill_yest_02', invoiceNumber: 'INV-2026-1082', ticketNumber: 'TK-1082',
    date: '2026-07-20', time: '12:30:15 PM',
    cashierName: 'Ravi Singh', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[44], 1), sampleBillItem(DEFAULT_PRODUCTS[45], 1), sampleBillItem(DEFAULT_PRODUCTS[40], 1), sampleBillItem(DEFAULT_PRODUCTS[33], 1)],
    subtotal: 1496, discount: 250, gst: 62, grandTotal: 1308,
    paymentMethod: 'Split', orderType: 'Dine In',
    customerPhone: '9988776655', customerName: 'Kavita Joshi',
    splitDetails: { cashAmount: 600, cardAmount: 708, upiAmount: 0, walletAmount: 0 },
    pointsEarned: 13, pointsRedeemed: 250, redeemedRewardTitle: '₹250 Off',
  },
  {
    id: 'bill_yest_03', invoiceNumber: 'INV-2026-1083', ticketNumber: 'TK-1083',
    date: '2026-07-20', time: '07:45:30 PM',
    cashierName: 'Neha Kapoor', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[2], 1), sampleBillItem(DEFAULT_PRODUCTS[24], 2)],
    subtotal: 747, discount: 0, gst: 37, grandTotal: 784,
    paymentMethod: 'UPI', orderType: 'Delivery',
    customerPhone: '7654321098', customerName: 'Vikram Singh',
    pointsEarned: 8, pointsRedeemed: 0,
  },
  {
    id: 'bill_yest_04', invoiceNumber: 'INV-2026-1084', ticketNumber: 'TK-1084',
    date: '2026-07-20', time: '09:10:00 PM',
    cashierName: 'Deepak Yadav', cashierRole: 'Cashier',
    items: [sampleBillItem(DEFAULT_PRODUCTS[42], 1), sampleBillItem(DEFAULT_PRODUCTS[27], 1)],
    subtotal: 548, discount: 0, gst: 27, grandTotal: 575,
    paymentMethod: 'Card', orderType: 'Takeaway',
    pointsEarned: 6, pointsRedeemed: 0,
  },
];

// ============================================================
// DERIVED CATEGORIES — extracted from products
// ============================================================
export const DEFAULT_CATEGORIES: string[] = [
  'Pizzas', 'Burgers', 'Pasta', 'Beverages', 'Desserts', 'Appetizers', 'Soups', 'Wraps & Rolls', 'Indian Main Course', 'Rice & Biryani', 'Combo Offers', 'Salads',
];

// ============================================================
// Daily Sales Tracker — computed from today's bills in localStorage
// ============================================================
export function computeDailySales(bills: Bill[], currencySymbol: string): DailySales {
  const today = new Date();
  const tzoffset = today.getTimezoneOffset() * 60000;
  const todayStr = new Date(Date.now() - tzoffset).toISOString().slice(0, 10);

  const todayBills = bills.filter(b => b.date === todayStr);
  const revenue = todayBills.reduce((s, b) => s + b.grandTotal, 0);
  const orders = todayBills.length;
  const itemsSold = todayBills.reduce((s, b) => s + b.items.reduce((si, item) => si + item.quantity, 0), 0);
  const totalDiscount = todayBills.reduce((s, b) => s + b.discount, 0);
  const totalGst = todayBills.reduce((s, b) => s + b.gst, 0);
  const avgOrder = orders > 0 ? revenue / orders : 0;

  // Payment breakdown
  const payMap: Record<string, { amount: number; count: number }> = {};
  todayBills.forEach(b => {
    if (!payMap[b.paymentMethod]) payMap[b.paymentMethod] = { amount: 0, count: 0 };
    payMap[b.paymentMethod].amount += b.grandTotal;
    payMap[b.paymentMethod].count += 1;
  });
  const paymentBreakdown = Object.entries(payMap).map(([method, data]) => ({ method, ...data }));

  // Category breakdown
  const catMap: Record<string, { qty: number; revenue: number }> = {};
  todayBills.forEach(b => b.items.forEach(item => {
    const cat = item.product.category;
    if (!catMap[cat]) catMap[cat] = { qty: 0, revenue: 0 };
    catMap[cat].qty += item.quantity;
    catMap[cat].revenue += item.price * item.quantity;
  }));
  const categoryBreakdown = Object.entries(catMap).map(([category, data]) => ({ category, ...data }));

  // Top items
  const itemMap: Record<string, { qty: number; revenue: number }> = {};
  todayBills.forEach(b => b.items.forEach(item => {
    const name = item.product.name;
    if (!itemMap[name]) itemMap[name] = { qty: 0, revenue: 0 };
    itemMap[name].qty += item.quantity;
    itemMap[name].revenue += item.price * item.quantity;
  }));
  const topItems = Object.entries(itemMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // Cashier performance
  const cashierMap: Record<string, { orders: number; revenue: number }> = {};
  todayBills.forEach(b => {
    if (!cashierMap[b.cashierName]) cashierMap[b.cashierName] = { orders: 0, revenue: 0 };
    cashierMap[b.cashierName].orders += 1;
    cashierMap[b.cashierName].revenue += b.grandTotal;
  });
  const cashierPerformance = Object.entries(cashierMap).map(([name, data]) => ({ name, ...data }));

  return {
    date: todayStr,
    totalRevenue: revenue,
    totalOrders: orders,
    totalItemsSold: itemsSold,
    totalDiscount,
    totalGst,
    averageOrderValue: avgOrder,
    paymentBreakdown,
    categoryBreakdown,
    topItems,
    cashierPerformance,
  };
}

/**
 * Build a fresh activity feed from today's bills and recent actions.
 * Stored in localStorage as 'pos_activity_feed' and updated after each action.
 */
export function buildActivityFeed(bills: Bill[], limit = 20): ActivityEntry[] {
  const today = new Date();
  const tzoffset = today.getTimezoneOffset() * 60000;
  const todayStr = new Date(Date.now() - tzoffset).toISOString().slice(0, 10);

  const todayBills = bills.filter(b => b.date === todayStr);

  const entries: ActivityEntry[] = todayBills.slice(0, limit).map(b => ({
    id: `act_pay_${b.id}`,
    timestamp: b.time,
    type: 'payment',
    title: `Payment of ₹${b.grandTotal.toFixed(2)}`,
    description: `${b.items.reduce((s, i) => s + i.quantity, 0)} items via ${b.paymentMethod}`,
    amount: b.grandTotal,
    currencySymbol: '₹',
    invoiceNumber: b.invoiceNumber,
    cashierName: b.cashierName,
    paymentMethod: b.paymentMethod,
  }));

  return entries.sort((a, b) => {
    // Sort by time descending (most recent first)
    const timeA = a.timestamp.toLowerCase();
    const timeB = b.timestamp.toLowerCase();
    if (timeA < timeB) return 1;
    if (timeA > timeB) return -1;
    return 0;
  }).slice(0, limit);
}

export function getActivityFeed(): ActivityEntry[] {
  try {
    const stored = safeStorage.getItem('pos_activity_feed');
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

export function saveActivityFeed(entries: ActivityEntry[]) {
  safeStorage.setItem('pos_activity_feed', JSON.stringify(entries));
}

// ============================================================
// Safe localStorage wrapper
// ============================================================
const memoryStorage: Record<string, string> = {};

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch (e) {
      console.warn(`LocalStorage blocked or not available for key "${key}". Using in-memory fallback.`, e);
    }
    return memoryStorage[key] || null;
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn(`LocalStorage write blocked or not available for key "${key}". Using in-memory fallback.`, e);
    }
    memoryStorage[key] = value;
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
        return;
      }
    } catch (e) {
      console.warn(`LocalStorage remove blocked or not available for key "${key}".`, e);
    }
    delete memoryStorage[key];
  },
};

// ============================================================
// Initialize or migrate localStorage database
// ============================================================
function isArrayEmpty(arr: any[] | null | undefined): boolean {
  return !arr || !Array.isArray(arr) || arr.length === 0;
}

export function initializeDB() {
  const isAlreadyInitialized = safeStorage.getItem('pos_initialized_clean_v5');

  if (!isAlreadyInitialized) {
    // Fresh initialization — seed everything
    safeStorage.setItem('pos_products', JSON.stringify(DEFAULT_PRODUCTS));
    safeStorage.setItem('pos_rewards', JSON.stringify(DEFAULT_REWARDS));
    safeStorage.setItem('pos_customers', JSON.stringify(DEFAULT_CUSTOMERS));
    safeStorage.setItem('pos_employees', JSON.stringify(DEFAULT_EMPLOYEES));
    safeStorage.setItem('pos_settings', JSON.stringify(DEFAULT_SETTINGS));
    safeStorage.setItem('pos_bills', JSON.stringify(DEFAULT_BILLS));
    safeStorage.setItem('pos_categories', JSON.stringify(DEFAULT_CATEGORIES));
    safeStorage.setItem('pos_sessions', JSON.stringify([]));
    safeStorage.setItem('pos_initialized_clean_v5', 'true');

    // Clean up old version markers
    safeStorage.removeItem('pos_initialized');
    safeStorage.removeItem('pos_initialized_clean');
    safeStorage.removeItem('pos_initialized_clean_v3');
    safeStorage.removeItem('pos_initialized_clean_v4');
    safeStorage.removeItem('pos_current_employee');
  } else {
    // Already initialized — fill in any empty collections with defaults
    // This handles migration from old versions that had empty data arrays
    try {
      const products = JSON.parse(safeStorage.getItem('pos_products') || '[]');
      if (isArrayEmpty(products)) {
        safeStorage.setItem('pos_products', JSON.stringify(DEFAULT_PRODUCTS));
      }

      const rewards = JSON.parse(safeStorage.getItem('pos_rewards') || '[]');
      if (isArrayEmpty(rewards)) {
        safeStorage.setItem('pos_rewards', JSON.stringify(DEFAULT_REWARDS));
      }

      const customers = JSON.parse(safeStorage.getItem('pos_customers') || '[]');
      if (isArrayEmpty(customers)) {
        safeStorage.setItem('pos_customers', JSON.stringify(DEFAULT_CUSTOMERS));
      }

      const employees = JSON.parse(safeStorage.getItem('pos_employees') || '[]');
      if (isArrayEmpty(employees)) {
        safeStorage.setItem('pos_employees', JSON.stringify(DEFAULT_EMPLOYEES));
      }

      const bills = JSON.parse(safeStorage.getItem('pos_bills') || '[]');
      if (isArrayEmpty(bills)) {
        safeStorage.setItem('pos_bills', JSON.stringify(DEFAULT_BILLS));
      }

      const categories = JSON.parse(safeStorage.getItem('pos_categories') || '[]');
      if (isArrayEmpty(categories)) {
        safeStorage.setItem('pos_categories', JSON.stringify(DEFAULT_CATEGORIES));
      }

      // Merge settings — don't replace existing settings, just merge in missing keys
      const existingSettings = JSON.parse(safeStorage.getItem('pos_settings') || '{}');
      if (!existingSettings || Object.keys(existingSettings).length === 0 || !existingSettings.restaurantName) {
        safeStorage.setItem('pos_settings', JSON.stringify(DEFAULT_SETTINGS));
      } else if (!existingSettings.visitMilestones || existingSettings.visitMilestones.length === 0) {
        // Add visit milestones to existing settings
        existingSettings.visitMilestones = DEFAULT_VISIT_MILESTONES;
        safeStorage.setItem('pos_settings', JSON.stringify(existingSettings));
      }
    } catch (e) {
      console.warn('Error during data migration, resetting to defaults.', e);
      safeStorage.setItem('pos_products', JSON.stringify(DEFAULT_PRODUCTS));
      safeStorage.setItem('pos_rewards', JSON.stringify(DEFAULT_REWARDS));
      safeStorage.setItem('pos_customers', JSON.stringify(DEFAULT_CUSTOMERS));
      safeStorage.setItem('pos_employees', JSON.stringify(DEFAULT_EMPLOYEES));
      safeStorage.setItem('pos_settings', JSON.stringify(DEFAULT_SETTINGS));
      safeStorage.setItem('pos_bills', JSON.stringify(DEFAULT_BILLS));
      safeStorage.setItem('pos_categories', JSON.stringify(DEFAULT_CATEGORIES));
    }
  }
}

// ============================================================
// Data access helpers
// ============================================================
export function getDBData<T>(key: string, defaultValue: T): T {
  initializeDB();
  const data = safeStorage.getItem(key);
  if (!data) return defaultValue;
  try {
    const parsed = JSON.parse(data);
    if (key === 'pos_settings') {
      if (!parsed || Object.keys(parsed).length === 0 || !parsed.restaurantName) {
        return { ...defaultValue, ...parsed } as unknown as T;
      }
    }
    return parsed;
  } catch (e) {
    return defaultValue;
  }
}

export function setDBData<T>(key: string, data: T): void {
  safeStorage.setItem(key, JSON.stringify(data));
}
