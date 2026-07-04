export interface DomainAgeResult {
  found: boolean;
  registeredOn: string | null;
  ageInDays: number | null;
  registrar: string | null;
  error: string | null;
}

/**
 * RDAP (rdap.org) is the free, modern replacement for WHOIS text-scraping.
 * No API key, no rate-limit surprises for our scale, and it returns
 * structured JSON, so results are deterministic (no regex guessing).
 */
export async function checkDomainAge(hostname: string): Promise<DomainAgeResult> {
  const bareDomain = hostname.replace(/^www\./, "");
  try {
    const res = await fetch(`https://rdap.org/domain/${bareDomain}`, {
      headers: { Accept: "application/rdap+json" },
      // RDAP lookups can be slow for some TLDs
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        found: false,
        registeredOn: null,
        ageInDays: null,
        registrar: null,
        error: `RDAP lookup failed (HTTP ${res.status})`,
      };
    }

    const data = await res.json();

    const registrationEvent = (data.events || []).find(
      (e: { eventAction: string; eventDate: string }) =>
        e.eventAction === "registration"
    );

    if (!registrationEvent) {
      return {
        found: true,
        registeredOn: null,
        ageInDays: null,
        registrar: extractRegistrar(data),
        error: "No registration date in RDAP record (common for some TLDs/privacy setups)",
      };
    }

    const registeredOn = registrationEvent.eventDate;
    const ageInDays = Math.round(
      (Date.now() - new Date(registeredOn).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      found: true,
      registeredOn,
      ageInDays,
      registrar: extractRegistrar(data),
      error: null,
    };
  } catch (e) {
    return {
      found: false,
      registeredOn: null,
      ageInDays: null,
      registrar: null,
      error: e instanceof Error ? e.message : "Unknown RDAP error",
    };
  }
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, string][]];
}

function extractRegistrar(data: { entities?: RdapEntity[] }): string | null {
  const registrarEntity = (data.entities || []).find((e) =>
    e.roles?.includes("registrar")
  );
  if (!registrarEntity?.vcardArray) return null;
  const fnField = registrarEntity.vcardArray[1]?.find((f) => f[0] === "fn");
  return (fnField?.[3] as string) ?? null;
}
