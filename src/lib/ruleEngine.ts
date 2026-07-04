import { ScoreCard, BusinessInput } from "./types";
import { SslResult } from "./apis/ssl";
import { DomainAgeResult } from "./apis/domainAge";
import { BlacklistResult } from "./apis/blacklist";
import { PageSpeedResult } from "./apis/pagespeed";
import { ScrapedSite } from "./apis/scraper";

/**
 * RULE ENGINE — DETERMINISM CONTRACT
 * ------------------------------------------------------------------
 * Every function here is a pure function: same input object -> same
 * output, always. No Date.now() jitter in the math, no Math.random(),
 * no AI calls. Given SSL/PageSpeed data pulled at slightly different
 * moments, results will only move if the underlying facts genuinely
 * changed (e.g. certificate renewed, page got slower) — that is
 * correct behaviour, not inconsistency.
 *
 * Each score is built from a fixed weighted checklist, documented
 * inline, so scoring logic can be audited and defended in a viva.
 */

function statusFromScore(score: number): ScoreCard["status"] {
  if (score >= 75) return "good";
  if (score >= 45) return "warning";
  return "critical";
}

// ---------------------------------------------------------------------
// 0. BUDGET-TO-CHANNEL MAPPING — pure lookup table, zero API dependency.
// This is the one module that must NEVER depend on AI or network calls:
// it is a fixed matrix of (budget tier x business stage) -> realistic
// channel mix, so it is 100% reproducible and instantly auditable.
// ---------------------------------------------------------------------
export interface ChannelAllocation {
  channel: string;
  allocationPct: number;
  rationale: string;
}

const BUDGET_CHANNEL_MATRIX: Record<
  BusinessInput["budget"],
  Record<BusinessInput["businessStage"], ChannelAllocation[]>
> = {
  low: {
    idea: [
      { channel: "Organic content / SEO groundwork", allocationPct: 60, rationale: "No/low spend, compounding long-term asset while validating the idea." },
      { channel: "Cold email outreach", allocationPct: 40, rationale: "Near-zero cost per lead, fastest way to get first real customer conversations." },
    ],
    startup: [
      { channel: "Cold email outreach", allocationPct: 50, rationale: "Cheapest reliable channel to get first paying customers with a tight budget." },
      { channel: "Local marketing (Google Business Profile, community)", allocationPct: 30, rationale: "Free/low-cost, high-trust for a business still building a reputation." },
      { channel: "SEO foundations", allocationPct: 20, rationale: "Low cost, compounds over time once cash flow allows more investment." },
    ],
    growing: [
      { channel: "SEO", allocationPct: 40, rationale: "Now has traction/content to build on; compounding channel fits a limited budget." },
      { channel: "Cold email outreach", allocationPct: 35, rationale: "Still the most budget-efficient direct-response channel." },
      { channel: "Local marketing", allocationPct: 25, rationale: "Reinforces reputation in existing service area at low cost." },
    ],
    established: [
      { channel: "SEO", allocationPct: 50, rationale: "Established brand should own organic search real estate for its category." },
      { channel: "Content marketing", allocationPct: 30, rationale: "Existing case studies/reputation make content cheap to produce and credible." },
      { channel: "Local marketing", allocationPct: 20, rationale: "Defends existing local market share at low incremental cost." },
    ],
  },
  medium: {
    idea: [
      { channel: "Cold email outreach", allocationPct: 40, rationale: "Fast validation signal before committing bigger spend." },
      { channel: "SEO", allocationPct: 35, rationale: "Starts the compounding clock early while budget allows some content investment." },
      { channel: "Paid ads (small test budget)", allocationPct: 25, rationale: "Enough budget for a controlled test, not a full campaign yet." },
    ],
    startup: [
      { channel: "Paid ads", allocationPct: 35, rationale: "Budget now supports real testing and iteration on ad creative/targeting." },
      { channel: "SEO", allocationPct: 30, rationale: "Medium-term compounding channel worth building now." },
      { channel: "Cold email outreach", allocationPct: 20, rationale: "Still efficient for direct B2B pipeline." },
      { channel: "Local marketing", allocationPct: 15, rationale: "Keeps local presence active alongside digital growth." },
    ],
    growing: [
      { channel: "Paid ads", allocationPct: 40, rationale: "Budget supports scaling what's already converting." },
      { channel: "SEO", allocationPct: 30, rationale: "Continues compounding organic growth alongside paid." },
      { channel: "Content marketing", allocationPct: 30, rationale: "Feeds both SEO and paid retargeting with proof-driven material." },
    ],
    established: [
      { channel: "SEO", allocationPct: 35, rationale: "Protects and extends organic market position." },
      { channel: "Paid ads", allocationPct: 35, rationale: "Sustains predictable lead volume at scale." },
      { channel: "Content marketing", allocationPct: 30, rationale: "Reinforces authority and supports both other channels." },
    ],
  },
  high: {
    idea: [
      { channel: "Paid ads", allocationPct: 40, rationale: "Budget allows fast, statistically meaningful market validation." },
      { channel: "SEO", allocationPct: 30, rationale: "Worth starting early given available budget for content production." },
      { channel: "Cold email outreach", allocationPct: 30, rationale: "Parallel direct-response validation path." },
    ],
    startup: [
      { channel: "Paid ads", allocationPct: 45, rationale: "Budget supports aggressive testing to find profitable acquisition channels fast." },
      { channel: "SEO", allocationPct: 30, rationale: "Builds a long-term moat while paid buys short-term growth." },
      { channel: "Content marketing", allocationPct: 25, rationale: "Supports both channels and builds brand credibility early." },
    ],
    growing: [
      { channel: "Paid ads", allocationPct: 45, rationale: "Scaling proven acquisition channels is the priority at this stage." },
      { channel: "Content marketing", allocationPct: 30, rationale: "Differentiates from competitors also running paid ads." },
      { channel: "SEO", allocationPct: 25, rationale: "Continues to reduce long-term dependency on paid spend." },
    ],
    established: [
      { channel: "Paid ads", allocationPct: 40, rationale: "Maintains dominant share of voice in a competitive market." },
      { channel: "SEO", allocationPct: 30, rationale: "Protects organic position built over time." },
      { channel: "Content marketing", allocationPct: 30, rationale: "Sustains thought leadership and supports premium positioning." },
    ],
  },
};

