/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Types — Shared type definitions for the AI module.
 * These are sanitized, minimal data shapes — never raw MongoDB documents.
 */

// ====================================================================
// SANITIZED DATA SHAPES (sent to LLM — never raw DB documents)
// ====================================================================

export interface SanitizedInventoryItem {
  name: string;
  category: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  unit: string;
  averageCost: number;
  status: 'healthy' | 'normal' | 'low' | 'critical';
  expiryDate?: string;
}

export interface SanitizedWasteEntry {
  item: string;
  quantity: number;
  unit: string;
  reason: string;
  cost: number;
  date: string;
}

export interface SanitizedSalesData {
  totalRevenue: number;
  orderCount: number;
  itemCount: number;
  totalDiscount: number;
  totalGst: number;
  averageOrderValue: number;
  topItems: { name: string; qty: number; revenue: number }[];
  paymentMethods: { method: string; amount: number; count: number }[];
  categoryBreakdown: { category: string; qty: number; revenue: number }[];
  date: string;
}

export interface SanitizedEmployeeInfo {
  name: string;
  role: string;
  branchId?: string;
}

// ====================================================================
// AI RESPONSE SHAPES
// ====================================================================

export interface AIInventoryHealth {
  overall: number;
  stockHealth: number;
  wasteRate: number;
  expiryRisk: number;
  trend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
}

export interface AIPurchaseRecommendation {
  item: string;
  reason: string;
  suggestedQty: string;
  urgency: 'low' | 'medium' | 'high';
  estimatedCost: number;
}

export interface AILowStockPrediction {
  item: string;
  daysUntilOut: number;
  confidence: 'high' | 'medium' | 'low';
  currentStock: number;
  unit: string;
  suggestedAction: string;
}

export interface AIDailySummary {
  date: string;
  greeting: string;
  keyInsight: string;
  topPriority: string;
  revenuePrediction: string;
  itemSuggestions: string[];
  alerts: { message: string; severity: 'info' | 'warning' | 'critical' }[];
}

export interface AIWasteAnalysis {
  totalWasteCost: number;
  topWasteItems: { name: string; cost: number; percentage: number }[];
  wasteByReason: { reason: string; count: number; cost: number }[];
  trend: 'increasing' | 'stable' | 'decreasing';
  actionableAdvice: string[];
}

export interface AIWeatherRecommendation {
  condition: string;
  temperature: number;
  icon: string;
  recommendation: string;
  suggestedItems: { name: string; reason: string }[];
  inventoryAdjustment: { item: string; action: string; reason: string }[];
}

export interface AIClosingAssistant {
  todaySummary: string;
  tomorrowPrep: string[];
  inventoryHealthNote: string;
  itemsToOrder: string[];
  potentialRisks: string[];
  revenuePrediction?: string;
  mood: 'great' | 'good' | 'okay' | 'needs_attention';
}

export interface AIVoiceParseResult {
  success: boolean;
  action: 'add_stock' | 'log_waste' | 'add_item' | 'remove_item' | null;
  itemName?: string;
  quantity?: number;
  unit?: string;
  reason?: string;
  rawText: string;
  error?: string;
}

// ====================================================================
// REQUEST / RESPONSE
// ====================================================================

export interface AIRequestBase {
  employee: SanitizedEmployeeInfo;
}

export interface InventoryHealthRequest extends AIRequestBase {
  items: SanitizedInventoryItem[];
  wasteTotal: number;
}

export interface PurchaseRecommendationRequest extends AIRequestBase {
  items: SanitizedInventoryItem[];
}

export interface DailySummaryRequest extends AIRequestBase {
  sales: SanitizedSalesData;
  lowStockCount: number;
  openOrderCount: number;
  wasteToday: number;
  customerCount: number;
}

export interface WasteAnalysisRequest extends AIRequestBase {
  wasteEntries: SanitizedWasteEntry[];
}

export interface VoiceParseRequest extends AIRequestBase {
  text: string;
  inventoryItems: { name: string; unit: string }[];
}

export interface ClosingAssistantRequest extends AIRequestBase {
  totalRevenue: number;
  orderCount: number;
  lowStockItems: number;
  wasteCost: number;
}

export interface WeatherRequest extends AIRequestBase {
  city?: string;
}

// ====================================================================
// LLM PROVIDER
// ====================================================================

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeout: number;
  maxTokens: number;
  temperature: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latency: number;
  model: string;
}
