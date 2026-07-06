import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scrapeSite } from "@/lib/apis/scraper";
import { checkDomainAge } from "@/lib/apis/domainAge";

const schema = z.object({ websiteUrl: z.string().url() });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/**
 * Best-effort auto-fill: scrapes the site's visible text (title, meta
 * description, headings, footer), checks how old the domain is, and asks
 * the model to infer business type, what they sell, a likely city/country,
 * and a likely business stage. This is a CONVENIENCE feature, not a fact
 * source. The frontend always shows these as editable fields so the
 * business owner can correct anything the model gets wrong. No score or
 * report content is ever generated from this guess alone. Monthly budget
 * is intentionally NOT auto-filled: it is the owner's own financial
 * decision, not something a website can reveal.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request. websiteUrl is required." }, { status: 400 });
  }

  const { websiteUrl } = parsed.data;

  try {
    const hostname = new URL(websiteUrl).hostname;
    const [site, domainAge] = await Promise.all([
      scrapeSite(websiteUrl),
      checkDomainAge(hostname).catch(() => null),
    ]);

    if (!site.fetched) {
      return NextResponse.json(
        { error: site.error || "Could not fetch that website." },
        { status: 422 }
      );
    }

    if (!GROQ_API_KEY) {
      // No AI configured. Fall back to a simple domain-age heuristic for
      // stage, leave the rest blank for manual entry.
      const ageYears = domainAge?.ageInDays ? domainAge.ageInDays / 365 : null;
      return NextResponse.json({
        businessType: "",
        productService: "",
        location: "",
        businessStage: ageYears === null ? "" : ageYears < 1 ? "idea" : ageYears < 3 ? "startup" : ageYears < 8 ? "growing" : "established",
        note: "Auto-detect needs GROQ_API_KEY to be configured for full results. Business stage estimated from domain age only.",
      });
    }

    const pageText = [
      site.title,
      site.metaDescription,
      ...site.h1Texts,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 2000);

    const domainAgeNote =
      domainAge?.ageInDays !== null && domainAge?.ageInDays !== undefined
        ? `The domain is approximately ${(domainAge.ageInDays! / 365).toFixed(1)} years old.`
        : "Domain age could not be determined.";

    const prompt = `Based ONLY on this scraped website content, guess the following about the business:
1. businessType: a short label (2-4 words), for example "Dental clinic", "SaaS product", "Coffee shop"
2. productService: one short sentence on what they actually sell
3. location: city and country if you can find any clue (address, phone code, currency, language). Otherwise return an empty string, never invent one
4. businessStage: one of "idea", "startup", "growing", "established" based on the content tone, domain age, and any founding date or years-in-business mentioned

${domainAgeNote}

Website content:
"""
${pageText}
"""

Respond with ONLY this JSON shape, no markdown, no code fences, no emojis, no em-dashes:
{ "businessType": string, "productService": string, "location": string, "businessStage": "idea"|"startup"|"growing"|"established", "confidence": "high"|"medium"|"low" }`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `Groq API error (HTTP ${res.status}): ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await res.json();
    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No content in Groq response" }, { status: 500 });
    }

    const cleaned = content.replace(/```json|```/g, "").trim();
    const parsedGuess = JSON.parse(cleaned);

    return NextResponse.json(parsedGuess);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Auto-detect failed." },
      { status: 500 }
    );
  }
}