import { LocalCompetitionResult } from "./apis/localCompetition";
import { CompetitorIntelResult } from "./apis/competitorIntel";
import { SeasonalDemandResult } from "./apis/seasonalDemand";

// ---------------------------------------------------------------------
// LOCAL COMPETITION DENSITY
// ---------------------------------------------------------------------
export function scoreLocalCompetition(result: LocalCompetitionResult): ScoreCard {
  if (!result.checked || result.competitorCount === null) {
    return {
      id: "local-competition-density",
      title: "Local Competition Density",
      score: null,
      status: "info",
      summary: "Could not measure local competition density.",
      details: [result.error ?? "Places lookup unavailable."],
      source: "live-api",
    };
  }

  const score = result.densityLevel === "low" ? 80 : result.densityLevel === "medium" ? 50 : 25;

  return {
    id: "local-competition-density",
    title: "Local Competition Density",
    score,
    status: statusFromScore(score),
    summary: `${result.competitorCount} similar businesses found nearby — ${result.densityLevel} competition density.`,
    details: [
      `Density level: ${result.densityLevel} (based on ${result.competitorCount} listings found).`,
      ...(result.topCompetitorNames.length
        ? [`Nearby competitors include: ${result.topCompetitorNames.join(", ")}.`]
        : []),
      result.densityLevel === "high"
        ? "High density means differentiation and trust signals matter more than being 'just another option'."
        : result.densityLevel === "low"
        ? "Low density is an opportunity to capture local search demand with modest effort."
        : "Moderate density — solid local SEO and reviews should be enough to stand out.",
    ],
    source: "live-api",
  };
}

// ---------------------------------------------------------------------
// COMPETITOR INTELLIGENCE
// ---------------------------------------------------------------------
export function scoreCompetitorIntel(result: CompetitorIntelResult): ScoreCard {
  if (!result.checked || result.competitors.length === 0) {
    return {
      id: "competitor-intelligence",
      title: "Competitor Intelligence",
      score: null,
      status: "info",
      summary: "Could not identify competitors automatically.",
      details: [result.error ?? "No competitors found for this search."],
      source: "live-api",
    };
  }

  const avgTrust =
    result.competitors.reduce((sum, c) => sum + c.trustSignalCount, 0) / result.competitors.length;
  const ctaRate = result.competitors.filter((c) => c.hasCta).length / result.competitors.length;
  const contentRate = result.competitors.filter((c) => c.hasBlogOrContent).length / result.competitors.length;

  return {
    id: "competitor-intelligence",
    title: "Competitor Intelligence",
    score: null,
    status: "info",
    summary: `Analyzed ${result.competitors.length} real competitors: avg ${avgTrust.toFixed(
      1
    )}/6 trust signals, ${Math.round(ctaRate * 100)}% have a clear CTA, ${Math.round(
      contentRate * 100
    )}% publish real content.`,
    details: result.competitors.map(
      (c) =>
        `${c.name} (${c.url}) — trust signals: ${c.trustSignalCount}/6, CTA present: ${c.hasCta ? "yes" : "no"}, has content/blog: ${c.hasBlogOrContent ? "yes" : "no"}`
    ),
    source: "live-api",
  };
}

