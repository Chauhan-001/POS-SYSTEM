/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * advisor.ts — Prompt builder for the AI Business Advisor.
 *
 * This prompt is used by the AI Advisory Service to enrich deterministic
 * recommendation candidates with owner-friendly explanations.
 *
 * The prompt receives ONLY the deterministic candidates (already validated
 * with real financial data) and asks the LLM to explain them in plain English.
 * The LLM NEVER computes financial values — it only interprets existing facts.
 */

import type { RecommendationContext } from '../../services/offerEngine';

function fmtMoney(n: number): string {
  return `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
}

/**
 * Build the AI advisor explanation prompt from deterministic candidates.
 * All numbers are authoritative facts from the deterministic engine.
 * The LLM's only job is to explain them in owner-friendly language.
 */
export function buildAdvisorPrompt(
  goal: string,
  candidates: Array<{
    index: number;
    title: string;
    type: string;
    why: string;
    evidence: string[];
    economics: any;
    expectedImpact: string;
    risk: string;
    score: number;
    confidence: number;
  }>
): string {
  const facts = candidates.map(c => ({
    index: c.index,
    title: c.title,
    type: c.type,
    why: c.why,
    evidence: c.evidence,
    economics: c.economics,
    expectedImpact: c.expectedImpact,
    risk: c.risk,
    score: c.score,
    confidence: c.confidence,
  }));

  return `You are a restaurant business advisor. Below are deterministic recommendations already computed from the restaurant's OWN data (real sales, real inventory, real margins, real offer performance). All numbers are authoritative — never change them, never invent new ones.

Goal: ${goal}

Recommendations:
${JSON.stringify(facts, null, 2)}

For each recommendation, return valid JSON ONLY: {"explanations":[{"index":0,"why":"...","impact":"...","risk":"..."}]}

Rules:
- Keep each field under 140 characters
- Owner-friendly, specific to the listed evidence
- Do not mention "data", "analysis", "algorithm", "model", or "system"
- Reference specific numbers from the evidence (e.g. "42% attachment rate", "₹148 contribution")
- Explain tradeoffs honestly
- Tone: professional advisor, concise, actionable`;
}

/**
 * Build the daily advisor briefing prompt.
 */
export function buildDailyAdvisorPrompt(
  restaurantName: string,
  opportunities: Array<{
    title: string;
    type: string;
    why: string;
    evidence: string[];
    score: number;
    confidence: number;
    expectedImpact: string;
  }>,
  insights: string[],
  alerts: Array<{ type: string; message: string }>
): string {
  return `You are a restaurant business advisor creating a daily morning briefing for "${restaurantName}".

Here are the top opportunities identified from the restaurant's data:

${opportunities.map((o, i) => `${i + 1}. ${o.title} (${o.type})
Why: ${o.why}
Evidence: ${o.evidence.join('; ')}
Score: ${o.score}/100 | Confidence: ${Math.round(o.confidence * 100)}%
Impact: ${o.expectedImpact}`).join('\n\n')}

Additional insights:
${insights.map(i => `- ${i}`).join('\n')}

System alerts:
${alerts.map(a => `- ${a.type}: ${a.message}`).join('\n')}

Create a concise morning briefing with:
1. Top 3 actionable opportunities (title, why, impact)
2. 1-2 key insights
3. Any urgent alerts

Respond with valid JSON ONLY:
{
  "briefing": "2-3 sentences summarizing today's focus",
  "topOpportunities": [
    { "title": "...", "why": "...", "impact": "...", "actionLabel": "Create Combo", "priority": "high" }
  ],
  "insights": ["..."],
  "urgentAlerts": ["..."]
}

Rules:
- Be concise, owner-friendly, specific
- Use only the facts provided
- Do not invent numbers
- Priority: "act_now" | "consider" | "maintain" | "monitor"
- ActionLabel: short button text like "Create Combo", "Run Promotion", "Review Cost"`;
}

/**
 * Build the campaign copy generation prompt.
 */
export function buildCampaignCopyPrompt(
  candidate: {
    title: string;
    description: string;
    type: string;
    target: any;
    financialModel: any;
    evidence: string[];
    expectedImpact: string;
  },
  tone: string,
  language: string
): string {
  return `You are a restaurant marketing copywriter. Generate customer-facing promotional copy for a validated offer.

Offer Details:
- Title: ${candidate.title}
- Description: ${candidate.description}
- Type: ${candidate.type}
- Target Products: ${JSON.stringify(candidate.target.productNames)}
- Target Categories: ${JSON.stringify(candidate.target.categoryIds)}
- Target Segments: ${JSON.stringify(candidate.target.segmentIds)}
- Price: ${candidate.financialModel?.proposedPrice || candidate.financialModel?.price}
- Discount: ${candidate.financialModel?.discountPercent}%
- Evidence: ${candidate.evidence.join('; ')}
- Expected Impact: ${candidate.expectedImpact}

Tone: ${tone}
Language: ${language === 'en' ? 'English' : language === 'hi' ? 'Hindi' : 'Hinglish (mix of Hindi and English)'}

Generate valid JSON ONLY with EXACTLY these fields (strings only, no markdown, no extra fields):
{
  "title": "max 6 words, catchy",
  "description": "1-2 sentences, warm and inviting",
  "whatsapp": "max 200 chars, include emoji, call to action",
  "sms": "max 120 chars, include emoji",
  "push": "max 100 chars, include emoji",
  "emailSubject": "max 60 chars",
  "emailBody": "2-3 short sentences with clear call to action"
}

Rules:
- Use the EXACT price/discount from the offer details
- Do NOT invent numbers, products, or conditions
- Include an emoji in whatsapp/sms/push
- Language: ${language === 'en' ? 'English' : language === 'hi' ? 'Hindi' : 'Hinglish (mix of Hindi and English)'}
- Tone: ${tone}
- No placeholders like [name] or <name> - write complete copy`;
}

/**
 * Build the what-if simulation explanation prompt.
 */
export function buildWhatIfPrompt(
  simulation: {
    type: string;
    current: any;
    proposed: any;
    incrementalUnitsRequired: number;
    incrementalRevenueRequired: number;
    breakEvenPercent: number;
    confidence: number;
    viable: boolean;
  }
): string {
  return `You are a restaurant business advisor explaining a "what-if" simulation result.

Simulation: ${simulation.type}

Current Economics:
- Price: ${simulation.current.price}
- Contribution per unit: ${simulation.current.contribution}
- Margin: ${simulation.current.marginPercent}%
- AOV: ${simulation.current.aov}

Proposed Economics:
- Price: ${simulation.proposed.price}
- Contribution per unit: ${simulation.proposed.contribution}
- Margin: ${simulation.proposed.marginPercent}%
- AOV: ${simulation.proposed.aov}

Key Metrics:
- Incremental units required to break even: ${simulation.incrementalUnitsRequired}
- Incremental revenue needed: ${simulation.incrementalRevenueRequired}
- Break-even volume increase: ${simulation.breakEvenPercent}%
- Confidence: ${Math.round(simulation.confidence * 100)}%
- Viable: ${simulation.viable ? 'Yes' : 'No'}

Provide a clear, concise explanation (max 160 chars) of what this means for the owner.
Focus on: Is it viable? What's the risk? What volume increase is needed?

Respond with valid JSON ONLY:
{
  "explanation": "Your explanation here (max 160 chars)"
}`;
}

/**
 * Build the natural language advisor prompt.
 */
export function buildNaturalLanguageAdvisorPrompt(
  question: string,
  context: {
    restaurantName: string;
    topRecommendations: Array<{ title: string; why: string; type: string; score: number; expectedImpact: string }>;
    activePromotions: string[];
    insights: string[];
  }
): string {
  return `You are a restaurant business advisor. The owner asks: "${question}"

Restaurant: ${context.restaurantName}

Current top recommendations from the system:
${context.topRecommendations.map((r, i) => `${i + 1}. ${r.title} (${r.type}) - ${r.why} | Impact: ${r.expectedImpact} | Score: ${r.score}/100`).join('\n')}

Active promotions:
${context.activePromotions.length ? context.activePromotions.map(p => `- ${p}`).join('\n') : '(none)'}

Key insights from data:
${context.insights.map(i => `- ${i}`).join('\n')}

Answer the owner's question as their business advisor.

Rules:
- Use ONLY the facts above. Do not invent numbers, customers, or sales.
- If the question cannot be answered from available data, say so and suggest what data would help.
- Be concise (max 200 chars), specific, actionable.
- Reference specific numbers from the recommendations when relevant.
- Tone: professional advisor, concise, honest about uncertainty.

Respond with valid JSON ONLY:
{
  "answer": "Your answer here (max 200 chars)",
  "relevantRecommendationIndices": [0, 1],
  "suggestedActions": ["Create Combo", "Run Promotion"],
  "dataSources": ["sales baselines", "basket analysis", "inventory"]
}`;
}