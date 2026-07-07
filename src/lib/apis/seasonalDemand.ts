// @ts-expect-error - google-trends-api has no official TypeScript types
import googleTrends from "google-trends-api";

export interface SeasonalDemandResult {
  checked: boolean;
  peakMonths: string[];
  lowMonths: string[];
  volatility: "stable" | "seasonal" | "highly-seasonal" | null;
  error: string | null;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Google Trends is free and needs no API key, but it is an unofficial
 * endpoint (no SLA from Google) - so this module is always wrapped
 * defensively and the report never blocks or crashes if it's unavailable.
 * We pull the last 12 months of interest-over-time for the search term
 * and bucket it deterministically: same 12-month window + same term will
 * reliably produce the same peak/low months and volatility label.
 */
export async function checkSeasonalDemand(searchTerm: string): Promise<SeasonalDemandResult> {
  try {
    const trendsPromise = googleTrends.interestOverTime({
      keyword: searchTerm,
      startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Google Trends request timed out")), 6000)
    );
    const raw = await Promise.race([trendsPromise, timeoutPromise]);

    const parsed = JSON.parse(raw);
    const timelineData: { time: string; value: number[] }[] =
      parsed?.default?.timelineData ?? [];

    if (timelineData.length === 0) {
      return { checked: false, peakMonths: [], lowMonths: [], volatility: null, error: "No trend data returned for this term" };
    }

    // Aggregate weekly points into monthly averages
    const monthlyTotals = new Array(12).fill(0);
    const monthlyCounts = new Array(12).fill(0);
    for (const point of timelineData) {
      const date = new Date(Number(point.time) * 1000);
      const monthIndex = date.getMonth();
      const value = point.value?.[0] ?? 0;
      monthlyTotals[monthIndex] += value;
      monthlyCounts[monthIndex] += 1;
    }
    const monthlyAverages = monthlyTotals.map((total, i) => (monthlyCounts[i] ? total / monthlyCounts[i] : 0));

    const max = Math.max(...monthlyAverages);
    const min = Math.min(...monthlyAverages);
    const range = max - min;

    const peakMonths = monthlyAverages
      .map((v, i) => ({ v, i }))
      .filter((m) => m.v >= max * 0.9)
      .map((m) => MONTH_NAMES[m.i]);

    const lowMonths = monthlyAverages
      .map((v, i) => ({ v, i }))
      .filter((m) => m.v <= min * 1.1 + 0.01)
      .map((m) => MONTH_NAMES[m.i]);

    // Fixed thresholds on the min-max range (0-100 scale from Trends) -
    // deterministic bucketing, not a judgment call made per-run.
    const volatility: SeasonalDemandResult["volatility"] =
      range < 15 ? "stable" : range < 40 ? "seasonal" : "highly-seasonal";

    return { checked: true, peakMonths, lowMonths, volatility, error: null };
  } catch (e) {
    return {
      checked: false,
      peakMonths: [],
      lowMonths: [],
      volatility: null,
      error: e instanceof Error ? e.message : "Google Trends lookup failed",
    };
  }
}
