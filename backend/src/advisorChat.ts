/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AdvisorChat — Tool-based AI advisor for restaurant owners.
 *
 * The owner should be able to ask questions like:
 *   "Why are sales down?"
 *   "What should I do today?"
 *   "What is my most profitable product?"
 *   "Which promotion should I run?"
 *   "Should I discount anything?"
 *   "Why did you recommend this?"
 *   "What worked last month?"
 *   "What should I stop doing?"
 *   "How can I increase profit?"
 *
 * The advisor queries structured intelligence rather than freely reasoning
 * over the database. It exposes controlled tools/functions.
 */

import mongoose from 'mongoose';
import RestaurantIntelligenceOrchestrator from '../services/restaurantIntelligenceOrchestrator';
import type { AutomationPolicy, AutomationLevel, BusinessObjective } from '../services/restaurantIntelligenceOrchestrator';
import type { RecommendationContext } from './recommendationContext';
import type { HealthDimension } from './healthScore';

/**
 * Natural language intent result
 */
export interface ParsedIntent {
  /** Detected objective */
  objective?: BusinessObjectiveId;

  /** Detected day/time */
  day?: string;
  time?: string;

  /** Maximum discount if mentioned */
  maxDiscount?: number;

  /** Target product/category */
  targetProduct?: string;
  targetCategory?: string;

  /** Action requested */
  action?: 'recommend' | 'simulate' | 'explain' | 'create' | 'pause' | 'analyze';

  /** Strategy type if specified */
  strategyType?: StrategyKey;

  /** Raw entities extracted */
  entities: Record<string, any>;

  /** Confidence in parsing */
  confidence: number;
}

/**
 * Tool call result
 */
export interface ToolCallResult {
  /** Tool name */
  tool: string;
  /** Success flag */
  success: boolean;
  /** Result data */
  data: any;
  /** Error message (if any) */
  error?: string;
}

/**
 * Advisor chat response
 */
export interface AdvisorChatResponse {
  /** Natural language response */
  response: string;

  /** Structured data (for UI rendering) */
  data?: {
    /** Executive summary */
    executiveSummary?: string;

    /** Health dimensions */
    healthDimensions?: HealthDimension[];

    /** Top recommendations */
    topRecommendations?: Array<{
      title: string;
      type: string;
      expectedImpact: string;
      confidence: 'Low' | 'Medium' | 'High';
    }>;

    /** Current metrics */
    currentMetrics?: {
      dailySales: number;
      aov: number;
      contribution: number;
      forecast: number;
    };

    /** Active opportunities */
    opportunities?: {
      top: string;
      risk: string;
      customer: string;
    };
  };

  /** Tool calls made */
  toolCalls: Array<{
    tool: string;
    success: boolean;
    summary: string;
  }>;

  /** Policy constraints applied */
  policyConstraints?: {
    maxDiscount: number;
    minMargin: number;
    restrictions: string[];
  };
}

/**
 * Parse natural language intent from owner message
 */
