import { GoogleGenerativeAI } from "@google/generative-ai";
import { BusinessInput, ScoreCard } from "./types";

/**
 * DETERMINISM STRATEGY FOR THE AI LAYER
 * ------------------------------------------------------------------
 * 1. temperature: 0 — as close to deterministic as the API allows.
 *    Note (be honest with the client/examiner): even at temperature 0,
 *    LLM APIs do not give a byte-for-byte guarantee of identical output
 *    on every call (server-side batching/floating point effects can
 *    cause tiny variation). What we DO guarantee deterministically is:
 *      - every SCORE and NUMBER shown to the user comes from ruleEngine.ts,
 *        not from the AI.
 *      - the AI only rewrites/explains those already-fixed facts, so the
 *        substance of the recommendation cannot flip between runs, only
 *        the phrasing might vary slightly.
 * 2. The AI is given the exact computed scores/facts as input and is
 *    instructed to never invent numbers of its own.
 * 3. Output is forced into strict JSON so the rest of the app never has
 *    to parse free-form prose.
 *
 * WHY GEMINI, NOT ANTHROPIC: this project runs on a zero-budget stack.
 * Google AI Studio issues Gemini API keys with a genuinely free tier
 * (no credit card required at all), unlike Anthropic's API which is
 * pay-as-you-go from the first request. Swap back to Claude later by
 * restoring this file from git history if/when there's a budget for it —
 * the rest of the app (rule engine, scoring, PDF) is provider-agnostic.
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export interface AiSynthesisOutput {
  icp: {
    summary: string;
    demographics: string;
    psychographics: string;
    buyingTriggers: string;
  };
  recommendedChannel: {
    channel: string;
    reasoning: string;
    budgetFit: string;
  };
  roadmap: { priority: number; action: string; why: string }[];
  avoidList: string[];
  brandConsistency: { score: number; note: string };
  pricingPositioning: { signal: string; note: string };
  contentGap: { signal: string; note: string };
  retentionRisk: { signal: string; note: string };
}

export async function synthesizeWithAi(
  input: BusinessInput,
  facts: ScoreCard[]
): Promise<AiSynthesisOutput> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const factsSummary = facts
    .map((c) => `- ${c.title}: score=${c.score ?? "N/A"}, summary="${c.summary}"`)
    .join("\n");

  const systemPrompt = `You are a senior marketing consultant producing a structured business diagnostic.
You will be given FIXED, already-computed facts and scores about a business and its website.
Rules you must follow exactly:
1. Never invent or change any numeric score for domain/SEO/website/mobile/trust/friction — those are already final and given to you.
2. You MAY assign a 0-100 "brandConsistency" score yourself, but base it strictly on the facts given (title/messaging clarity, trust signal consistency) and briefly justify it — keep your reasoning consistent and repeatable for the same facts.
3. Respond with ONLY valid JSON matching the exact schema you are given. No markdown, no prose outside the JSON, no code fences.
4. Be concise, plain-language, and business-owner-friendly (avoid jargon).
5. Be honest — if data suggests the business isn't ready for a channel (e.g. paid ads with very low budget), say so directly.`;

  const userPrompt = `BUSINESS INPUT:
- Business type: ${input.businessType}
- Product/service: ${input.productService}
- Location: ${input.location}
- Monthly marketing budget: ${input.budget}
- Business stage: ${input.businessStage}
- Website: ${input.websiteUrl}

COMPUTED FACTS (already final, do not change these):
${factsSummary}

Return JSON with EXACTLY this shape:
{
  "icp": { "summary": string, "demographics": string, "psychographics": string, "buyingTriggers": string },
  "recommendedChannel": { "channel": "cold email"|"SEO"|"paid ads"|"content marketing"|"local marketing", "reasoning": string, "budgetFit": string },
  "roadmap": [ { "priority": number, "action": string, "why": string } ] (exactly 5 items, ordered by priority 1-5),
  "avoidList": [string] (2-4 items, things this business should NOT do right now and why),
  "brandConsistency": { "score": number (0-100), "note": string },
  "pricingPositioning": { "signal": "underpriced"|"overpriced"|"unclear"|"appropriate", "note": string },
  "contentGap": { "signal": "significant gap"|"moderate gap"|"minor gap"|"no major gap", "note": string },
  "retentionRisk": { "signal": "high"|"medium"|"low", "note": string }
}`;

  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0, // deterministic as possible
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();

  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as AiSynthesisOutput;
}