// ---------------------------------------------------------------------
// SEASONAL DEMAND TIMING
// ---------------------------------------------------------------------
export function scoreSeasonalDemand(result: SeasonalDemandResult): ScoreCard {
  if (!result.checked) {
    return {
      id: "seasonal-demand",
      title: "Seasonal Demand Timing",
      score: null,
      status: "info",
      summary: "Could not determine seasonal demand pattern.",
      details: [result.error ?? "Trends data unavailable."],
      source: "live-api",
    };
  }

  return {
    id: "seasonal-demand",
    title: "Seasonal Demand Timing",
    score: null,
    status: "info",
    summary: `Demand pattern: ${result.volatility}. Peak interest: ${result.peakMonths.join(", ")}. Lowest interest: ${result.lowMonths.join(", ")}.`,
    details: [
      `Highest search interest: ${result.peakMonths.join(", ")} — plan campaigns to ramp up 3-4 weeks before this.`,
      `Lowest search interest: ${result.lowMonths.join(", ")} — good window for planning/content prep rather than heavy ad spend.`,
      result.volatility === "highly-seasonal"
        ? "Demand swings heavily across the year — budget should flex month to month, not stay flat."
        : result.volatility === "seasonal"
        ? "Some seasonality present — worth adjusting spend moderately by season."
        : "Demand is fairly stable year-round — a flat monthly budget is reasonable.",
    ],
    source: "live-api",
  };
}

export function scoreBudgetChannelMapping(input: BusinessInput): ScoreCard {
  const allocations = BUDGET_CHANNEL_MATRIX[input.budget][input.businessStage];
  const summary = `Recommended mix for a ${input.budget} budget at ${input.businessStage} stage: ${allocations
    .map((a) => `${a.channel} (${a.allocationPct}%)`)
    .join(", ")}.`;

  return {
    id: "budget-channel-mapping",
    title: "Budget-to-Channel Mapping",
    score: null,
    status: "info",
    summary,
    details: allocations.map((a) => `${a.channel} — ${a.allocationPct}% — ${a.rationale}`),
    source: "rule-engine",
  };
}

// ---------------------------------------------------------------------
// 1. DOMAIN HEALTH (SSL + blacklist + domain age combined)
// ---------------------------------------------------------------------
export function scoreDomainHealth(
  ssl: SslResult,
  blacklist: BlacklistResult,
  age: DomainAgeResult
): ScoreCard {
  let score = 0;
  const details: string[] = [];

  // SSL — 40 points
  if (ssl.valid) {
    score += 40;
    details.push(`SSL certificate is valid (issued by ${ssl.issuer ?? "unknown CA"}).`);
    if (ssl.daysRemaining !== null && ssl.daysRemaining < 30) {
      score -= 10;
      details.push(`Warning: SSL certificate expires in ${ssl.daysRemaining} days — renew soon.`);
    }
  } else {
    details.push(`SSL certificate is missing or invalid${ssl.error ? `: ${ssl.error}` : "."}`);
  }

  // Blacklist — 40 points (heavily weighted, this is a trust killer)
  if (blacklist.checked) {
    if (!blacklist.isBlacklisted) {
      score += 40;
      details.push("Domain is not flagged on Google Safe Browsing.");
    } else {
      details.push(`Domain is flagged for: ${blacklist.threats.join(", ")}. This blocks trust and email deliverability immediately.`);
    }
  } else {
    score += 20; // neutral half-credit when we genuinely can't check
    details.push("Blacklist status could not be verified (API not configured).");
  }

  // Domain age — 20 points (older = more trust signal, caps at 2 years)
  if (age.found && age.ageInDays !== null) {
    const ageScore = Math.min(20, Math.round((age.ageInDays / 730) * 20));
    score += ageScore;
    const years = (age.ageInDays / 365).toFixed(1);
    details.push(`Domain is ${years} years old${age.registrar ? ` (registrar: ${age.registrar})` : ""}.`);
  } else {
    score += 10;
    details.push("Domain registration date could not be determined.");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    id: "domain-health",
    title: "Domain Health Check",
    score,
    status: statusFromScore(score),
    summary:
      score >= 75
        ? "Domain is healthy and trustworthy."
        : score >= 45
        ? "Domain has some health issues worth fixing."
        : "Domain has serious trust/security issues.",
    details,
    source: "live-api",
  };
}