export function parseOwnerIntent(message: string): ParsedIntent {
  const lower = message.toLowerCase();
  const intent: ParsedIntent = {
    entities: {},
    confidence: 0.8, // base confidence
  };

  // 1. Detect business objective
  const objectiveMap: Record<BusinessObjectiveId, string[]> = {
    increase_revenue: ['increase revenue', 'more revenue', 'grow revenue', 'revenue up'],
    increase_profit: ['increase profit', 'more profit', 'profit up', 'profitability'],
    increase_aov: ['increase aov', 'higher aov', 'average order', 'bigger basket'],
    increase_repeat_customers: ['repeat customers', 'loyal customers', 'returning customers'],
    fill_slow_hours: ['slow hours', 'afternoon', 'tuesday afternoon', 'fill slow'],
    reduce_wastage: ['reduce wastage', 'less waste', 'waste less'],
    improve_inventory_efficiency: ['inventory efficiency', 'stock turnover', 'inventory'],
    increase_premium_item_sales: ['premium items', 'premium sales', 'high-margin'],
  };

  for (const [objectiveId, keywords] of Object.entries(objectiveMap)) {
    if (keywords.some(k => lower.includes(k))) {
      intent.objective = objectiveId as BusinessObjectiveId;
      break;
    }
  }

  // 2. Detect day of week
  const dayMap: Record<string, string[]> = {
    monday: ['monday', 'mon'],
    tuesday: ['tuesday', 'tue', 'tuesday afternoon'],
    wednesday: ['wednesday', 'wed'],
    thursday: ['thursday', 'thu'],
    friday: ['friday', 'fri'],
    saturday: ['saturday', 'sat'],
    sunday: ['sunday', 'sun'],
  };

  for (const [day, keywords] of Object.entries(dayMap)) {
    if (keywords.some(k => lower.includes(k))) {
      intent.day = day;
      break;
    }
  }

  // 3. Detect time of day
  const timePatterns = [
    { pattern: /morning|am/i, label: 'morning' },
    { pattern: /afternoon|pm/i, label: 'afternoon' },
    { pattern: /evening|eve/i, label: 'evening' },
    { pattern: /lunch|lunch special/i, label: 'lunch' },
    { pattern: /happy hour/i, label: 'happy_hour' },
    { pattern: /late night|night/i, label: 'late_night' },
  ];

  for (const { pattern, label } of timePatterns) {
    if (pattern.test(lower)) {
      intent.time = label;
      break;
    }
  }

  // 4. Detect maximum discount
  const discountMatch = lower.match(/(?:maximum|max|up to)\s*(\d+)\s*%/);
  if (discountMatch) {
    intent.maxDiscount = parseInt(discountMatch[1], 10);
  }

  // 5. Detect target product/category
  // Look for product names - simplified: check for common food items
  const foodItems = ['pizza', 'burger', 'chai', 'samosa', 'paneer', 'chicken', 'ice cream'];
  for (const item of foodItems) {
    if (lower.includes(item)) {
      intent.targetProduct = item;
      break;
    }
  }

  // Check for category mentions
  const categories = ['main course', 'starters', 'beverages', 'desserts'];
  for (const cat of categories) {
    if (lower.includes(cat)) {
      intent.targetCategory = cat;
      break;
    }
  }

  // 6. Detect action
  const actionMap: Record<string, string> = {
    'what should i do': 'recommend',
    'which promotion': 'recommend',
    'why are sales': 'analyze',
    'why did you': 'explain',
    'what worked': 'analyze',
    'what should i stop': 'analyze',
    'how can i increase': 'recommend',
    'simulate': 'simulate',
  };

  for (const [pattern, action] of Object.entries(actionMap)) {
    if (lower.includes(pattern)) {
      intent.action = action;
      break;
    }
  }

  // If no specific action detected but we have objectives, default to recommend
  if (!intent.action && intent.objective) {
    intent.action = 'recommend';
  }

  // Calculate confidence based on how many elements were parsed
  const parsedElements = [
    intent.objective,
    intent.day,
    intent.time,
    intent.maxDiscount,
    intent.targetProduct,
  ].filter(Boolean).length;
  intent.confidence = Math.min(1.0, 0.5 + parsedElements * 0.1);

  return intent;
}

/**
 * Execute advisor chat request with tool-based AI
 */
