import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scrapeSite } from "@/lib/apis/scraper";
import { GoogleGenerativeAI } from "@google/generative-ai";

const schema = z.object({ websiteUrl: z.string().url() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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

    if (!process.env.GEMINI_API_KEY) {
      // No AI configured — return whatever raw signal we can without it.
      return NextResponse.json({
        businessType: "",
        productService: "",
        location: "",
        note: "Auto-detect needs GEMINI_API_KEY to be configured. Fields left blank for manual entry.",
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

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    });

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

    const result = await model.generateContent(prompt);
    const cleaned = result.response.text().replace(/```json|```/g, "").trim();
    const parsedGuess = JSON.parse(cleaned);

    return NextResponse.json(parsedGuess);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Auto-detect failed." },
      { status: 500 }
    );
  }
}
