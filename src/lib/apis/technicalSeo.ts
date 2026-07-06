export interface TechnicalSeoResult {
  checked: boolean;
  hasRobotsTxt: boolean;
  hasSitemap: boolean;
  sitemapBlockedInRobots: boolean;
  error: string | null;
}

/**
 * Checks the two most basic technical SEO files search engines look for.
 * Both are simple HTTP fetches, no key or account needed. Deterministic:
 * same URL will always return the same presence/absence unless the site
 * itself changes.
 */
export async function checkTechnicalSeo(websiteUrl: string): Promise<TechnicalSeoResult> {
  try {
    const origin = new URL(websiteUrl).origin;

    const [robotsRes, sitemapRes] = await Promise.all([
      fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
      fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
    ]);

    const hasRobotsTxt = !!robotsRes && robotsRes.ok;
    const hasSitemap = !!sitemapRes && sitemapRes.ok;

    let sitemapBlockedInRobots = false;
    if (hasRobotsTxt && robotsRes) {
      const robotsText = await robotsRes.text();
      sitemapBlockedInRobots = /disallow:\s*\/sitemap/i.test(robotsText);
    }

    return { checked: true, hasRobotsTxt, hasSitemap, sitemapBlockedInRobots, error: null };
  } catch (e) {
    return {
      checked: false,
      hasRobotsTxt: false,
      hasSitemap: false,
      sitemapBlockedInRobots: false,
      error: e instanceof Error ? e.message : "Technical SEO check failed",
    };
  }
}