// ---------------------------------------------------------------------
// 2. MOBILE EXPERIENCE SCORE (from PageSpeed Lighthouse, mobile strategy)
// ---------------------------------------------------------------------
export function scoreMobileExperience(ps: PageSpeedResult): ScoreCard {
  if (!ps.checked || ps.mobileScore === null) {
    return {
      id: "mobile-experience",
      title: "Mobile Experience Score",
      score: null,
      status: "info",
      summary: "Could not measure mobile performance.",
      details: [ps.error ?? "PageSpeed data unavailable."],
      source: "live-api",
    };
  }

  const details = [
    `Lighthouse mobile performance score: ${ps.mobileScore}/100.`,
    ps.isMobileFriendly
      ? "Page has a proper mobile viewport configured."
      : "Page is missing a mobile viewport tag — this alone can hurt mobile usability significantly.",
  ];
  if (ps.loadTimeSeconds !== null) {
    details.push(
      `Largest Contentful Paint: ${ps.loadTimeSeconds}s ${
        ps.loadTimeSeconds > 2.5 ? "(slower than Google's recommended 2.5s)" : "(within Google's recommended range)"
      }.`
    );
  }

  return {
    id: "mobile-experience",
    title: "Mobile Experience Score",
    score: ps.mobileScore,
    status: statusFromScore(ps.mobileScore),
    summary:
      ps.mobileScore >= 75
        ? "Mobile experience is strong."
        : ps.mobileScore >= 45
        ? "Mobile experience needs improvement."
        : "Mobile experience is poor and likely losing customers.",
    details,
    source: "live-api",
  };
}

// ---------------------------------------------------------------------
// 3. SEO SNAPSHOT (PageSpeed SEO audit + on-page checks from scraper)
// ---------------------------------------------------------------------
export function scoreSeoSnapshot(ps: PageSpeedResult, site: ScrapedSite): ScoreCard {
  let score = 0;
  const details: string[] = [];
  const maxOnPage = 40;
  let onPage = 0;

  if (site.title && site.title.length >= 10 && site.title.length <= 65) {
    onPage += 15;
    details.push(`Title tag present and well-sized (${site.title.length} characters).`);
  } else if (site.title) {
    onPage += 5;
    details.push(`Title tag present but poorly sized (${site.title.length} characters) — aim for 10-65.`);
  } else {
    details.push("Missing <title> tag — a basic but critical SEO gap.");
  }

  if (site.metaDescription && site.metaDescription.length >= 50) {
    onPage += 15;
    details.push("Meta description present and reasonably descriptive.");
  } else {
    details.push("Meta description missing or too short — hurts click-through from search results.");
  }

  if (site.h1Texts.length === 1) {
    onPage += 10;
    details.push("Exactly one H1 heading found (best practice).");
  } else if (site.h1Texts.length > 1) {
    onPage += 4;
    details.push(`${site.h1Texts.length} H1 headings found — search engines prefer a single clear H1.`);
  } else {
    details.push("No H1 heading found on the page.");
  }

  score += Math.min(maxOnPage, onPage);

  if (ps.checked && ps.seoScore !== null) {
    score += Math.round(ps.seoScore * 0.6); // 60 points from Lighthouse SEO audit
    details.push(`Google Lighthouse technical SEO score: ${ps.seoScore}/100.`);
  } else {
    score += 30; // neutral half credit
    details.push("Automated technical SEO audit (Lighthouse) unavailable for this run.");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    id: "seo-snapshot",
    title: "SEO Snapshot",
    score,
    status: statusFromScore(score),
    summary:
      score >= 75
        ? "SEO foundation is solid."
        : score >= 45
        ? "SEO has fixable gaps."
        : "SEO foundation is weak — the site is likely hard to find on Google.",
    details,
    source: "live-api",
  };
}

