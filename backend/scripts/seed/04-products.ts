/**
 * 04-products.ts — Creates 60+ menu items across 10 categories with
 * voice aliases, search aliases, variants, and combo products.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, ProductSeedResult, oid } from './types';
import { daysAgo, pick } from './helpers';

interface ProductDef {
  name: string; code: string; price: number; category: string;
  gstPercent: number; taxClassification: string; unit: string;
  image: string; voiceAliases: string[]; searchAliases: string[];
  isCombo?: boolean; comboPrice?: number; comboComponents?: string[];
  variants?: { name: string; priceDelta: number }[];
}

const MENU_PRODUCTS: ProductDef[] = [
  // ─── Starters ────────────────────────────────────────────────
  { name: 'Paneer Tikka', code: 'STR001', price: 199, category: 'Starters', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-paneer-tikka.jpg', voiceAliases: ['paneer tikka', 'पनीर टिक्का', 'paneer tika'], searchAliases: ['tikka', 'paneer starter'], variants: [{ name: 'Half', priceDelta: -60 }, { name: 'Full', priceDelta: 0 }] },
  { name: 'Veg Spring Roll', code: 'STR002', price: 149, category: 'Starters', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-spring-roll.jpg', voiceAliases: ['spring roll', 'स्प्रिंग रोल', 'veg spring roll'], searchAliases: ['spring', 'roll'] },
  { name: 'Chicken Seekh Kebab', code: 'STR003', price: 249, category: 'Starters', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-kebab.jpg', voiceAliases: ['seekh kebab', 'सीख कबाब', 'chicken kebab'], searchAliases: ['kebab', 'chicken'] },
  { name: 'Aloo Tikki Chaat', code: 'STR004', price: 99, category: 'Starters', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-aloo-tikki.jpg', voiceAliases: ['aloo tikki', 'आलू टिक्की', 'aloo tikki chaat'], searchAliases: ['tikki', 'chaat', 'aloo'] },
  { name: 'Paneer Pakoda', code: 'STR005', price: 159, category: 'Starters', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-paneer-pakoda.jpg', voiceAliases: ['paneer pakoda', 'पनीर पकोड़ा', 'paneer pakora'], searchAliases: ['pakoda', 'pakora'] },

  // ─── Main Course ─────────────────────────────────────────────
  { name: 'Paneer Kadhai', code: 'MNC001', price: 280, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-paneer-kadhai.jpg', voiceAliases: ['paneer kadhai', 'पनीर कढ़ाई', 'paneer kadhi'], searchAliases: ['kadhai', 'kadhi', 'paneer main'], variants: [{ name: 'Half', priceDelta: -100 }, { name: 'Full', priceDelta: 0 }] },
  { name: 'Paneer Butter Masala', code: 'MNC002', price: 260, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-paneer-butter-masala.jpg', voiceAliases: ['paneer butter masala', 'पनीर बटर मसाला', 'PBM'], searchAliases: ['butter masala', 'paneer butter'] },
  { name: 'Shahi Paneer', code: 'MNC003', price: 270, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-shahi-paneer.jpg', voiceAliases: ['shahi paneer', 'शाही पनीर'], searchAliases: ['shahi', 'royal paneer'] },
  { name: 'Dal Makhani', code: 'MNC004', price: 199, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-dal-makhani.jpg', voiceAliases: ['dal makhani', 'दाल मखनी', 'dal makhni'], searchAliases: ['dal', 'makhani'] },
  { name: 'Dal Tadka', code: 'MNC005', price: 149, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-dal-tadka.jpg', voiceAliases: ['dal tadka', 'दाल तड़का'], searchAliases: ['tadka', 'yellow dal'] },
  { name: 'Butter Chicken', code: 'MNC006', price: 320, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-butter-chicken.jpg', voiceAliases: ['butter chicken', 'बटर चिकन', 'murgh makhani'], searchAliases: ['chicken curry', 'butter chicken'] },
  { name: 'Chicken Tikka Masala', code: 'MNC007', price: 310, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-chicken-tikka-masala.jpg', voiceAliases: ['chicken tikka masala', 'चिकन टिक्का मसाला'], searchAliases: ['ctm', 'chicken masala'] },
  { name: 'Mutton Rogan Josh', code: 'MNC008', price: 399, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-mutton-rogan.jpg', voiceAliases: ['mutton rogan josh', 'मटन रोगन जोश'], searchAliases: ['rogan', 'mutton curry'] },
  { name: 'Palak Paneer', code: 'MNC009', price: 229, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-palak-paneer.jpg', voiceAliases: ['palak paneer', 'पालक पनीर'], searchAliases: ['palak', 'spinach paneer'] },
  { name: 'Malai Kofta', code: 'MNC010', price: 249, category: 'Main Course', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-malai-kofta.jpg', voiceAliases: ['malai kofta', 'मलाई कोफ्ता'], searchAliases: ['kofta', 'malai'] },

  // ─── Breads ──────────────────────────────────────────────────
  { name: 'Butter Naan', code: 'BRD001', price: 59, category: 'Breads', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-butter-naan.jpg', voiceAliases: ['butter naan', 'बटर नान'], searchAliases: ['naan'] },
  { name: 'Garlic Naan', code: 'BRD002', price: 69, category: 'Breads', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-garlic-naan.jpg', voiceAliases: ['garlic naan', 'गार्लिक नान'], searchAliases: ['garlic', 'naan'] },
  { name: 'Tandoori Roti', code: 'BRD003', price: 35, category: 'Breads', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-tandoori-roti.jpg', voiceAliases: ['tandoori roti', 'तंदूरी रोटी'], searchAliases: ['roti', 'tandoori'] },
  { name: 'Lachha Paratha', code: 'BRD004', price: 55, category: 'Breads', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-lachha-paratha.jpg', voiceAliases: ['lachha paratha', 'लच्छा पराठा'], searchAliases: ['paratha', 'lachha'] },
  { name: 'Kulcha', code: 'BRD005', price: 49, category: 'Breads', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-kulcha.jpg', voiceAliases: ['kulcha', 'कुलचा'], searchAliases: ['kulcha'] },

  // ─── Rice ────────────────────────────────────────────────────
  { name: 'Veg Biryani', code: 'RIC001', price: 189, category: 'Rice', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-veg-biryani.jpg', voiceAliases: ['veg biryani', 'वेज बिरयानी', 'veg biryani'], searchAliases: ['biryani', 'rice'], variants: [{ name: 'Half', priceDelta: -60 }, { name: 'Full', priceDelta: 0 }] },
  { name: 'Chicken Biryani', code: 'RIC002', price: 249, category: 'Rice', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-chicken-biryani.jpg', voiceAliases: ['chicken biryani', 'चिकन बिरयानी'], searchAliases: ['chicken biryani', 'biryani'], variants: [{ name: 'Half', priceDelta: -80 }, { name: 'Full', priceDelta: 0 }] },
  { name: 'Jeera Rice', code: 'RIC003', price: 129, category: 'Rice', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-jeera-rice.jpg', voiceAliases: ['jeera rice', 'जीरा राइस'], searchAliases: ['jeera', 'cumin rice'] },
  { name: 'Fried Rice', code: 'RIC004', price: 159, category: 'Rice', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-fried-rice.jpg', voiceAliases: ['fried rice', 'फ्राइड राइस', 'veg fried rice'], searchAliases: ['fried', 'schezwan rice'] },
  { name: 'Egg Fried Rice', code: 'RIC005', price: 179, category: 'Rice', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-egg-fried-rice.jpg', voiceAliases: ['egg fried rice', 'अंडा फ्राइड राइस'], searchAliases: ['egg rice', 'egg fried'] },

  // ─── Chinese ─────────────────────────────────────────────────
  { name: 'Veg Manchurian', code: 'CHN001', price: 179, category: 'Chinese', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-veg-manchurian.jpg', voiceAliases: ['veg manchurian', 'वेज मंचूरियन'], searchAliases: ['manchurian', 'chilli paneer'] },
  { name: 'Hakka Noodles', code: 'CHN002', price: 159, category: 'Chinese', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-hakka-noodles.jpg', voiceAliases: ['hakka noodles', 'हक्का नूडल्स'], searchAliases: ['noodles', 'hakka'] },
  { name: 'Chilli Paneer', code: 'CHN003', price: 199, category: 'Chinese', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-chilli-paneer.jpg', voiceAliases: ['chilli paneer', 'चिल्ली पनीर'], searchAliases: ['chilli', 'paneer chilli'] },
  { name: 'Manchow Soup', code: 'CHN004', price: 99, category: 'Chinese', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-manchow-soup.jpg', voiceAliases: ['manchow soup', 'मंचाउ सूप'], searchAliases: ['soup', 'manchow'] },
  { name: 'Sweet Corn Soup', code: 'CHN005', price: 89, category: 'Chinese', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-sweet-corn-soup.jpg', voiceAliases: ['sweet corn soup', 'स्वीट कॉर्न सूप'], searchAliases: ['corn soup', 'sweet corn'] },

  // ─── Beverages ───────────────────────────────────────────────
  { name: 'Masala Coke', code: 'BEV001', price: 79, category: 'Beverages', gstPercent: 12, taxClassification: 'beverage', unit: 'pcs', image: '/api/media/demo-masala-coke.jpg', voiceAliases: ['masala coke', 'मसाला कोक'], searchAliases: ['coke', 'masala', 'thums up'] },
  { name: 'Cold Coffee', code: 'BEV002', price: 129, category: 'Beverages', gstPercent: 5, taxClassification: 'beverage', unit: 'pcs', image: '/api/media/demo-cold-coffee.jpg', voiceAliases: ['cold coffee', 'कोल्ड कॉफ़ी'], searchAliases: ['coffee', 'iced coffee'] },
  { name: 'Fresh Lime Soda', code: 'BEV003', price: 69, category: 'Beverages', gstPercent: 5, taxClassification: 'beverage', unit: 'pcs', image: '/api/media/demo-lime-soda.jpg', voiceAliases: ['fresh lime soda', 'नींबू पानी', 'nimbu pani'], searchAliases: ['lime', 'nimbu', 'soda'] },
  { name: 'Mango Lassi', code: 'BEV004', price: 99, category: 'Beverages', gstPercent: 5, taxClassification: 'beverage', unit: 'pcs', image: '/api/media/demo-mango-lassi.jpg', voiceAliases: ['mango lassi', 'आम लस्सी'], searchAliases: ['lassi', 'mango'] },
  { name: 'Masala Chai', code: 'BEV005', price: 39, category: 'Beverages', gstPercent: 5, taxClassification: 'beverage', unit: 'pcs', image: '/api/media/demo-masala-chai.jpg', voiceAliases: ['masala chai', 'मसाला चाय', 'chai'], searchAliases: ['tea', 'chai'] },
  { name: 'Thandai', code: 'BEV006', price: 119, category: 'Beverages', gstPercent: 5, taxClassification: 'beverage', unit: 'pcs', image: '/api/media/demo-thandai.jpg', voiceAliases: ['thandai', 'ठंडाई'], searchAliases: ['thandai', 'cold milk'] },
  { name: 'Coke', code: 'BEV007', price: 40, category: 'Beverages', gstPercent: 12, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-coke.jpg', voiceAliases: ['coke', 'कोक', 'cold drink', 'coca cola'], searchAliases: ['coke', 'cola', 'cold drink'] },
  { name: 'Pepsi', code: 'BEV008', price: 40, category: 'Beverages', gstPercent: 12, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-pepsi.jpg', voiceAliases: ['pepsi', 'पेप्सी'], searchAliases: ['pepsi'] },
  { name: 'Sprite', code: 'BEV009', price: 40, category: 'Beverages', gstPercent: 12, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-sprite.jpg', voiceAliases: ['sprite', 'स्प्राइट'], searchAliases: ['sprite', 'limca'] },
  { name: 'Mineral Water', code: 'BEV010', price: 20, category: 'Beverages', gstPercent: 18, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-water.jpg', voiceAliases: ['water', 'पानी', 'mineral water', 'bottled water'], searchAliases: ['water', 'paani', 'bisleri'] },

  // ─── Desserts ────────────────────────────────────────────────
  { name: 'Gulab Jamun', code: 'DES001', price: 99, category: 'Desserts', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-gulab-jamun.jpg', voiceAliases: ['gulab jamun', 'गुलाब जामुन'], searchAliases: ['gulab', 'jamun', 'sweet'] },
  { name: 'Rasgulla', code: 'DES002', price: 89, category: 'Desserts', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-rasgulla.jpg', voiceAliases: ['rasgulla', 'रसगुल्ला'], searchAliases: ['rasgulla', 'bengali sweet'] },
  { name: 'Gajar Ka Halwa', code: 'DES003', price: 119, category: 'Desserts', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-gajar-halwa.jpg', voiceAliases: ['gajar ka halwa', 'गाजर का हलवा', 'carrot halwa'], searchAliases: ['halwa', 'gajar', 'carrot'] },
  { name: 'Kulfi', code: 'DES004', price: 79, category: 'Desserts', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-kulfi.jpg', voiceAliases: ['kulfi', 'कुल्फी'], searchAliases: ['kulfi', 'ice cream'] },
  { name: 'Brownie with Ice Cream', code: 'DES005', price: 159, category: 'Desserts', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-brownie.jpg', voiceAliases: ['brownie', 'ब्राउनी', 'chocolate brownie'], searchAliases: ['brownie', 'chocolate'] },

  // ─── Combos ──────────────────────────────────────────────────
  { name: 'Burger Combo', code: 'CMB001', price: 249, category: 'Combos', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-burger-combo.jpg', voiceAliases: ['burger combo', 'बर्गर कॉम्बो'], searchAliases: ['burger combo', 'meal'], isCombo: true, comboPrice: 249 },
  { name: 'Pizza Combo', code: 'CMB002', price: 399, category: 'Combos', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-pizza-combo.jpg', voiceAliases: ['pizza combo', 'पिज़्ज़ा कॉम्बो'], searchAliases: ['pizza combo', 'pizza meal'], isCombo: true, comboPrice: 399 },
  { name: 'Lunch Thali', code: 'CMB003', price: 299, category: 'Combos', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-lunch-thali.jpg', voiceAliases: ['lunch thali', 'लंच थाली', 'thali'], searchAliases: ['thali', 'lunch', 'meal'], isCombo: true, comboPrice: 299 },
  { name: 'Snacks Combo', code: 'CMB004', price: 199, category: 'Combos', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-snacks-combo.jpg', voiceAliases: ['snacks combo', 'स्नैक्स कॉम्बो'], searchAliases: ['snacks combo', 'evening snacks'], isCombo: true, comboPrice: 199 },

  // ─── Snacks ──────────────────────────────────────────────────
  { name: 'French Fries', code: 'SNK001', price: 129, category: 'Snacks', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-fries.jpg', voiceAliases: ['french fries', 'फ्रेंच फ्राइज़', 'fries'], searchAliases: ['fries', 'chips'] },
  { name: 'Cheese Nachos', code: 'SNK002', price: 169, category: 'Snacks', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-nachos.jpg', voiceAliases: ['nachos', 'चीज़ नैचोस'], searchAliases: ['nachos', 'cheese'] },
  { name: 'Veg Burger', code: 'SNK003', price: 149, category: 'Snacks', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-veg-burger.jpg', voiceAliases: ['veg burger', 'वेज बर्गर'], searchAliases: ['burger', 'veg burger'] },
  { name: 'Cheese Pizza', code: 'SNK004', price: 199, category: 'Snacks', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-cheese-pizza.jpg', voiceAliases: ['cheese pizza', 'चीज़ पिज़्ज़ा'], searchAliases: ['pizza', 'cheese pizza'], variants: [{ name: 'Small', priceDelta: -50 }, { name: 'Medium', priceDelta: 0 }, { name: 'Large', priceDelta: 80 }] },
  { name: 'Garlic Bread', code: 'SNK005', price: 99, category: 'Snacks', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-garlic-bread.jpg', voiceAliases: ['garlic bread', 'गार्लिक ब्रेड'], searchAliases: ['garlic bread', 'bread'] },
  { name: 'Veg Momos', code: 'SNK006', price: 119, category: 'Snacks', gstPercent: 5, taxClassification: 'prepared_food', unit: 'pcs', image: '/api/media/demo-momos.jpg', voiceAliases: ['momos', 'मोमोज', 'veg momos'], searchAliases: ['momos', 'dimsum'] },

  // ─── Packaged Food ───────────────────────────────────────────
  { name: 'Lay\'s Classic', code: 'PKG001', price: 20, category: 'Packaged Food', gstPercent: 18, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-lays.jpg', voiceAliases: ['lays', 'लेज़', 'chips'], searchAliases: ['lays', 'chips', 'wafers'] },
  { name: 'Kurkure', code: 'PKG002', price: 20, category: 'Packaged Food', gstPercent: 18, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-kurkure.jpg', voiceAliases: ['kurkure', 'कुरकुरे'], searchAliases: ['kurkure', 'namkeen'] },
  { name: 'Marie Gold Biscuit', code: 'PKG003', price: 10, category: 'Packaged Food', gstPercent: 18, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-biscuit.jpg', voiceAliases: ['biscuit', 'बिस्कुट', 'marie'], searchAliases: ['biscuit', 'marie', 'parle'] },
  { name: 'KitKat', code: 'PKG004', price: 40, category: 'Packaged Food', gstPercent: 18, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-kitkat.jpg', voiceAliases: ['kitkat', 'किटकैट', 'chocolate'], searchAliases: ['kitkat', 'chocolate', 'nestle'] },
  { name: 'Ferrero Rocher', code: 'PKG005', price: 120, category: 'Packaged Food', gstPercent: 18, taxClassification: 'packaged', unit: 'pcs', image: '/api/media/demo-ferrero.jpg', voiceAliases: ['ferrero', 'फेरेरो'], searchAliases: ['ferrero', 'premium chocolate'] },
];

export async function seedProducts(db: Db, ctx: SeedContext): Promise<ProductSeedResult> {
  console.log('🍽️  Seeding products...');

  const rid = ctx.restaurantId;
  const result: ProductSeedResult = {
    menuItemIds: [], inventoryItemIds: [], comboIds: [], allProductIds: [],
    productByName: new Map(), categoryMap: new Map(), variantIds: [],
  };

  // Insert menu products
  for (const p of MENU_PRODUCTS) {
    const id = oid();
    result.allProductIds.push(id);
    result.productByName.set(p.name, id);

    // Track category
    if (!result.categoryMap.has(p.category)) result.categoryMap.set(p.category, []);
    result.categoryMap.get(p.category)!.push(id);

    if (p.isCombo) {
      result.comboIds.push(id);
    } else {
      result.menuItemIds.push(id);
    }

    await db.collection('products').insertOne({
      _id: id, restaurantId: rid, name: p.name, code: p.code,
      price: p.price, category: p.category, gstPercent: p.gstPercent,
      taxClassification: p.taxClassification, taxSource: 'automatic',
      image: p.image, availability: true, favorite: false,
      currentStock: 0, unit: p.unit, minStock: 0, maxStock: 999,
      reorderLevel: 0, averageCost: 0, isCombo: !!p.isCombo,
      comboPrice: p.comboPrice || 0, isDeleted: false,
      voiceAliases: p.voiceAliases, searchAliases: p.searchAliases,
      learnedAliases: [], aliasUsageCount: 0,
      menuConfig: { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] },
      createdAt: daysAgo(170), updatedAt: new Date(),
    });

    // Insert variants if any
    if (p.variants) {
      for (const v of p.variants) {
        const vid = oid();
        result.variantIds.push(vid);
        await db.collection('productvariants').insertOne({
          _id: vid, productId: id, restaurantId: rid, name: v.name,
          priceDelta: v.priceDelta, isAvailable: true, isDeleted: false,
          createdAt: daysAgo(170), updatedAt: new Date(),
        });
      }
    }
  }

  // ─── Inventory (raw material) products ───────────────────────
  const INVENTORY_ITEMS = [
    { name: 'Paneer', code: 'INV001', price: 320, unit: 'kg', category: 'Dairy', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'City Dairy Suppliers', minStock: 5, reorderLevel: 10, voiceAliases: ['paneer', 'पनीर', 'cottage cheese'], searchAliases: ['paneer', 'cottage cheese'] },
    { name: 'Milk', code: 'INV002', price: 56, unit: 'L', category: 'Dairy', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'City Dairy Suppliers', minStock: 10, reorderLevel: 20, voiceAliases: ['milk', 'दूध'], searchAliases: ['milk', 'doodh'] },
    { name: 'Cream', code: 'INV003', price: 180, unit: 'L', category: 'Dairy', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'City Dairy Suppliers', minStock: 3, reorderLevel: 5, voiceAliases: ['cream', 'क्रीम', 'malai'], searchAliases: ['cream', 'malai', 'fresh cream'] },
    { name: 'Butter', code: 'INV004', price: 250, unit: 'kg', category: 'Dairy', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'Daily Dairy Mart', minStock: 3, reorderLevel: 5, voiceAliases: ['butter', 'मक्खन', 'makhan'], searchAliases: ['butter', 'makhan'] },
    { name: 'Cheese', code: 'INV005', price: 350, unit: 'kg', category: 'Dairy', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'Daily Dairy Mart', minStock: 2, reorderLevel: 4, voiceAliases: ['cheese', 'चीज़'], searchAliases: ['cheese', 'mozzarella'] },
    { name: 'Cashew', code: 'INV006', price: 1200, unit: 'kg', category: 'Dry Fruits', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'Royal Dry Fruits', minStock: 1, reorderLevel: 2, voiceAliases: ['cashew', 'काजू', 'kaju'], searchAliases: ['cashew', 'kaju'] },
    { name: 'Almond', code: 'INV007', price: 1500, unit: 'kg', category: 'Dry Fruits', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'Royal Dry Fruits', minStock: 1, reorderLevel: 2, voiceAliases: ['almond', 'बादाम', 'badam'], searchAliases: ['almond', 'badam'] },
    { name: 'Mushroom', code: 'INV008', price: 120, unit: 'kg', category: 'Vegetables', gstPercent: 5, taxClassification: 'prepared_food', supplier: 'FreshFarm Foods', minStock: 2, reorderLevel: 5, voiceAliases: ['mushroom', 'मशरूम'], searchAliases: ['mushroom', 'dhingri'] },
    { name: 'Tomato', code: 'INV009', price: 40, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 10, reorderLevel: 20, voiceAliases: ['tomato', 'टमाटर', 'tamatar'], searchAliases: ['tomato', 'tamatar'] },
    { name: 'Onion', code: 'INV010', price: 30, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 10, reorderLevel: 20, voiceAliases: ['onion', 'प्याज', 'pyaaz'], searchAliases: ['onion', 'pyaaz'] },
    { name: 'Potato', code: 'INV011', price: 25, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 10, reorderLevel: 20, voiceAliases: ['potato', 'आलू', 'aloo'], searchAliases: ['potato', 'aloo'] },
    { name: 'Capsicum', code: 'INV012', price: 60, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 5, reorderLevel: 10, voiceAliases: ['capsicum', 'शिमला मिर्च', 'capsicum', 'bell pepper'], searchAliases: ['capsicum', 'shimla mirch', 'bell pepper'] },
    { name: 'Ginger', code: 'INV013', price: 80, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 2, reorderLevel: 5, voiceAliases: ['ginger', 'अदरक', 'adrak'], searchAliases: ['ginger', 'adrak'] },
    { name: 'Garlic', code: 'INV014', price: 100, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 2, reorderLevel: 5, voiceAliases: ['garlic', 'लहसुन', 'lahsun'], searchAliases: ['garlic', 'lahsun'] },
    { name: 'Green Chilli', code: 'INV015', price: 80, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 2, reorderLevel: 5, voiceAliases: ['green chilli', 'हरी मिर्च', 'hari mirch'], searchAliases: ['chilli', 'mirch', 'green chilli'] },
    { name: 'Coriander', code: 'INV016', price: 40, unit: 'kg', category: 'Vegetables', gstPercent: 0, taxClassification: 'prepared_food', supplier: 'Green Basket Vegetables', minStock: 2, reorderLevel: 4, voiceAliases: ['coriander', 'धनिया', 'dhaniya'], searchAliases: ['coriander', 'dhaniya', 'hara dhaniya'] },
    { name: 'Rice (Basmati)', code: 'INV017', price: 80, unit: 'kg', category: 'Grains', gstPercent: 5, taxClassification: 'packaged', supplier: 'Natraj Flour Mills', minStock: 20, reorderLevel: 40, voiceAliases: ['rice', 'चावल', 'basmati rice', 'chawal'], searchAliases: ['rice', 'basmati', 'chawal'] },
    { name: 'Wheat Flour (Atta)', code: 'INV018', price: 35, unit: 'kg', category: 'Grains', gstPercent: 0, taxClassification: 'packaged', supplier: 'Natraj Flour Mills', minStock: 15, reorderLevel: 30, voiceAliases: ['flour', 'आटा', 'atta', 'wheat flour'], searchAliases: ['flour', 'atta', 'maida'] },
    { name: 'Maida (Refined Flour)', code: 'INV019', price: 38, unit: 'kg', category: 'Grains', gstPercent: 5, taxClassification: 'packaged', supplier: 'Natraj Flour Mills', minStock: 10, reorderLevel: 20, voiceAliases: ['maida', 'मैदा'], searchAliases: ['maida', 'refined flour'] },
    { name: 'Cooking Oil', code: 'INV020', price: 140, unit: 'L', category: 'Oils', gstPercent: 5, taxClassification: 'packaged', supplier: 'FreshFarm Foods', minStock: 10, reorderLevel: 20, voiceAliases: ['oil', 'तेल', 'cooking oil', 'tel'], searchAliases: ['oil', 'tel', 'sunflower oil'] },
    { name: 'Spice Mix (Garam Masala)', code: 'INV021', price: 300, unit: 'kg', category: 'Spices', gstPercent: 5, taxClassification: 'packaged', supplier: 'Spice Valley Traders', minStock: 1, reorderLevel: 3, voiceAliases: ['garam masala', 'गरम मसाला', 'spice mix'], searchAliases: ['garam masala', 'spice', 'masala'] },
    { name: 'Cumin (Jeera)', code: 'INV022', price: 200, unit: 'kg', category: 'Spices', gstPercent: 5, taxClassification: 'packaged', supplier: 'Spice Valley Traders', minStock: 1, reorderLevel: 2, voiceAliases: ['jeera', 'जीरा', 'cumin'], searchAliases: ['jeera', 'cumin'] },
    { name: 'Turmeric (Haldi)', code: 'INV023', price: 150, unit: 'kg', category: 'Spices', gstPercent: 5, taxClassification: 'packaged', supplier: 'Spice Valley Traders', minStock: 1, reorderLevel: 2, voiceAliases: ['haldi', 'हल्दी', 'turmeric'], searchAliases: ['haldi', 'turmeric'] },
    { name: 'Red Chilli Powder', code: 'INV024', price: 250, unit: 'kg', category: 'Spices', gstPercent: 5, taxClassification: 'packaged', supplier: 'Spice Valley Traders', minStock: 1, reorderLevel: 2, voiceAliases: ['red chilli', 'लाल मिर्च', 'lal mirch'], searchAliases: ['red chilli', 'lal mirch', 'chilli powder'] },
    { name: 'Coke (2L)', code: 'INV025', price: 42, unit: 'pcs', category: 'Beverages', gstPercent: 12, taxClassification: 'packaged', supplier: 'Metro Beverages', minStock: 20, reorderLevel: 40, voiceAliases: ['coke', 'कोक', 'cold drink', 'coca cola'], searchAliases: ['coke', 'cola'] },
    { name: 'Pepsi (2L)', code: 'INV026', price: 42, unit: 'pcs', category: 'Beverages', gstPercent: 12, taxClassification: 'packaged', supplier: 'Metro Beverages', minStock: 20, reorderLevel: 40, voiceAliases: ['pepsi', 'पेप्सी'], searchAliases: ['pepsi'] },
    { name: 'Sprite (2L)', code: 'INV027', price: 42, unit: 'pcs', category: 'Beverages', gstPercent: 12, taxClassification: 'packaged', supplier: 'Metro Beverages', minStock: 15, reorderLevel: 30, voiceAliases: ['sprite', 'स्प्राइट'], searchAliases: ['sprite'] },
    { name: 'Water Bottles (1L)', code: 'INV028', price: 12, unit: 'pcs', category: 'Beverages', gstPercent: 18, taxClassification: 'packaged', supplier: 'Himalayan Water', minStock: 50, reorderLevel: 100, voiceAliases: ['water', 'पानी', 'mineral water'], searchAliases: ['water', 'bisleri', 'mineral'] },
    { name: 'Napkins', code: 'INV029', price: 0.5, unit: 'pcs', category: 'Packaging', gstPercent: 12, taxClassification: 'packaged', supplier: 'Prime Packaging', minStock: 500, reorderLevel: 1000, voiceAliases: ['napkin', 'नैपकिन', 'tissue'], searchAliases: ['napkin', 'tissue', 'tissue paper'] },
    { name: 'Takeaway Containers', code: 'INV030', price: 5, unit: 'pcs', category: 'Packaging', gstPercent: 12, taxClassification: 'packaged', supplier: 'Prime Packaging', minStock: 200, reorderLevel: 500, voiceAliases: ['container', 'डिब्बा', 'box'], searchAliases: ['container', 'box', 'packaging'] },
    { name: 'Paper Bags', code: 'INV031', price: 3, unit: 'pcs', category: 'Packaging', gstPercent: 12, taxClassification: 'packaged', supplier: 'Prime Packaging', minStock: 200, reorderLevel: 500, voiceAliases: ['paper bag', 'कागज़ का बैग'], searchAliases: ['bag', 'paper bag'] },
  ];

  for (const item of INVENTORY_ITEMS) {
    const id = oid();
    result.allProductIds.push(id);
    result.inventoryItemIds.push(id);
    result.productByName.set(item.name, id);

    // Assign random current stock between 50-80% of max
    const maxStock = item.unit === 'pcs' ? item.minStock * 10 : item.minStock * 5;
    const currentStock = Math.round(maxStock * (0.5 + Math.random() * 0.3) * 10) / 10;

    await db.collection('products').insertOne({
      _id: id, restaurantId: rid, name: item.name, code: item.code,
      price: item.price, category: item.category, gstPercent: item.gstPercent,
      taxClassification: item.taxClassification, taxSource: 'automatic',
      image: `/api/media/demo-${item.code.toLowerCase()}.jpg`,
      availability: true, favorite: false, supplier: item.supplier,
      currentStock, unit: item.unit, minStock: item.minStock, maxStock,
      reorderLevel: item.reorderLevel, averageCost: item.price,
      isCombo: false, isDeleted: false,
      voiceAliases: item.voiceAliases, searchAliases: item.searchAliases,
      learnedAliases: [], aliasUsageCount: 0,
      menuConfig: { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] },
      createdAt: daysAgo(170), updatedAt: new Date(),
    });
  }

  console.log(`   ✅ Menu products: ${result.menuItemIds.length}`);
  console.log(`   ✅ Combo products: ${result.comboIds.length}`);
  console.log(`   ✅ Inventory items: ${result.inventoryItemIds.length}`);
  console.log(`   ✅ Variants: ${result.variantIds.length}`);

  return result;
}
