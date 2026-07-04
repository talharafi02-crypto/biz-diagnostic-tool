// Core types shared across the whole app.
// Keeping these in one file so every module (scraper, rule engine, AI layer,
// dashboard, PDF) agrees on the same shape.

export type BusinessStage = "idea" | "startup" | "growing" | "established";

export type Budget = "low" | "medium" | "high"; // <$500/mo, $500-2000/mo, $2000+/mo

export interface BusinessInput {
  businessType: string; // free text, e.g. "Dental Clinic", "SaaS", "Restaurant"
  productService: string; // what they sell
  location: string; // city, country - used for local competition + search
  budget: Budget;
  businessStage: BusinessStage;
  websiteUrl: string; // must be a valid URL
}

// A single scorecard module. Every module in the report follows this shape
// so the dashboard and PDF can render them generically.
export interface ScoreCard {
  id: string;
  title: string;
  score: number | null; // 0-100, null if not applicable/not measurable
  status: "good" | "warning" | "critical" | "info";
  summary: string; // one-line, business-owner-friendly
  details: string[]; // bullet points, plain language
  source: "live-api" | "rule-engine" | "ai-synthesis" | "scraper";
}

export interface DiagnosticReport {
  generatedAt: string;
  input: BusinessInput;
  cards: ScoreCard[];
  roadmap: { priority: number; action: string; why: string }[];
  avoidList: string[];
  recommendedChannel: {
    channel: string;
    reasoning: string;
    budgetFit: string;
  };
  raw: Record<string, unknown>; // raw fetched data, kept for debugging/audit trail
}
