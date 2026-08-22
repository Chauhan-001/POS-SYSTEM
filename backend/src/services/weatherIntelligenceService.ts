/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeatherIntelligenceService — Conditional recommendations based on weather.
 *
 * Only generates recommendations when live weather data is available.
 * Never fabricates weather information.
 */

import { getUpcomingFestivals } from './festivalService';
import { assessDataSufficiency } from './dataSufficiencyService';

export interface WeatherData {
  condition: string; // 'rainy', 'sunny', 'cloudy', 'cold', 'hot', 'foggy', 'stormy'
  temperature: number; // Celsius
  humidity: number; // 0-100
  city: string;
  timestamp: Date;
  source: string; // 'api' | 'manual' | 'mock'
}

export interface WeatherRecommendation {
  id: string;
  type: 'WEATHER_DRIVEN';
  weatherCondition: string;
  temperature: number;
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  targetCategories: string[];
  targetProducts: string[];
  suggestedDiscount: number;
  suggestedDurationHours: number;
  timeWindow: { startHour: number; endHour: number };
  reasoning: string;
  confidence: number;
  validUntil: Date;
}

export interface WeatherIntelligenceOptions {
  restaurantId: string;
  branchId?: string;
  weather?: WeatherData; // If not provided, will check for cached weather
  maxRecommendations?: number;
}

const WEATHER_CATEGORY_MAP: Record<string, string[]> = {
  rainy: ['Beverages', 'Hot Beverages', 'Soups', 'Starters', 'Fried Snacks', 'Comfort Food'],
  cold: ['Hot Beverages', 'Soups', 'Starters', 'Comfort Food', 'Desserts'],
  hot: ['Cold Beverages', 'Ice Cream', 'Desserts', 'Salads', 'Juices', 'Smoothies'],
  sunny: ['Cold Beverages', 'Ice Cream', 'Desserts', 'Salads', 'BBQ', 'Grills'],
  cloudy: ['Comfort Food', 'Starters', 'Main Course', 'Beverages'],
  foggy: ['Hot Beverages', 'Soups', 'Starters', 'Comfort Food'],
  stormy: ['Comfort Food', 'Hot Beverages', 'Soups', 'Delivery Friendly'],
};

