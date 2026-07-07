import * as cheerio from "cheerio";
import { scrapeSite } from "./scraper";

export interface CompetitorSummary {
  name: string;
  url: string;
  hasCta: boolean;
  trustSignalCount: number;
  hasBlogOrContent: boolean;
}

export interface CompetitorIntelResult {
  checked: boolean;
  competitors: CompetitorSummary[];
  error: string | null;
}

/**
 * FREE, NO-KEY VERSION - uses DuckDuckGo's public HTML search results page
 * (no account, no API key, no card) to find real competitor websites, then
 * reuses the SAME deterministic scraper used for the main site so the
 * comparison is apples-to-apples.
 * Note: this is an unofficial method (no official free DuckDuckGo API
 * exists) - kept deliberately lightweight (1 search, top 3 results) to
 * stay respectful of their servers. If DuckDuckGo ever blocks/changes
 * this page, this module fails gracefully (see catch block) rather than
 * breaking the rest of the report.
 */
export async function checkCompetitorIntel(
  businessType: string,
  location: string,
  ownDomain: string
): Promise<CompetitorIntelResult> {
  try {
    const query = encodeURIComponent(`${businessType} ${location}`);
    const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BusinessMarketingDiagnosticTool/1.0)" },
      signal: AbortSignal.timeout(5000),
    });

    if (!searchRes.ok) {
      return { checked: false, competitors: [], error: `Search failed (HTTP ${searchRes.status})` };
    }

    const html = await searchRes.text();
    const $ = cheerio.load(html);

    const blockedHosts = ["facebook.com", "yelp.com", "youtube.com", "wikipedia.org", "instagram.com", "linkedin.com", "duckduckgo.com"];
    const candidates: { title: string; url: string }[] = [];

    $(".result__a").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const title = $(el).text().trim();
      // DuckDuckGo's HTML page wraps real URLs inside a redirect param
      const match = href.match(/uddg=([^&]+)/);
      const realUrl = match ? decodeURIComponent(match[1]) : href;
      if (!realUrl.startsWith("http")) return;
      if (realUrl.includes(ownDomain)) return;
      if (blockedHosts.some((h) => realUrl.includes(h))) return;
      candidates.push({ title, url: realUrl });
    });

    const topCandidates = candidates.slice(0, 3);

    // Scrape all candidates IN PARALLEL, not one at a time. Sequential
    // scraping here used to be able to take up to 3x a single scrape's
    // timeout, which alone could blow past a serverless function's time
    // limit. Promise.allSettled means one slow/broken competitor site
    // never blocks the others.
    const results = await Promise.allSettled(topCandidates.map((c) => scrapeSite(c.url)));

    const competitors: CompetitorSummary[] = [];
    results.forEach((result, i) => {
      if (result.status !== "fulfilled" || !result.value.fetched) return;
      const scraped = result.value;
      const c = topCandidates[i];
      const trustSignalCount = Object.values(scraped.trustSignals).filter(Boolean).length;
      competitors.push({
        name: c.title || c.url,
        url: c.url,
        hasCta: scraped.ctaCount > 0,
        trustSignalCount,
        hasBlogOrContent: scraped.wordCount > 600,
      });
    });

    if (competitors.length === 0) {
      return { checked: false, competitors: [], error: "No usable competitor results found" };
    }

    return { checked: true, competitors, error: null };
  } catch (e) {
    return {
      checked: false,
      competitors: [],
      error: e instanceof Error ? e.message : "Unknown competitor intel error",
    };
  }
}
