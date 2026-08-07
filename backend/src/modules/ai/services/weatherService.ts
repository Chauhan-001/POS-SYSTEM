/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Weather Service — Fetches real-time weather data from OpenWeatherMap API.
 * Falls back gracefully if the API key is missing or the request fails.
 */

import { aiConfig } from '../config';
import { CircuitBreaker } from '../../../utils/CircuitBreaker';

export interface WeatherData {
  condition: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  description: string;
  icon: string;
  windSpeed: number;
  city: string;
}

// ─── Weather API Circuit Breaker ────────────────────────────────────
// Protects against slow/failing OpenWeatherMap requests.
// Weather is non-critical — fast-fail with null (callers already handle null).
const weatherCircuitBreaker = new CircuitBreaker({
  name: 'OpenWeatherMap',
  failureThreshold: 3,        // Trip after 3 consecutive failures
  cooldownMs: 60_000,         // Try again after 60 seconds (weather data is not critical)
  timeoutMs: 5_000,           // 5 seconds max per weather API call
  maxConcurrency: 5,          // Max 5 concurrent weather lookups
  fallback: () => null,       // Return null on circuit open — callers already handle null
});

/**
 * Fetch real-time weather data for a given city.
 * Returns null if the API key is missing, the city is not found, or the request fails.
 * Wrapped in a circuit breaker to prevent cascading failures.
 */
export async function fetchWeatherData(city: string): Promise<WeatherData | null> {
  if (!city || !aiConfig.weatherApiKey) return null;

  const encodedCity = encodeURIComponent(city.trim());
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&appid=${aiConfig.weatherApiKey}&units=metric`;

  const result = await weatherCircuitBreaker.execute<WeatherData | null>(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[WeatherService] OpenWeatherMap returned ${response.status} for "${city}"`);
        return null;
      }

      const data = await response.json();

      return {
        condition: mapCondition(data.weather?.[0]?.main || 'Clear'),
        temperature: Math.round(data.main?.temp ?? 24),
        feelsLike: Math.round(data.main?.feels_like ?? 24),
        humidity: data.main?.humidity ?? 50,
        description: data.weather?.[0]?.description || 'clear sky',
        icon: getWeatherIcon(data.weather?.[0]?.id ?? 800),
        windSpeed: data.wind?.speed ?? 0,
        city: data.name || city,
      };
    },
  );

  return result.data;
}

/**
 * Map OpenWeatherMap main conditions to our simplified set.
 */
function mapCondition(main: string): string {
  const lower = main.toLowerCase();
  if (['thunderstorm', 'drizzle', 'rain'].includes(lower)) return 'rainy';
  if (['snow', 'sleet'].includes(lower)) return 'cold';
  if (['mist', 'smoke', 'haze', 'dust', 'fog', 'sand', 'ash', 'squall', 'tornado'].includes(lower)) return 'foggy';
  if (lower === 'clear') return 'sunny';
  if (lower === 'clouds') return 'cloudy';
  return 'pleasant';
}

/**
 * Map OpenWeatherMap weather condition codes to emoji icons.
 * https://openweathermap.org/weather-conditions
 */
function getWeatherIcon(id: number): string {
  if (id >= 200 && id < 300) return '⛈️';   // Thunderstorm
  if (id >= 300 && id < 400) return '🌦️';   // Drizzle
  if (id >= 500 && id < 600) return '🌧️';   // Rain
  if (id >= 600 && id < 700) return '❄️';    // Snow
  if (id >= 700 && id < 800) return '🌫️';    // Atmosphere (fog, haze, etc.)
  if (id === 800) return '☀️';                // Clear sky
  if (id === 801) return '🌤️';                // Mostly clear
  if (id === 802) return '⛅';                // Partly cloudy
  if (id >= 803) return '☁️';                 // Overcast
  return '🌤️';                                 // Default
}
