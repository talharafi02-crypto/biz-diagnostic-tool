export interface LocalCompetitionResult {
  checked: boolean;
  competitorCount: number | null;
  densityLevel: "low" | "medium" | "high" | null;
  topCompetitorNames: string[];
  error: string | null;
}

/**
 * FREE, NO-KEY VERSION — uses OpenStreetMap (Nominatim for geocoding the
 * location, Overpass API for counting nearby businesses of the same type).
 * No account, no card, no API key, no signup required at all.
 * We keep requests light (1 geocode + 1 Overpass query) to stay within
 * OSM's public fair-use policy.
 */
export async function checkLocalCompetition(
  businessType: string,
  location: string
): Promise<LocalCompetitionResult> {
  try {
    // Step 1: geocode the location to lat/lng via Nominatim (free, no key)
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`,
      { headers: { "User-Agent": "BusinessMarketingDiagnosticTool/1.0 (student FYP project)" } }
    );
    if (!geoRes.ok) {
      return { checked: false, competitorCount: null, densityLevel: null, topCompetitorNames: [], error: `Geocoding failed (HTTP ${geoRes.status})` };
    }
    const geoData: { lat: string; lon: string }[] = await geoRes.json();
    if (geoData.length === 0) {
      return { checked: false, competitorCount: null, densityLevel: null, topCompetitorNames: [], error: "Location not found" };
    }
    const { lat, lon } = geoData[0];

    // Step 2: Overpass query — search a 3km radius for named places, then
    // keyword-match against the business type (best-effort free-text match
    // against OSM tags).
    const radiusMeters = 3000;
    const keyword = businessType.trim().toLowerCase();
    const overpassQuery = `
      [out:json][timeout:15];
      (
        node["name"](around:${radiusMeters},${lat},${lon});
        way["name"](around:${radiusMeters},${lat},${lon});
      );
      out center 60;
    `;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: overpassQuery,
    });

    if (!overpassRes.ok) {
      return { checked: false, competitorCount: null, densityLevel: null, topCompetitorNames: [], error: `Overpass API error (HTTP ${overpassRes.status})` };
    }

    const overpassData = await overpassRes.json();
    const elements: { tags?: Record<string, string> }[] = overpassData.elements ?? [];

    // Keep only places whose OSM tags plausibly match the business type —
    // fixed substring match, so results are reproducible for the same input.
    const keywordTokens = keyword.split(/\s+/).filter((t) => t.length > 2);
    const matches = elements.filter((el) => {
      const haystack = Object.values(el.tags ?? {}).join(" ").toLowerCase();
      return keywordTokens.some((t) => haystack.includes(t));
    });

    const count = matches.length;
    const densityLevel: LocalCompetitionResult["densityLevel"] =
      count <= 4 ? "low" : count <= 12 ? "medium" : "high";

    return {
      checked: true,
      competitorCount: count,
      densityLevel,
      topCompetitorNames: matches.slice(0, 5).map((m) => m.tags?.name ?? "Unnamed"),
      error: null,
    };
  } catch (e) {
    return {
      checked: false,
      competitorCount: null,
      densityLevel: null,
      topCompetitorNames: [],
      error: e instanceof Error ? e.message : "Unknown local competition error",
    };
  }
}