// ---------------------------------------------------------------------
// 4. WEBSITE AUDIT — positioning clarity, CTA presence, trust signals
// ---------------------------------------------------------------------
export function scoreWebsiteAudit(site: ScrapedSite): ScoreCard {
  let score = 0;
  const details: string[] = [];

  // Positioning/messaging clarity — 30 points
  if (site.h1Texts.length > 0 && site.h1Texts[0].split(" ").length >= 4) {
    score += 15;
    details.push(`Headline found: "${truncate(site.h1Texts[0], 80)}" — clear enough to convey a message.`);
  } else {
    details.push("No clear headline (H1) that states what the business does.");
  }
  if (site.metaDescription) {
    score += 15;
    details.push("Meta description gives a one-line summary of the business.");
  } else {
    details.push("No meta description — visitors and search engines get no quick summary.");
  }

  // CTA presence — 30 points
  if (site.ctaCount >= 2) {
    score += 30;
    details.push(`${site.ctaCount} clear call-to-action element(s) detected (e.g. ${site.ctaButtons.slice(0, 3).join(", ")}).`);
  } else if (site.ctaCount === 1) {
    score += 15;
    details.push("Only one call-to-action detected — consider repeating it across the page.");
  } else {
    details.push("No clear call-to-action detected — visitors have no obvious next step.");
  }

  // Trust signals — 25 points
  const trustHits = Object.values(site.trustSignals).filter(Boolean).length;
  const trustScore = Math.round((trustHits / 6) * 25);
  score += trustScore;
  details.push(`${trustHits}/6 trust signal types detected (testimonials, reviews, certifications, client logos, social proof numbers, security badges).`);

  // Contact accessibility — 15 points
  const contactHits = [site.hasPhoneNumber, site.hasEmail, site.hasAddress].filter(Boolean).length;
  score += Math.round((contactHits / 3) * 15);
  if (contactHits < 2) {
    details.push("Limited contact information visible — this raises friction for cautious buyers.");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    id: "website-audit",
    title: "Website Audit",
    score,
    status: statusFromScore(score),
    summary:
      score >= 75
        ? "Website communicates clearly and builds trust well."
        : score >= 45
        ? "Website has decent bones but clear gaps in messaging or trust."
        : "Website is not doing its job — unclear messaging and weak trust signals.",
    details,
    source: "scraper",
  };
}

// ---------------------------------------------------------------------
// 5. FIRST IMPRESSION SCORE (fast-glance combination: speed + clarity + trust)
// ---------------------------------------------------------------------
export function scoreFirstImpression(
  ps: PageSpeedResult,
  site: ScrapedSite,
  ssl: SslResult
): ScoreCard {
  let score = 0;
  const details: string[] = [];

  // Load speed - visitors judge in seconds - 35 points
  if (ps.checked && ps.mobileScore !== null) {
    score += Math.round(ps.mobileScore * 0.35);
    details.push(`Page speed score contributes ${Math.round(ps.mobileScore * 0.35)}/35 points.`);
  } else {
    score += 17;
  }

  // Immediate clarity - headline + CTA visible - 35 points
  const hasHeadline = site.h1Texts.length > 0;
  const hasCta = site.ctaCount > 0;
  if (hasHeadline && hasCta) {
    score += 35;
    details.push("Clear headline and call-to-action are both present — good first impression fundamentals.");
  } else if (hasHeadline || hasCta) {
    score += 18;
    details.push(hasHeadline ? "Headline present but no clear CTA visible." : "CTA present but no clear headline.");
  } else {
    details.push("No headline or CTA — a first-time visitor won't immediately understand the offer.");
  }

  // Security/trust at a glance - 30 points
  if (ssl.valid) {
    score += 15;
  } else {
    details.push("Missing SSL padlock is a first-impression trust breaker for many visitors.");
  }
  const trustHits = Object.values(site.trustSignals).filter(Boolean).length;
  score += Math.min(15, trustHits * 3);

  score = Math.max(0, Math.min(100, score));

  return {
    id: "first-impression",
    title: "First Impression Score",
    score,
    status: statusFromScore(score),
    summary:
      score >= 75
        ? "Strong first impression within the first few seconds."
        : score >= 45
        ? "Average first impression — some friction for new visitors."
        : "Weak first impression — likely to lose visitors within seconds.",
    details,
    source: "rule-engine",
  };
}