const WEATHER_REASONING: Record<string, string> = {
  rainy: 'Rain expected — customers seek warm, comforting food and hot beverages. Delivery orders typically increase 20-30%.',
  cold: 'Cold weather — hot food and beverage demand increases significantly. Customers prefer warming dishes.',
  hot: 'Hot weather — cold beverages, ice cream, and light meals are in high demand. Hydration-focused items sell best.',
  sunny: 'Sunny day — outdoor dining and cold treats drive sales. Refreshing beverages and desserts perform well.',
  cloudy: 'Overcast conditions — comfort food and warm beverages see moderate lift.',
  foggy: 'Foggy weather — similar to cold/rainy, hot beverages and soups preferred.',
  stormy: 'Stormy conditions — delivery-friendly comfort food. Dine-in may drop but delivery surges.',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generate weather-based recommendations
 */
export async function generateWeatherRecommendations(
  options: WeatherIntelligenceOptions
): Promise<WeatherRecommendation[]> {
  const { restaurantId, branchId, weather, maxRecommendations = 3 } = options;

  // Check data sufficiency
  const sufficiency = await assessDataSufficiency({ restaurantId, branchId });
  if (sufficiency.overall === 'INSUFFICIENT_DATA') {
    return [];
  }

  // If no weather provided, return empty (never fabricate)
  if (!weather) {
    return [];
  }

  // Validate weather data freshness (max 6 hours old)
  const weatherAgeHours = (Date.now() - weather.timestamp.getTime()) / (1000 * 60 * 60);
  if (weatherAgeHours > 6) {
    return []; // Stale weather data
  }

  const condition = weather.condition.toLowerCase();
  const categories = WEATHER_CATEGORY_MAP[condition] || [];
  const reasoning = WEATHER_REASONING[condition] || 'Weather-based recommendation';

  if (categories.length === 0) {
    return [];
  }

  // Determine discount and duration based on condition severity
  let suggestedDiscount = 10;
  let suggestedDurationHours = 4;
  let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  let timeWindow = { startHour: 11, endHour: 22 };

  switch (condition) {
    case 'rainy':
    case 'stormy':
      suggestedDiscount = 15;
      suggestedDurationHours = 6;
      priority = 'HIGH';
      timeWindow = { startHour: 11, endHour: 23 };
      break;
    case 'cold':
    case 'foggy':
      suggestedDiscount = 10;
      suggestedDurationHours = 8;
      priority = 'MEDIUM';
      timeWindow = { startHour: 11, endHour: 22 };
      break;
    case 'hot':
    case 'sunny':
      suggestedDiscount = 20;
      suggestedDurationHours = 6;
      priority = 'HIGH';
      timeWindow = { startHour: 12, endHour: 20 };
      break;
    case 'cloudy':
      suggestedDiscount = 10;
      suggestedDurationHours = 4;
      priority = 'LOW';
      timeWindow = { startHour: 11, endHour: 22 };
      break;
  }

  // Adjust for temperature extremes
  if (weather.temperature >= 35) {
    suggestedDiscount = Math.max(suggestedDiscount, 20);
    priority = 'HIGH';
  } else if (weather.temperature <= 10) {
    suggestedDiscount = Math.max(suggestedDiscount, 15);
    priority = 'HIGH';
  }

  // Check for festival overlap (festivals take priority)
  const festivals = getUpcomingFestivals(2);
  const todayFestival = festivals.find(f => {
    const festDate = new Date(f.date);
    return festDate.toDateString() === new Date().toDateString();
  });

  if (todayFestival) {
    // Festival already has recommendations, weather is secondary
    suggestedDiscount = Math.min(suggestedDiscount, 10);
    priority = 'LOW';
  }

  const recommendations: WeatherRecommendation[] = [];

  // Create recommendation for each relevant category
  for (const category of categories.slice(0, maxRecommendations)) {
    const validUntil = new Date(Date.now() + suggestedDurationHours * 60 * 60 * 1000);

    recommendations.push({
      id: `weather_${condition}_${category.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
      type: 'WEATHER_DRIVEN',
      weatherCondition: condition,
      temperature: weather.temperature,
      title: `${condition.charAt(0).toUpperCase() + condition.slice(1)} Special: ${category}`,
      description: `${reasoning} Enjoy ${suggestedDiscount}% off on ${category}.`,
      priority,
      targetCategories: [category],
      targetProducts: [],
      suggestedDiscount,
      suggestedDurationHours,
      timeWindow,
      reasoning: `${reasoning} Current temp: ${weather.temperature}°C.`,
      confidence: Math.min(0.8, 0.5 + (sufficiency.overall === 'HIGH_CONFIDENCE' ? 0.2 : 0)),
      validUntil,
    });
  }

  return recommendations;
}

/**
 * Check if weather conditions warrant a promotion right now
 */
export function shouldTriggerWeatherPromotion(weather: WeatherData): {
  trigger: boolean;
  reason: string;
  urgency: 'IMMEDIATE' | 'WITHIN_HOUR' | 'WITHIN_4_HOURS' | 'PLAN_AHEAD';
} {
  const condition = weather.condition.toLowerCase();
  const temp = weather.temperature;

  // Immediate triggers
  if (condition === 'stormy' || condition === 'rainy') {
    return {
      trigger: true,
      reason: 'Rain/Storm starting — immediate delivery and comfort food demand surge',
      urgency: 'IMMEDIATE',
    };
  }

  // Within hour triggers
  if (condition === 'hot' && temp >= 35) {
    return {
      trigger: true,
      reason: 'Extreme heat — cold beverage and ice cream demand spiking',
      urgency: 'WITHIN_HOUR',
    };
  }

  if (condition === 'cold' && temp <= 10) {
    return {
      trigger: true,
      reason: 'Cold snap — hot beverage and soup demand increasing',
      urgency: 'WITHIN_HOUR',
    };
  }

  // Within 4 hours
  if (['rainy', 'cold', 'hot', 'foggy'].includes(condition)) {
    return {
      trigger: true,
      reason: `${condition.charAt(0).toUpperCase() + condition.slice(1)} conditions — plan weather-appropriate promotion`,
      urgency: 'WITHIN_4_HOURS',
    };
  }

  // Plan ahead
  if (['cloudy', 'sunny'].includes(condition)) {
    return {
      trigger: false,
      reason: 'Mild conditions — standard operations sufficient',
      urgency: 'PLAN_AHEAD',
    };
  }

  return {
    trigger: false,
    reason: 'No significant weather driver',
    urgency: 'PLAN_AHEAD',
  };
}

/**
 * Get weather-aware demand adjustments for forecasting
 */
export function getWeatherDemandAdjustment(weather: WeatherData): {
  demandMultiplier: number;
  categoryAdjustments: Record<string, number>;
  channelShift: { dineIn: number; delivery: number; takeaway: number };
} {
  const condition = weather.condition.toLowerCase();
  const temp = weather.temperature;

  let demandMultiplier = 1.0;
  const categoryAdjustments: Record<string, number> = {};
  let channelShift = { dineIn: 0, delivery: 0, takeaway: 0 };

  switch (condition) {
    case 'rainy':
      demandMultiplier = 1.15;
      categoryAdjustments = {
        'Hot Beverages': 1.3,
        'Soups': 1.4,
        'Starters': 1.2,
        'Fried Snacks': 1.25,
        'Comfort Food': 1.2,
        'Cold Beverages': 0.7,
        'Ice Cream': 0.5,
        'Salads': 0.8,
      };
      channelShift = { dineIn: -0.15, delivery: 0.25, takeaway: 0.1 };
      break;

    case 'stormy':
      demandMultiplier = 1.1;
      categoryAdjustments = {
        'Comfort Food': 1.3,
        'Hot Beverages': 1.2,
        'Soups': 1.25,
        'Delivery Friendly': 1.4,
      };
      channelShift = { dineIn: -0.3, delivery: 0.4, takeaway: 0.15 };
      break;

    case 'hot':
    case 'sunny':
      demandMultiplier = 1.1;
      categoryAdjustments = {
        'Cold Beverages': 1.4,
        'Ice Cream': 1.5,
        'Desserts': 1.2,
        'Salads': 1.2,
        'Juices': 1.3,
        'Smoothies': 1.3,
        'Hot Beverages': 0.6,
        'Soups': 0.5,
      };
      channelShift = { dineIn: 0.05, delivery: 0.1, takeaway: 0.15 };
      if (temp >= 35) {
        demandMultiplier = 1.2;
        categoryAdjustments['Cold Beverages'] = 1.6;
        categoryAdjustments['Ice Cream'] = 1.7;
      }
      break;

    case 'cold':
    case 'foggy':
      demandMultiplier = 1.15;
      categoryAdjustments = {
        'Hot Beverages': 1.35,
        'Soups': 1.4,
        'Comfort Food': 1.25,
        'Starters': 1.15,
        'Desserts': 1.1,
        'Cold Beverages': 0.6,
        'Ice Cream': 0.4,
      };
      channelShift = { dineIn: -0.05, delivery: 0.15, takeaway: 0.1 };
      break;

    case 'cloudy':
      demandMultiplier = 1.05;
      categoryAdjustments = {
        'Comfort Food': 1.15,
        'Hot Beverages': 1.1,
        'Main Course': 1.05,
      };
      channelShift = { dineIn: 0, delivery: 0.05, takeaway: 0.05 };
      break;
  }

  return { demandMultiplier, categoryAdjustments, channelShift };
}

/**
 * Apply weather adjustments to a base forecast
 */
export function applyWeatherToForecast(
  baseForecast: { expectedDemand: number; expectedRevenue: number; byCategory?: Record<string, number> },
  weather: WeatherData
): { adjustedDemand: number; adjustedRevenue: number; byCategory?: Record<string, number> } {
  const { demandMultiplier, categoryAdjustments } = getWeatherDemandAdjustment(weather);

  const adjustedDemand = Math.round(baseForecast.expectedDemand * demandMultiplier);
  const adjustedRevenue = Math.round(baseForecast.expectedRevenue * demandMultiplier);

  let adjustedByCategory: Record<string, number> | undefined;
  if (baseForecast.byCategory) {
    adjustedByCategory = {};
    for (const [category, value] of Object.entries(baseForecast.byCategory)) {
      const adjustment = categoryAdjustments[category] || 1.0;
      adjustedByCategory[category] = Math.round(value * adjustment);
    }
  }

  return { adjustedDemand, adjustedRevenue, byCategory: adjustedByCategory };
}

export { WEATHER_CATEGORY_MAP, WEATHER_REASONING };
export type { WeatherData, WeatherRecommendation, WeatherIntelligenceOptions };