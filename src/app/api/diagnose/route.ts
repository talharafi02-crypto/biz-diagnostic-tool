import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkSsl } from "@/lib/apis/ssl";
import { checkDomainAge } from "@/lib/apis/domainAge";
import { checkBlacklist } from "@/lib/apis/blacklist";
import { checkPageSpeed } from "@/lib/apis/pagespeed";
import { scrapeSite } from "@/lib/apis/scraper";
import { checkTechnicalSeo } from "@/lib/apis/technicalSeo";
import { checkLocalCompetition } from "@/lib/apis/localCompetition";
import { checkCompetitorIntel } from "@/lib/apis/competitorIntel";
import { checkSeasonalDemand } from "@/lib/apis/seasonalDemand";
import {
  scoreDomainHealth,
  scoreMobileExperience,
  scoreSeoSnapshot,
  scoreWebsiteAudit,
  scoreFirstImpression,
  scoreTrustCredibility,
  scoreFriction,
  scoreGrowthStageMismatch,
  scoreLocalCompetition,
  scoreCompetitorIntel,
  scoreSeasonalDemand,
  getMarketingStrategy,
} from "@/lib/ruleEngine";
import { synthesizeWithAi } from "@/lib/aiSynthesis";
import { DiagnosticReport, ScoreCard } from "@/lib/types";

export const maxDuration = 60; // Lighthouse audits + AI call can take a while

const inputSchema = z.object({
  businessType: z.string().min(2).max(120),
  productService: z.string().min(2).max(200),
  location: z.string().min(2).max(120),
  budget: z.enum(["none", "low", "medium", "high"]),
  businessStage: z.enum(["idea", "startup", "growing", "established"]),
  websiteUrl: z.string().url(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = inputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const hostname = new URL(input.websiteUrl).hostname;

  // Step 1: run all independent live checks in parallel (fast + no shared state)
  const [ssl, domainAge, blacklist, pagespeed, site, localCompetition, competitorIntel, seasonalDemand, technicalSeo] =
    await Promise.all([
      checkSsl(hostname),
      checkDomainAge(hostname),
      checkBlacklist(input.websiteUrl),
      checkPageSpeed(input.websiteUrl, "mobile"),
      scrapeSite(input.websiteUrl),
      checkLocalCompetition(input.businessType, input.location),
      checkCompetitorIntel(input.businessType, input.location, hostname),
      checkSeasonalDemand(input.businessType),
      checkTechnicalSeo(input.websiteUrl),
    ]);

  // Step 2: deterministic rule-engine scoring, built only from the facts above
  const domainHealthCard = scoreDomainHealth(ssl, blacklist, domainAge);
  const mobileCard = scoreMobileExperience(pagespeed);
  const seoCard = scoreSeoSnapshot(pagespeed, site, technicalSeo);
  const websiteAuditCard = scoreWebsiteAudit(site);
  const firstImpressionCard = scoreFirstImpression(pagespeed, site, ssl);
  const trustCard = scoreTrustCredibility(site, ssl, blacklist);
  const frictionCard = scoreFriction(site);
  const growthMismatchCard = scoreGrowthStageMismatch(input, site, seoCard.score);
  const localCompetitionCard = scoreLocalCompetition(localCompetition);
  const competitorIntelCard = scoreCompetitorIntel(competitorIntel);
  const seasonalDemandCard = scoreSeasonalDemand(seasonalDemand);
  const marketingStrategy = getMarketingStrategy(input);

  const factCards: ScoreCard[] = [
    domainHealthCard,
    mobileCard,
    seoCard,
    websiteAuditCard,
    firstImpressionCard,
    trustCard,
    frictionCard,
    growthMismatchCard,
    localCompetitionCard,
    competitorIntelCard,
    seasonalDemandCard,
  ];

  // Step 3: AI synthesis - reasoning only, fed the already-final facts above
  let aiResult;
  let aiError: string | null = null;
  try {
    aiResult = await synthesizeWithAi(input, factCards);
  } catch (e) {
    aiError = e instanceof Error ? e.message : "AI synthesis failed";
  }

  const cards: ScoreCard[] = [...factCards];

  if (aiResult) {
    cards.push({
      id: "brand-consistency",
      title: "Brand Consistency Score",
      score: aiResult.brandConsistency.score,
      status: aiResult.brandConsistency.score >= 75 ? "good" : aiResult.brandConsistency.score >= 45 ? "warning" : "critical",
      summary: aiResult.brandConsistency.note,
      details: [aiResult.brandConsistency.note],
      source: "ai-synthesis",
    });
    cards.push({
      id: "pricing-positioning",
      title: "Pricing Positioning Signal",
      score: null,
      status: "info",
      summary: aiResult.pricingPositioning.signal,
      details: [aiResult.pricingPositioning.note],
      source: "ai-synthesis",
    });
    cards.push({
      id: "content-gap",
      title: "Content Gap Signal",
      score: null,
      status: "info",
      summary: aiResult.contentGap.signal,
      details: [aiResult.contentGap.note],
      source: "ai-synthesis",
    });
    cards.push({
      id: "retention-risk",
      title: "Customer Retention Risk Signal",
      score: null,
      status: aiResult.retentionRisk.signal === "high" ? "critical" : aiResult.retentionRisk.signal === "medium" ? "warning" : "good",
      summary: aiResult.retentionRisk.signal,
      details: [aiResult.retentionRisk.note],
      source: "ai-synthesis",
    });
  }

  const report: DiagnosticReport = {
    generatedAt: new Date().toISOString(),
    input,
    cards,
    roadmap: aiResult?.roadmap ?? [],
    avoidList: aiResult?.avoidList ?? [],
    recommendedChannel: aiResult?.recommendedChannel ?? {
      channel: "N/A",
      reasoning: "AI-powered recommendations could not be generated for this report - see the notice above.",
      budgetFit: "N/A",
    },
    icp: aiResult?.icp ?? null,
    marketingStrategy,
    aiAvailable: !!aiResult,
    aiError,
    raw: { ssl, domainAge, blacklist, pagespeed, site, localCompetition, competitorIntel, seasonalDemand, technicalSeo, aiError },
  };

  return NextResponse.json(report);
}
