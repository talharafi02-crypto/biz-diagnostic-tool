import * as cheerio from "cheerio";

export interface ScrapedSite {
  fetched: boolean;
  statusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  h1Texts: string[];
  wordCount: number;
  hasPhoneNumber: boolean;
  hasEmail: boolean;
  hasAddress: boolean;
  ctaButtons: string[]; // detected call-to-action link/button texts
  ctaCount: number;
  trustSignals: {
    testimonials: boolean;
    reviews: boolean;
    certifications: boolean;
    clientLogos: boolean;
    socialProofNumbers: boolean; // "500+ customers" style claims
    securityBadges: boolean;
  };
  socialLinks: string[];
  hasPrivacyPolicy: boolean;
  hasAboutPage: boolean;
  imageCount: number;
  imagesWithAlt: number;
  hasCanonical: boolean;
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  error: string | null;
}

const CTA_PATTERNS =
  /\b(book|schedule|get started|contact us|call now|buy now|shop now|sign up|request a quote|get a quote|free trial|download|subscribe|order now|talk to us|book a call|book now|learn more|apply now|get in touch)\b/i;

const TESTIMONIAL_PATTERNS = /\b(testimonial|what our clients say|customer review|success stor)/i;
const REVIEW_PATTERNS = /\b(review|rating|stars?|trustpilot|google reviews)\b/i;
const CERT_PATTERNS = /\b(certified|accredited|licensed|award|iso \d{4}|member of)\b/i;
const SOCIAL_PROOF_NUMBER_PATTERN = /\b(\d{2,}\+?\s*(customers|clients|users|businesses|projects|reviews))\b/i;
const SECURITY_BADGE_PATTERNS = /\b(ssl secure|secure checkout|money[- ]back guarantee|satisfaction guarantee|verified)\b/i;

/**
 * Fetches the live HTML and extracts structural, rule-based signals.
 * No AI guessing here - every field is a deterministic regex/DOM check, so
 * the same page always produces the same extraction, which is what feeds
 * the deterministic scoring layer downstream.
 */
export async function scrapeSite(url: string): Promise<ScrapedSite> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BizDiagnosticBot/1.0; +https://example.com/bot)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    const statusCode = res.status;
    if (!res.ok) {
      return emptyResult(false, statusCode, `Site returned HTTP ${statusCode}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    const title = $("title").first().text().trim() || null;
    const metaDescription =
      $('meta[name="description"]').attr("content")?.trim() || null;
    const h1Texts = $("h1")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const hasPhoneNumber = /(\+?\d[\d\s().-]{7,}\d)/.test(bodyText);
    const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(bodyText);
    const hasAddress = /\b\d{1,5}\s+\w+.*(street|st\.|road|rd\.|avenue|ave\.|lane|blvd)\b/i.test(
      bodyText
    );

    const clickableTexts = $("a, button")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      // Strip emoji so downstream reports stay plain-text/professional even
      // when the audited site's own buttons use them.
      .map((t) =>
        t
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);
    const ctaButtons = [...new Set(clickableTexts.filter((t) => CTA_PATTERNS.test(t)))];

    const socialLinks = $("a[href]")
      .map((_, el) => $(el).attr("href") || "")
      .get()
      .filter((href) =>
        /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com/i.test(
          href
        )
      );

    const hasPrivacyPolicy =
      $('a[href*="privacy" i]').length > 0 || /privacy policy/i.test(bodyText);
    const hasAboutPage =
      $('a[href*="about" i]').length > 0 || /about us/i.test(bodyText);

    const images = $("img");
    const imageCount = images.length;
    const imagesWithAlt = images.filter((_, el) => !!$(el).attr("alt")?.trim()).length;

    const hasCanonical = $('link[rel="canonical"]').length > 0;

    const structuredDataTypes: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).contents().text());
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && typeof item === "object" && "@type" in item) {
            structuredDataTypes.push(String((item as { "@type": unknown })["@type"]));
          }
        }
      } catch {
        // malformed JSON-LD on the target site, ignore and move on
      }
    });

    return {
      fetched: true,
      statusCode,
      title,
      metaDescription,
      h1Texts,
      wordCount: bodyText.split(" ").filter(Boolean).length,
      hasPhoneNumber,
      hasEmail,
      hasAddress,
      ctaButtons,
      ctaCount: ctaButtons.length,
      trustSignals: {
        testimonials: TESTIMONIAL_PATTERNS.test(bodyText) || TESTIMONIAL_PATTERNS.test(html),
        reviews: REVIEW_PATTERNS.test(bodyText),
        certifications: CERT_PATTERNS.test(bodyText),
        clientLogos: /client|trusted by|as seen (in|on)/i.test(bodyText) && $("img").length > 3,
        socialProofNumbers: SOCIAL_PROOF_NUMBER_PATTERN.test(bodyText),
        securityBadges: SECURITY_BADGE_PATTERNS.test(bodyText),
      },
      socialLinks: [...new Set(socialLinks)],
      hasPrivacyPolicy,
      hasAboutPage,
      imageCount,
      imagesWithAlt,
      hasCanonical,
      hasStructuredData: structuredDataTypes.length > 0,
      structuredDataTypes: [...new Set(structuredDataTypes)],
      error: null,
    };
  } catch (e) {
    return emptyResult(false, null, e instanceof Error ? e.message : "Unknown scrape error");
  }
}

function emptyResult(fetched: boolean, statusCode: number | null, error: string): ScrapedSite {
  return {
    fetched,
    statusCode,
    title: null,
    metaDescription: null,
    h1Texts: [],
    wordCount: 0,
    hasPhoneNumber: false,
    hasEmail: false,
    hasAddress: false,
    ctaButtons: [],
    ctaCount: 0,
    trustSignals: {
      testimonials: false,
      reviews: false,
      certifications: false,
      clientLogos: false,
      socialProofNumbers: false,
      securityBadges: false,
    },
    socialLinks: [],
    hasPrivacyPolicy: false,
    hasAboutPage: false,
    imageCount: 0,
    imagesWithAlt: 0,
    hasCanonical: false,
    hasStructuredData: false,
    structuredDataTypes: [],
    error,
  };
}
