/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Festival Service — Detects upcoming festivals and special occasions
 * based on calendar rules. Uses deterministic date calculations — no AI needed.
 *
 * Lunar festivals (Diwali, Holi, Raksha Bandhan, Janmashtami, etc.) shift every
 * year, so a single hard-coded approximate date drifts and produces wrong
 * "days away" counts — e.g. Janmashtami 2026 is Sep 4, not Aug 26, and Raksha
 * Bandhan 2026 is Aug 28, not Aug 9. To keep recommendations correct we use a
 * curated table of exact dates for 2025–2027 (the planning window that matters)
 * and fall back to the approximate dates only for years outside that range.
 * Lunar dates can shift ±1 day depending on region/tradition; the table uses
 * the widely-used Indian civil/panchang dates.
 */

export interface FestivalInfo {
  name: string;
  date: string; // ISO date string
  daysAway: number;
  category: 'major' | 'regional' | 'global';
  recommendedOfferTypes: string[];
  description: string;
  /** Restaurant-relevant angle used to craft offer copy (e.g. "thandai & street-food specials"). */
  foodAngle?: string;
}

// Fixed-date festivals (same date every year)
const FIXED_FESTIVALS: Array<{ name: string; month: number; day: number; category: 'major' | 'regional' | 'global'; description: string; foodAngle?: string }> = [
  // Global/National
  { name: "New Year's Day", month: 1, day: 1, category: 'global', description: 'Celebrate the new year', foodAngle: 'fresh-start brunch & celebratory combos' },
  { name: "Valentine's Day", month: 2, day: 14, category: 'global', description: 'Romantic dining specials', foodAngle: 'romantic dinner-for-two specials' },
  { name: 'Republic Day', month: 1, day: 26, category: 'major', description: 'Indian Republic Day', foodAngle: 'family thali & festive combos' },
  { name: 'Independence Day', month: 8, day: 15, category: 'major', description: 'Indian Independence Day', foodAngle: 'flag-day specials & celebration combos' },
  // Mother's Day and Friendship Day are computed (see getFixedFestivalDate) —
  // they are "second Sunday of May" and "first Sunday of August" respectively.
  { name: 'Friendship Day', month: 8, day: 4, category: 'regional', description: 'Friendship celebrations', foodAngle: 'sharing platters & 2-for-1 snacks' },
  { name: 'Halloween', month: 10, day: 31, category: 'global', description: 'Spooky treats', foodAngle: 'themed treats & spooky combos' },
  { name: 'Christmas', month: 12, day: 25, category: 'major', description: 'Christmas celebrations', foodAngle: 'roast dinners & dessert spreads' },
  { name: "New Year's Eve", month: 12, day: 31, category: 'global', description: 'Ring in the new year', foodAngle: 'countdown dinners & party platters' },
];

/** Festivals whose date is a weekday-of-month rule (2nd Sunday of May, 1st Sunday of August). */
const COMPUTED_FESTIVALS: Array<{ name: string; monthIndex: number; week: number; category: 'major' | 'regional' | 'global'; description: string; foodAngle?: string }> = [
  { name: "Mother's Day", monthIndex: 4, week: 2, category: 'global', description: 'Celebrate mothers', foodAngle: 'family brunch specials' },
  { name: 'Friendship Day', monthIndex: 7, week: 1, category: 'regional', description: 'Friendship celebrations', foodAngle: 'sharing platters & 2-for-1 snacks' },
];

