import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scrapeSite } from "@/lib/apis/scraper";

const schema = z.object({ websiteUrl: z.string().url() });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/**
 * Best-effort auto-fill: scrapes the site's visible text (title, meta
 * description, headings, footer) and asks Gemini to infer business type,
 * what they sell, and a likely city/country. This is a CONVENIENCE feature,
 * not a fact source — the frontend always shows these as editable fields
 * so the business owner can correct anything the model gets wrong. No
 * score or report content is ever generated from this guess alone.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request. websiteUrl is required." }, { status: 400 });
  }

  const { websiteUrl } = parsed.data;

  try {
    const site = await scrapeSite(websiteUrl);
    if (!site.fetched) {
      return NextResponse.json(
        { error: site.error || "Could not fetch that website." },
        { status: 422 }
      );
    }

    if (!GROQ_API_KEY) {
      // No AI configured — return whatever raw signal we can without it.
      return NextResponse.json({
        businessType: "",
        productService: "",
        location: "",
        note: "Auto-detect needs GROQ_API_KEY to be configured. Fields left blank for manual entry.",
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

    const prompt = `Based ONLY on this scraped website content, guess:
1. businessType: a short label (2-4 words), e.g. "Dental clinic", "SaaS product", "Coffee shop"
2. productService: one short sentence on what they actually sell
3. location: city and country if you can find any clue (address, phone code, currency, language) — otherwise return an empty string, never invent one

Website content:
"""
${pageText}
"""

Respond with ONLY this JSON shape, no markdown:
{ "businessType": string, "productService": string, "location": string, "confidence": "high"|"medium"|"low" }`;

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