export async function executeAdvisorChat(
  restaurantId: string,
  message: string,
  policy: AutomationPolicy,
  objective: BusinessObjective,
  automationLevel: AutomationLevel
): Promise<AdvisorChatResponse> {
  const toolCalls: Array<{
    tool: string;
    success: boolean;
    summary: string;
  }> = [];

  const parsedIntent = parseOwnerIntent(message);

  // Start building response
  const baseResponse: string = `I${
    parsedIntent.objective
      ? ` understand you want to ${parsedIntent.objective}.`
      : ''} ${message}${
    parsedIntent.objective
      ? '. Let me check your restaurant data and provide recommendations.'
      : ' How can I help you today?'
  }`;

  // Initialize orchestrator
  const orchestrator = new RestaurantIntelligenceOrchestrator(policy, objective, automationLevel);

  // Check kill switches first
  const killSwitchResult = checkKillSwitches(
    {
      allAutomatedPromotions: 'active',
      aiRecommendations: automationLevel.level >= 1 ? 'active' : 'paused',
      emergencyStop: 'active',
      strategyTypes: {},
      channels: { in_app: 'active', whatsapp: 'active', email: 'active', sms: 'active' },
    },
    'ai_rec'
  );

  let response = baseResponse;

  // Tool 1: Get executive summary
  try {
    const ctx = await buildRecommendationContext(restaurantId, {
      includeMargin: true,
      includeAnalytics: true,
      branchId: undefined,
    });

    const dimensions = calculateHealthDimensions(restaurantId, ctx);
    const summary = generateExecutiveSummary(restaurantId, policy, objective, automationLevel, ctx);

    toolCalls.push({
      tool: 'get_executive_summary',
      success: true,
      summary: 'Executive summary generated',
    });

    response = `${summary}\n\n${response}`;
    // Append health info
    const healthSummary = dimensions
      .map(d => `${d.name}: ${d.status} (${d.score}/100)`)
      .join(' | ');
    response = `**Health:** ${healthSummary}\n\n${response}`;
  } catch (error) {
    toolCalls.push({
      tool: 'get_executive_summary',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    response = 'Unable to generate executive summary at this time. ';
  }

  // Tool 2: Get recommendations based on intent
  try {
    let recommendations: any[] = [];

    if (parsedIntent.objective) {
      const ranked = await orchestrator.rankRecommendations(restaurantId);
      recommendations = ranked.slice(0, 3);
    } else {
      // Get recommendations for all objectives or default
      const result = await generateAdvisorRecommendations(restaurantId, 'increase_profit' as any);
      recommendations = result.recommendations.slice(0, 3);
    }

    toolCalls.push({
      tool: 'get_recommendations',
      success: true,
      summary: `${recommendations.length} recommendations retrieved`,
    });

    if (recommendations.length > 0) {
      const recList = recommendations
        .map((r: any, i: number) => `${i + 1}. ${r.title} - ${r.expectedImpact}`)
        .join('\n');

      response = `${response}\n\n**Top Recommendations:**\n${recList}`;
    } else {
      response = `${response}\n\nNo recommendations available - may need more data.`;
    }
  } catch (error) {
    toolCalls.push({
      tool: 'get_recommendations',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    response = 'Unable to retrieve recommendations at this time. ';
  }

  // Tool 3: Health analysis
  try {
    const ctx = await buildRecommendationContext(restaurantId, {
      includeMargin: true,
      includeAnalytics: true,
      branchId: undefined,
    });

    const dimensions = calculateHealthDimensions(restaurantId, ctx);

    toolCalls.push({
      tool: 'get_health_analysis',
      success: true,
      summary: `${dimensions.length} health dimensions analyzed`,
    });

    // Append health info if not already added
    if (!response.includes('Health:')) {
      const healthSummary = dimensions
        .map(d => `${d.name}: ${d.status} (${d.score}/100)`)
        .join(' | ');
      response = `**Health:** ${healthSummary}\n\n${response}`;
    }
  } catch (error) {
    toolCalls.push({
      tool: 'get_health_analysis',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Tool 4: Simulate promotion if discount mentioned
  if (parsedIntent.maxDiscount !== undefined) {
    try {
      // Get a product from the context to simulate
      const ctx = await buildRecommendationContext(restaurantId, {
        includeMargin: true,
        branchId: undefined,
      });

      const product = ctx.products?.[0];
      if (product) {
        const simulation = await orchestrator.simulatePromotion(
          restaurantId,
          product.id,
          parsedIntent.maxDiscount,
          'increase_profit'
        );

        toolCalls.push({
          tool: 'simulate_promotion',
          success: simulation.valid,
          summary: simulation.valid ? 'Promotion simulated successfully' : 'Promotion violated policy',
        });

        if (simulation.valid) {
          const discountStr = `₹${simulation.proposedPrice.toLocaleString('en-IN')}`;
          response = `${response}\n\n**Simulation: ${parsedIntent.maxDiscount}% discount**\n` +
            `Proposed price: ${discountStr}\n` +
            `Expected contribution: ₹${simulation.expectedContribution.toLocaleString('en-IN')}\n` +
            `Risks: ${simulation.risks.join('; ')}`;
        } else {
          response = `${response}\n\n**Simulation blocked:** ${simulation.policyViolations.join('; ')}`;
        }
      }
    } catch (error) {
      toolCalls.push({
        tool: 'simulate_promotion',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Tool 5: Explain specific recommendation
  if (parsedIntent.action === 'explain' && parsedIntent.targetProduct) {
    try {
      const ctx = await buildRecommendationContext(restaurantId, {
        includeMargin: true,
        branchId: undefined,
      });

      const margins = ctx.margin?.productMargins || [];
      const product = margins.find((m: any) => m.productName.toLowerCase().includes(parsedIntent.targetProduct));

      toolCalls.push({
        tool: 'explain_recommendation',
        success: true,
        summary: product ? 'Product found - building explanation' : 'Product not found',
      });

      if (product) {
        const marginPct = product.contributionMarginPercent;
        const price = product.sellingPrice;
        const cost = product.recipeCost;

        response = `${response}\n\n**Why ${parsedIntent.targetProduct}:**\n` +
          `• Contribution margin: ${marginPct}%\n` +
          `• Selling price: ₹${price.toLocaleString('en-IN')}\n` +
          `• Recipe cost: ₹${cost.toLocaleString('en-IN')}\n` +
          `• This product ${marginPct >= 25 ? 'has healthy margin' : 'has thin margin'}. ` +
          `${
            marginPct < 25
              ? 'Avoid deep discounting - consider adding value instead.'
              : 'Good candidate for promotions.'
          }`;
      } else {
        response = `${response}\n\nProduct "${parsedIntent.targetProduct}" not found in menu.`;
      }
    } catch (error) {
      toolCalls.push({
        tool: 'explain_recommendation',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Apply policy constraints to the response
  const policyConstraints = {
    maxDiscount: policy.maximumDiscount,
    minMargin: policy.minimumMargin,
    restrictions: [
      policy.maximumDiscount > 0 ? `Max discount: ${policy.maximumDiscount}%` : 'None',
      policy.minimumMargin > 0 ? `Min margin: ${policy.minimumMargin}%` : 'None',
    ],
  };

  // Final response formatting
  const finalResponse: AdvisorChatResponse = {
    response: response.trim(),
    data: {
      executiveSummary: generateExecutiveSummary(restaurantId, policy, objective, automationLevel),
      topRecommendations: (await orchestrator.rankRecommendations(restaurantId)).slice(0, 3).map((r: any) => ({
        title: r.title,
        type: r.type,
        expectedImpact: r.expectedImpact,
        confidence: r.confidence,
      })),
      currentMetrics: {
        dailySales: (await buildRecommendationContext(restaurantId, {
          includeAnalytics: true,
        })).sales?.dailyRevenue || 0,
        aov: (await buildRecommendationContext(restaurantId, {
          includeAnalytics: true,
        })).sales?.averageOrderValue || 0,
        contribution: (await buildRecommendationContext(restaurantId, {
          includeMargin: true,
        })).margin?.productMargins
          .reduce((s: number, m: any) => s + (m.totalContribution || 0), 0) || 0,
        forecast: 5, // placeholder
      },
      opportunities: {
        top: (await orchestrator.rankRecommendations(restaurantId))[0]?.title || 'None',
        risk: orchestrator.determineTopRisk((await orchestrator.rankRecommendations(restaurantId))) || 'None',
        customer: (await orchestrator.detectCustomerOpportunity((await orchestrator.rankRecommendations(restaurantId)))?.description || 'None'),
      },
    },
    toolCalls,
    policyConstraints,
  };

  return finalResponse;
}

/**
 * Owner chat endpoint handler (conceptual)
 */
export async function handleOwnerChat(
  restaurantId: string,
  message: string,
  opts: {
    policy?: AutomationPolicy;
    objective?: BusinessObjective;
    automationLevel?: AutomationLevel;
  } = {}
): Promise<AdvisorChatResponse> {
  const policy = opts.policy || {
    allowedStrategyTypes: ['SLOW_HOUR_COMBO', 'REACTIVATION_FREE_ITEM', 'AOV_ADDON', 'HIGH_MARGIN_CROSS_SELL'],
    maximumDiscount: 15,
    minimumMargin: 25,
    maximumFrequency: 3,
    allowedProducts: [],
    allowedCustomerSegments: [],
    allowedChannels: ['in_app', 'whatsapp', 'email'],
    maximumBudget: 5000,
    approvalRequirement: 'owner',
    quietHours: { start: 12, end: 14 },
  };

  const objective = opts.objective || BUSINESS_OBJECTIVES.increase_profit;
  const automationLevel = opts.automationLevel || {
    level: 0,
    description: 'Advisory only',
    ownerApproves: true,
    autoExecutes: false,
    fromLibraryOnly: true,
  };

  return executeAdvisorChat(restaurantId, message, policy, objective, automationLevel);
}