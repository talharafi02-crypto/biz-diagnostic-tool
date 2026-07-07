export interface PageSpeedResult {
  checked: boolean;
  mobileScore: number | null; // 0-100, Lighthouse performance score
  seoScore: number | null; // 0-100, Lighthouse SEO score
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  isMobileFriendly: boolean | null;
  loadTimeSeconds: number | null; // Largest Contentful Paint, seconds
  error: string | null;
}

/**
 * PageSpeed Insights v5 - free (240 req/day without a key, much higher with
 * a free Google Cloud API key). Runs a real Lighthouse audit on the live
 * page. This is the same engine Google Search Console uses, so it's a
 * credible, deterministic source (repeat runs vary only by real-world
 * network jitter, which is why we round scores rather than showing
 * decimals as if they were exact).
 */
export async function checkPageSpeed(
  url: string,
  strategy: "mobile" | "desktop" = "mobile"
): Promise<PageSpeedResult> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY; // optional but recommended
  const keyParam = apiKey ? `&key=${apiKey}` : "";

  try {
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(
        url
      )}&strategy=${strategy}&category=performance&category=seo&category=accessibility&category=best-practices${keyParam}`,
      { signal: AbortSignal.timeout(7000) } // capped well under the 10s serverless function limit; falls back gracefully if Google is slow
    );

    if (!res.ok) {
      return {
        checked: false,
        mobileScore: null,
        seoScore: null,
        accessibilityScore: null,
        bestPracticesScore: null,
        isMobileFriendly: null,
        loadTimeSeconds: null,
        error: `PageSpeed API error (HTTP ${res.status})`,
      };
    }

    const data = await res.json();
    const categories = data.lighthouseResult?.categories;
    const audits = data.lighthouseResult?.audits;

    const toScore100 = (v: number | undefined) =>
      v === undefined ? null : Math.round(v * 100);

    const lcpSeconds = audits?.["largest-contentful-paint"]?.numericValue
      ? Math.round((audits["largest-contentful-paint"].numericValue / 1000) * 10) / 10
      : null;

    return {
      checked: true,
      mobileScore: toScore100(categories?.performance?.score),
      seoScore: toScore100(categories?.seo?.score),
      accessibilityScore: toScore100(categories?.accessibility?.score),
      bestPracticesScore: toScore100(categories?.["best-practices"]?.score),
      isMobileFriendly: audits?.["viewport"]?.score === 1,
      loadTimeSeconds: lcpSeconds,
      error: null,
    };
  } catch (e) {
    return {
      checked: false,
      mobileScore: null,
      seoScore: null,
      accessibilityScore: null,
      bestPracticesScore: null,
      isMobileFriendly: null,
      loadTimeSeconds: null,
      error: e instanceof Error ? e.message : "Unknown PageSpeed error",
    };
  }
}
