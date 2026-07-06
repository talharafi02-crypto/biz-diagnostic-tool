export interface BlacklistResult {
  checked: boolean;
  isBlacklisted: boolean;
  threats: string[];
  error: string | null;
}

/**
 * Google Safe Browsing "lookup" API - free, no cost tier for reasonable
 * volume. Returns real threat matches for a URL (malware, phishing, unwanted
 * software). Requires GOOGLE_SAFE_BROWSING_API_KEY in env.
 */
export async function checkBlacklist(url: string): Promise<BlacklistResult> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) {
    return {
      checked: false,
      isBlacklisted: false,
      threats: [],
      error: "GOOGLE_SAFE_BROWSING_API_KEY not configured",
    };
  }

  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "biz-diagnostic-tool", clientVersion: "1.0.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      return {
        checked: false,
        isBlacklisted: false,
        threats: [],
        error: `Safe Browsing API error (HTTP ${res.status})`,
      };
    }

    const data = await res.json();
    const matches: { threatType: string }[] = data.matches || [];

    return {
      checked: true,
      isBlacklisted: matches.length > 0,
      threats: matches.map((m) => m.threatType),
      error: null,
    };
  } catch (e) {
    return {
      checked: false,
      isBlacklisted: false,
      threats: [],
      error: e instanceof Error ? e.message : "Unknown Safe Browsing error",
    };
  }
}