// ---------------------------------------------------------------------
// 6. TRUST & CREDIBILITY SCORE
// ---------------------------------------------------------------------
export function scoreTrustCredibility(
  site: ScrapedSite,
  ssl: SslResult,
  blacklist: BlacklistResult
): ScoreCard {
  let score = 0;
  const details: string[] = [];

  if (ssl.valid) {
    score += 20;
  } else {
    details.push("No valid SSL — biggest single credibility red flag for a modern website.");
  }

  if (blacklist.checked && !blacklist.isBlacklisted) {
    score += 15;
  } else if (blacklist.isBlacklisted) {
    details.push("Domain is blacklisted — this is a severe credibility issue.");
  }

  const trustHits = Object.values(site.trustSignals).filter(Boolean).length;
  score += Math.round((trustHits / 6) * 35);
  details.push(`${trustHits}/6 trust-signal categories present on the page.`);

  if (site.hasAboutPage) {
    score += 10;
  } else {
    details.push("No visible About page/section — reduces perceived transparency.");
  }
  if (site.hasPrivacyPolicy) {
    score += 10;
  } else {
    details.push("No Privacy Policy found — a compliance and trust gap.");
  }
  const contactHits = [site.hasPhoneNumber, site.hasEmail, site.hasAddress].filter(Boolean).length;
  score += Math.round((contactHits / 3) * 10);

  score = Math.max(0, Math.min(100, score));

  return {
    id: "trust-credibility",
    title: "Trust & Credibility Score",
    score,
    status: statusFromScore(score),
    summary:
      score >= 75
        ? "Site presents strong trust signals."
        : score >= 45
        ? "Some trust elements are missing."
        : "Site is missing most trust-building elements customers look for.",
    details,
    source: "rule-engine",
  };
}

// ---------------------------------------------------------------------
// 7. WEBSITE-TO-SALE FRICTION POINTS
// ---------------------------------------------------------------------
export function scoreFriction(site: ScrapedSite): ScoreCard {
  const frictionPoints: string[] = [];
  let frictionCount = 0;

  if (site.ctaCount === 0) {
    frictionPoints.push("No clear call-to-action — visitor doesn't know the next step.");
    frictionCount++;
  }
  if (!site.hasPhoneNumber && !site.hasEmail) {
    frictionPoints.push("No visible phone number or email — visitor has no easy way to reach the business.");
    frictionCount++;
  }
  if (site.wordCount < 150) {
    frictionPoints.push("Very little page content — visitors may not get enough information to decide.");
    frictionCount++;
  }
  if (!site.trustSignals.testimonials && !site.trustSignals.reviews) {
    frictionPoints.push("No testimonials or reviews — nothing to reduce a stranger's hesitation to buy.");
    frictionCount++;
  }
  if (site.socialLinks.length === 0) {
    frictionPoints.push("No social media links — reduces cross-channel trust verification.");
    frictionCount++;
  }

  const score = Math.max(0, 100 - frictionCount * 20);

  return {
    id: "friction-points",
    title: "Website-to-Sale Friction Points",
    score,
    status: statusFromScore(score),
    summary:
      frictionCount === 0
        ? "No major friction points detected."
        : `${frictionCount} friction point(s) likely slowing down conversions.`,
    details: frictionPoints.length ? frictionPoints : ["No significant friction points detected in the automated checks."],
    source: "rule-engine",
  };
}

// ---------------------------------------------------------------------
// 8. GROWTH STAGE MISMATCH WARNING
// ---------------------------------------------------------------------
export function scoreGrowthStageMismatch(input: BusinessInput, site: ScrapedSite, seoScore: number | null): ScoreCard {
  const sophisticationSignals = [
    site.trustSignals.testimonials,
    site.trustSignals.certifications,
    site.hasAboutPage,
    site.hasPrivacyPolicy,
    (seoScore ?? 0) >= 60,
  ].filter(Boolean).length; // 0-5

  let mismatch = false;
  let note = "";

  if (input.businessStage === "established" && sophisticationSignals <= 2) {
    mismatch = true;
    note = "Business describes itself as established, but the website looks like an early-stage site — this mismatch can cost credibility with bigger prospects.";
  } else if (input.businessStage === "idea" && sophisticationSignals >= 4) {
    mismatch = false;
    note = "Website is more built-out than expected for an idea-stage business — that's a good sign, not a problem.";
  } else if (input.businessStage === "startup" && sophisticationSignals === 0) {
    mismatch = true;
    note = "Even early-stage startups benefit from at least one trust signal (About page, contact info) — currently none detected.";
  } else {
    note = "Website sophistication roughly matches the declared business stage.";
  }

  const score = mismatch ? 35 : 80;

  return {
    id: "growth-stage-mismatch",
    title: "Growth Stage Mismatch Warning",
    score,
    status: mismatch ? "warning" : "good",
    summary: mismatch ? "Website and business stage don't align." : "Website matches the stated business stage.",
    details: [note],
    source: "rule-engine",
  };
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
