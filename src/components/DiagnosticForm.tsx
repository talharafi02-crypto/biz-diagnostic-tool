"use client";

import { useState } from "react";
import { BusinessInput, DiagnosticReport } from "@/lib/types";
import ReportDashboard from "./ReportDashboard";

const initialState: BusinessInput = {
  businessType: "",
  productService: "",
  location: "",
  budget: "low",
  businessStage: "startup",
  websiteUrl: "",
};

export default function DiagnosticForm() {
  const [form, setForm] = useState<BusinessInput>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [lastDetectedUrl, setLastDetectedUrl] = useState<string | null>(null);

  function update<K extends keyof BusinessInput>(key: K, value: BusinessInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleAutoDetect() {
    let url = form.websiteUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (url === lastDetectedUrl) return; // already tried this exact URL

    setDetecting(true);
    setDetectNote(null);
    try {
      const res = await fetch("/api/autodetect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: url }),
      });
      const data = await res.json();
      setLastDetectedUrl(url);
      if (!res.ok) {
        setDetectNote("Couldn't auto-detect from this site — please fill the fields manually.");
        return;
      }
      setForm((f) => ({
        ...f,
        businessType: data.businessType || f.businessType,
        productService: data.productService || f.productService,
        location: data.location || f.location,
      }));
      if (data.note) {
        setDetectNote(data.note);
      } else {
        setDetectNote("Auto-filled from your website — please check these are correct before running the diagnostic.");
      }
    } catch {
      setDetectNote("Couldn't auto-detect from this site — please fill the fields manually.");
    } finally {
      setDetecting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setReport(null);
    try {
      let url = form.websiteUrl.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, websiteUrl: url }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Something went wrong running the diagnostic.");
      }
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  if (report) {
    return <ReportDashboard report={report} onReset={() => setReport(null)} />;
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <header className="mb-10">
          <p
            className="font-data text-xs tracking-widest uppercase mb-3"
            style={{ color: "var(--ink-soft)" }}
          >
            Business Marketing Diagnostic
          </p>
          <h1 className="font-display text-4xl leading-tight" style={{ color: "var(--ink)" }}>
            A full checkup for your business's marketing.
          </h1>
          <p className="mt-3 text-base" style={{ color: "var(--ink-soft)" }}>
            Enter your business details once. We pull live data from your website and
            the web, run it through a fixed diagnostic checklist, and hand you a clear,
            repeatable report — not a guess.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Website URL" hint="We'll scan this and try to auto-fill the fields below">
            <input
              required
              className="input"
              value={form.websiteUrl}
              onChange={(e) => update("websiteUrl", e.target.value)}
              onBlur={handleAutoDetect}
              placeholder="www.yourbusiness.com"
            />
          </Field>

          {detecting && (
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Reading your website to auto-fill the fields below…
            </p>
          )}
          {detectNote && !detecting && (
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              {detectNote}
            </p>
          )}

          <Field label="Business type" hint="e.g. Dental clinic, SaaS product, restaurant — auto-filled, edit if wrong">
            <input
              required
              className="input"
              value={form.businessType}
              onChange={(e) => update("businessType", e.target.value)}
              placeholder="Dental clinic"
            />
          </Field>

          <Field label="Product or service" hint="What do you actually sell? — auto-filled, edit if wrong">
            <input
              required
              className="input"
              value={form.productService}
              onChange={(e) => update("productService", e.target.value)}
              placeholder="Teeth whitening and general dentistry"
            />
          </Field>

          <Field label="Location" hint="City and country — auto-filled if detectable, edit if wrong">
            <input
              required
              className="input"
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Lahore, Pakistan"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Monthly marketing investment" hint="Even if you're not spending anything yet">
              <select
                className="input"
                value={form.budget}
                onChange={(e) => update("budget", e.target.value as BusinessInput["budget"])}
              >
                <option value="none">Not spending anything right now</option>
                <option value="low">Under $500/mo</option>
                <option value="medium">$500 – $2,000/mo</option>
                <option value="high">$2,000+/mo</option>
              </select>
            </Field>

            <Field label="Business stage">
              <select
                className="input"
                value={form.businessStage}
                onChange={(e) =>
                  update("businessStage", e.target.value as BusinessInput["businessStage"])
                }
              >
                <option value="idea">Idea stage</option>
                <option value="startup">Startup (0-2 years)</option>
                <option value="growing">Growing</option>
                <option value="established">Established</option>
              </select>
            </Field>
          </div>

          {error && (
            <div
              className="text-sm rounded-md px-4 py-3"
              style={{ background: "#f6e4e0", color: "var(--critical)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-md font-data text-sm tracking-wide uppercase transition-opacity disabled:opacity-60"
            style={{ background: "var(--ink)", color: "var(--paper-raised)" }}
          >
            {loading ? "Running diagnostic — this takes about 30-60 seconds…" : "Run diagnostic"}
          </button>
        </form>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          padding: 0.65rem 0.85rem;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--paper-raised);
          color: var(--ink);
          font-size: 0.95rem;
        }
        .input:focus {
          outline: 2px solid var(--good);
          outline-offset: 1px;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1" style={{ color: "var(--ink)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}