// Approximate dates for lunar-based festivals (these shift yearly). These are
// the FALLBACK for years outside the curated exact-date table below.
const LUNAR_FESTIVALS: Array<{
  name: string;
  approximateMonth: number;
  approximateDay: number;
  category: 'major' | 'regional' | 'global';
  description: string;
  foodAngle?: string;
}> = [
  { name: 'Diwali', approximateMonth: 10, approximateDay: 20, category: 'major', description: 'Festival of lights', foodAngle: 'festive thali & mithai specials' },
  { name: 'Holi', approximateMonth: 3, approximateDay: 14, category: 'major', description: 'Festival of colors', foodAngle: 'thandai & street-food specials' },
  { name: 'Eid al-Fitr', approximateMonth: 3, approximateDay: 31, category: 'major', description: 'End of Ramadan', foodAngle: 'biryani & kebab feasts' },
  { name: 'Eid al-Adha', approximateMonth: 6, approximateDay: 7, category: 'major', description: 'Festival of sacrifice', foodAngle: 'family feast platters' },
  { name: 'Raksha Bandhan', approximateMonth: 8, approximateDay: 9, category: 'regional', description: 'Sibling bond celebration', foodAngle: 'gift platters & sibling thali deals' },
  { name: 'Ganesh Chaturthi', approximateMonth: 9, approximateDay: 7, category: 'regional', description: 'Lord Ganesha festival', foodAngle: 'modak & festive vegetarian specials' },
  { name: 'Navratri', approximateMonth: 10, approximateDay: 3, category: 'major', description: 'Nine nights festival', foodAngle: 'vrat-friendly menu' },
  { name: 'Dussehra', approximateMonth: 10, approximateDay: 12, category: 'major', description: 'Victory of good over evil', foodAngle: 'family feast combos' },
  { name: 'Maha Shivaratri', approximateMonth: 2, approximateDay: 26, category: 'regional', description: 'Night of Shiva', foodAngle: 'satvik & light vegetarian specials' },
  { name: 'Pongal', approximateMonth: 1, approximateDay: 15, category: 'regional', description: 'Harvest festival', foodAngle: 'harvest thali' },
  { name: 'Onam', approximateMonth: 8, approximateDay: 20, category: 'regional', description: 'Kerala harvest festival', foodAngle: 'sadya-style feast' },
  { name: 'Lohri', approximateMonth: 1, approximateDay: 13, category: 'regional', description: 'Punjabi winter festival', foodAngle: 'hearty winter specials' },
  { name: 'Janmashtami', approximateMonth: 8, approximateDay: 26, category: 'regional', description: 'Lord Krishna birthday', foodAngle: 'vegetarian thali & sweets' },
  { name: 'Good Friday', approximateMonth: 4, approximateDay: 18, category: 'global', description: 'Christian observance', foodAngle: 'family brunch specials' },
  { name: 'Easter', approximateMonth: 4, approximateDay: 20, category: 'global', description: 'Easter celebrations', foodAngle: 'brunch & dessert specials' },
];

/**
 * Exact dates for lunar festivals, per year. Kept current for the near-term
 * planning window (2025–2027); years outside this range fall back to the
 * approximate dates above. Lunar dates can vary ±1 day by region/tradition.
 */
const FESTIVAL_DATES: Record<number, Record<string, { month: number; day: number }>> = {
  2025: {
    'Maha Shivaratri': { month: 2, day: 26 },
    'Holi': { month: 3, day: 14 },
    'Eid al-Fitr': { month: 3, day: 31 },
    'Good Friday': { month: 4, day: 18 },
    'Easter': { month: 4, day: 20 },
    'Eid al-Adha': { month: 6, day: 7 },
    'Raksha Bandhan': { month: 8, day: 9 },
    'Janmashtami': { month: 8, day: 16 },
    'Ganesh Chaturthi': { month: 8, day: 27 },
    'Onam': { month: 8, day: 27 },
    'Navratri': { month: 9, day: 22 },
    'Dussehra': { month: 10, day: 2 },
    'Diwali': { month: 10, day: 20 },
  },
  2026: {
    'Maha Shivaratri': { month: 2, day: 15 },
    'Holi': { month: 3, day: 4 },
    'Eid al-Fitr': { month: 3, day: 21 },
    'Good Friday': { month: 4, day: 3 },
    'Easter': { month: 4, day: 5 },
    'Eid al-Adha': { month: 5, day: 27 },
    'Onam': { month: 8, day: 26 },
    'Raksha Bandhan': { month: 8, day: 28 },
    'Janmashtami': { month: 9, day: 4 },
    'Ganesh Chaturthi': { month: 9, day: 14 },
    'Navratri': { month: 10, day: 11 },
    'Dussehra': { month: 10, day: 20 },
    'Diwali': { month: 11, day: 8 },
  },
  2027: {
    'Maha Shivaratri': { month: 3, day: 6 },
    'Holi': { month: 3, day: 22 },
    'Eid al-Fitr': { month: 3, day: 9 },
    'Good Friday': { month: 3, day: 26 },
    'Easter': { month: 3, day: 28 },
    'Eid al-Adha': { month: 5, day: 17 },
    'Onam': { month: 8, day: 27 },
    'Raksha Bandhan': { month: 8, day: 17 },
    'Janmashtami': { month: 8, day: 24 },
    'Ganesh Chaturthi': { month: 9, day: 4 },
    'Navratri': { month: 9, day: 30 },
    'Dussehra': { month: 10, day: 9 },
    'Diwali': { month: 10, day: 29 },
  },
};

