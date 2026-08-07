/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Festival Service — Detects upcoming festivals and special occasions
 * based on calendar rules. Uses deterministic date calculations — no AI needed.
 *
 * Festival detection is based on fixed dates and approximate lunar dates.
 * For production, integrate with a holiday API for precise lunar calendar dates.
 */

export interface FestivalInfo {
  name: string;
  date: string; // ISO date string
  daysAway: number;
  category: 'major' | 'regional' | 'global';
  recommendedOfferTypes: string[];
  description: string;
}

// Fixed-date festivals
const FIXED_FESTIVALS: Array<{ name: string; month: number; day: number; category: 'major' | 'regional' | 'global'; description: string }> = [
  // Global/National
  { name: "New Year's Day", month: 1, day: 1, category: 'global', description: 'Celebrate the new year' },
  { name: "Valentine's Day", month: 2, day: 14, category: 'global', description: 'Romantic dining specials' },
  { name: 'Republic Day', month: 1, day: 26, category: 'major', description: 'Indian Republic Day' },
  { name: 'Independence Day', month: 8, day: 15, category: 'major', description: 'Indian Independence Day' },
  { name: 'Mother\'s Day', month: 5, day: 12, category: 'global', description: 'Celebrate mothers' },
  { name: 'Friendship Day', month: 8, day: 4, category: 'regional', description: 'Friendship celebrations' },
  { name: 'Halloween', month: 10, day: 31, category: 'global', description: 'Spooky treats' },
  { name: 'Christmas', month: 12, day: 25, category: 'major', description: 'Christmas celebrations' },
  { name: 'New Year\'s Eve', month: 12, day: 31, category: 'global', description: 'Ring in the new year' },
];

// Approximate dates for lunar-based festivals (these shift yearly)
// In production, integrate with a proper holiday API
const LUNAR_FESTIVALS: Array<{
  name: string;
  approximateMonth: number;
  approximateDay: number;
  category: 'major' | 'regional' | 'global';
  description: string;
}> = [
  { name: 'Diwali', approximateMonth: 10, approximateDay: 20, category: 'major', description: 'Festival of lights' },
  { name: 'Holi', approximateMonth: 3, approximateDay: 14, category: 'major', description: 'Festival of colors' },
  { name: 'Eid al-Fitr', approximateMonth: 3, approximateDay: 31, category: 'major', description: 'End of Ramadan' },
  { name: 'Eid al-Adha', approximateMonth: 6, approximateDay: 7, category: 'major', description: 'Festival of sacrifice' },
  { name: 'Raksha Bandhan', approximateMonth: 8, approximateDay: 9, category: 'regional', description: 'Sibling bond celebration' },
  { name: 'Ganesh Chaturthi', approximateMonth: 9, approximateDay: 7, category: 'regional', description: 'Lord Ganesha festival' },
  { name: 'Navratri', approximateMonth: 10, approximateDay: 3, category: 'major', description: 'Nine nights festival' },
  { name: 'Dussehra', approximateMonth: 10, approximateDay: 12, category: 'major', description: 'Victory of good over evil' },
  { name: 'Maha Shivaratri', approximateMonth: 2, approximateDay: 26, category: 'regional', description: 'Night of Shiva' },
  { name: 'Pongal', approximateMonth: 1, approximateDay: 15, category: 'regional', description: 'Harvest festival' },
  { name: 'Onam', approximateMonth: 8, approximateDay: 20, category: 'regional', description: 'Kerala harvest festival' },
  { name: 'Lohri', approximateMonth: 1, approximateDay: 13, category: 'regional', description: 'Punjabi winter festival' },
  { name: 'Janmashtami', approximateMonth: 8, approximateDay: 26, category: 'regional', description: 'Lord Krishna birthday' },
  { name: 'Good Friday', approximateMonth: 4, approximateDay: 18, category: 'global', description: 'Christian observance' },
  { name: 'Easter', approximateMonth: 4, approximateDay: 20, category: 'global', description: 'Easter celebrations' },
];

const recommendedOfferTypesByFestival: Record<string, string[]> = {
  'Diwali': ['festival', 'percentage', 'combo'],
  'Christmas': ['festival', 'flat', 'combo'],
  'New Year\'s Eve': ['festival', 'percentage', 'combo'],
  "Valentine's Day": ['coupon', 'combo', 'percentage'],
  'Holi': ['festival', 'percentage', 'bogo'],
  'Eid al-Fitr': ['festival', 'combo', 'flat'],
  'Eid al-Adha': ['festival', 'combo', 'flat'],
  'Halloween': ['bogo', 'percentage', 'combo'],
  'Mother\'s Day': ['coupon', 'flat', 'combo'],
  'Independence Day': ['festival', 'percentage', 'combo'],
  'Republic Day': ['festival', 'percentage', 'combo'],
};

/**
 * Get upcoming festivals within the next N days.
 * @param maxDays Lookahead window (default: 30)
 * @returns Array of festivals sorted by nearest first
 */
export function getUpcomingFestivals(maxDays: number = 30): FestivalInfo[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const festivals: FestivalInfo[] = [];

  // Check fixed-date festivals
  for (const f of FIXED_FESTIVALS) {
    const date = new Date(today.getFullYear(), f.month - 1, f.day);
    // If the date has passed this year, check next year
    if (date < today) {
      date.setFullYear(date.getFullYear() + 1);
    }
    const diffMs = date.getTime() - today.getTime();
    const daysAway = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysAway <= maxDays) {
      festivals.push({
        name: f.name,
        date: date.toISOString().split('T')[0],
        daysAway,
        category: f.category,
        recommendedOfferTypes: recommendedOfferTypesByFestival[f.name] || ['percentage', 'flat'],
        description: f.description,
      });
    }
  }

  // Check lunar-based festivals (approximate)
  for (const f of LUNAR_FESTIVALS) {
    const date = new Date(today.getFullYear(), f.approximateMonth - 1, f.approximateDay);
    if (date < today) {
      date.setFullYear(date.getFullYear() + 1);
    }
    const diffMs = date.getTime() - today.getTime();
    const daysAway = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysAway <= maxDays) {
      festivals.push({
        name: f.name,
        date: date.toISOString().split('T')[0],
        daysAway,
        category: f.category,
        recommendedOfferTypes: recommendedOfferTypesByFestival[f.name] || ['percentage', 'flat'],
        description: f.description,
      });
    }
  }

  // Sort by nearest first
  festivals.sort((a, b) => a.daysAway - b.daysAway);
  return festivals;
}

/**
 * Get the single nearest festival.
 */
export function getNearestFestival(): FestivalInfo | null {
  const festivals = getUpcomingFestivals(60);
  return festivals.length > 0 ? festivals[0] : null;
}

/**
 * Check if today is within a festival window.
 */
export function isFestivalSeason(daysWindow: number = 7): FestivalInfo | null {
  const festivals = getUpcomingFestivals(daysWindow);
  return festivals.length > 0 ? festivals[0] : null;
}