const recommendedOfferTypesByFestival: Record<string, string[]> = {
  'Diwali': ['festival', 'percentage', 'combo'],
  'Christmas': ['festival', 'flat', 'combo'],
  "New Year's Eve": ['festival', 'percentage', 'combo'],
  "Valentine's Day": ['coupon', 'combo', 'percentage'],
  'Holi': ['festival', 'percentage', 'bogo'],
  'Eid al-Fitr': ['festival', 'combo', 'flat'],
  'Eid al-Adha': ['festival', 'combo', 'flat'],
  'Halloween': ['bogo', 'percentage', 'combo'],
  "Mother's Day": ['coupon', 'flat', 'combo'],
  'Independence Day': ['festival', 'percentage', 'combo'],
  'Republic Day': ['festival', 'percentage', 'combo'],
  'Raksha Bandhan': ['combo', 'festival', 'flat'],
  'Ganesh Chaturthi': ['festival', 'combo', 'percentage'],
  'Navratri': ['percentage', 'festival', 'combo'],
  'Dussehra': ['combo', 'festival', 'percentage'],
  'Maha Shivaratri': ['percentage', 'combo'],
  'Pongal': ['festival', 'combo', 'percentage'],
  'Onam': ['combo', 'festival', 'percentage'],
  'Lohri': ['combo', 'percentage'],
  'Janmashtami': ['festival', 'percentage', 'combo'],
  'Good Friday': ['combo', 'percentage'],
  'Easter': ['combo', 'percentage'],
  'Friendship Day': ['bogo', 'percentage'],
};

/**
 * Nth weekday of a month — e.g. Mother's Day is the 2nd Sunday of May
 * (week=2, weekday=0), Friendship Day is the 1st Sunday of August.
 */
function nthWeekday(year: number, monthIndex: number, week: number, weekday: number): Date {
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (week - 1) * 7);
}

/** Exact date for a lunar festival in a given year, or the approximate fallback. */
function festivalMonthDay(name: string, year: number): { month: number; day: number } {
  return FESTIVAL_DATES[year]?.[name] ?? null;
}

/** Format a local-midnight date as YYYY-MM-DD in LOCAL time — toISOString()
 *  would shift the date back a day in positive-offset timezones (e.g. IST). */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Get upcoming festivals within the next N days.
 * @param maxDays Lookahead window (default: 30)
 * @param now     Reference date (defaults to today; injectable for tests)
 * @returns Array of festivals sorted by nearest first
 */
export function getUpcomingFestivals(maxDays: number = 30, now: Date = new Date()): FestivalInfo[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const festivals: FestivalInfo[] = [];

  const push = (
    name: string,
    date: Date,
    category: 'major' | 'regional' | 'global',
    description: string,
    foodAngle?: string,
  ) => {
    const diffMs = date.getTime() - today.getTime();
    const daysAway = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysAway <= maxDays) {
      festivals.push({
        name,
        date: toIsoDate(date),
        daysAway,
        category,
        recommendedOfferTypes: recommendedOfferTypesByFestival[name] || ['percentage', 'flat'],
        description,
        ...(foodAngle ? { foodAngle } : {}),
      });
    }
  };

  // Check fixed-date festivals
  for (const f of FIXED_FESTIVALS) {
    const date = new Date(today.getFullYear(), f.month - 1, f.day);
    // If the date has passed this year, check next year
    if (date < today) {
      date.setFullYear(date.getFullYear() + 1);
    }
    push(f.name, date, f.category, f.description, f.foodAngle);
  }

  // Check computed festivals (Mother's Day, Friendship Day)
  for (const f of COMPUTED_FESTIVALS) {
    let date = nthWeekday(today.getFullYear(), f.monthIndex, f.week, 0);
    if (date < today) {
      date = nthWeekday(today.getFullYear() + 1, f.monthIndex, f.week, 0);
    }
    push(f.name, date, f.category, f.description, f.foodAngle);
  }

  // Check lunar-based festivals (exact per-year table with approximate fallback)
  for (const f of LUNAR_FESTIVALS) {
    const thisYear = festivalMonthDay(f.name, today.getFullYear()) || {
      month: f.approximateMonth,
      day: f.approximateDay,
    };
    const date = new Date(today.getFullYear(), thisYear.month - 1, thisYear.day);
    if (date < today) {
      // Roll to next year — prefer the exact next-year date when available.
      const nextYear = festivalMonthDay(f.name, today.getFullYear() + 1) || {
        month: f.approximateMonth,
        day: f.approximateDay,
      };
      date.setFullYear(today.getFullYear() + 1, nextYear.month - 1, nextYear.day);
    }
    push(f.name, date, f.category, f.description, f.foodAngle);
  }

  // Sort by nearest first
  festivals.sort((a, b) => a.daysAway - b.daysAway);
  return festivals;
}

/**
 * Get the single nearest festival.
 */
export function getNearestFestival(now: Date = new Date()): FestivalInfo | null {
  const festivals = getUpcomingFestivals(60, now);
  return festivals.length > 0 ? festivals[0] : null;
}

/**
 * Check if today is within a festival window.
 */
export function isFestivalSeason(daysWindow: number = 7, now: Date = new Date()): FestivalInfo | null {
  const festivals = getUpcomingFestivals(daysWindow, now);
  return festivals.length > 0 ? festivals[0] : null;
}
