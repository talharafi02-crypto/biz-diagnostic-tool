"use client";

import { useState } from "react";
import { DiagnosticReport, ScoreCard } from "@/lib/types";

const statusColor: Record<ScoreCard["status"], string> = {
  good: "var(--good)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  info: "var(--info)",
};

export default function ReportDashboard({
  report,
  onReset,
}: {
  report: DiagnosticReport;
  onReset: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.input.businessType.replace(/\s+/g, "-")}-diagnostic-report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not generate the PDF right now. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  const measurable = report.cards.filter((c) => c.score !== null);
  const overallScore = measurable.length
    ? Math.round(measurable.reduce((s, c) => s + (c.score ?? 0), 0) / measurable.length)
    : null;

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <div className="max-w-4xl mx-auto px-6 py-14">
        <div className="flex items-start justify-between mb-8">
          <div>
            <p
              className="font-data text-xs tracking-widest uppercase mb-2"
              style={{ color: "var(--ink-soft)" }}
            >
              Diagnostic report — {new Date(report.generatedAt).toLocaleDateString()}
            </p>
            <h1 className="font-display text-3xl" style={{ color: "var(--ink)" }}>
              {report.input.businessType}
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
              {report.input.websiteUrl}
            </p>
          </div>
          {overallScore !== null && <ScoreGauge score={overallScore} />}
        </div>

        <div className="flex gap-3 mb-10">
          <button
            onClick={downloadPdf}
            disabled={downloading}
            className="px-5 py-2.5 rounded-md font-data text-sm uppercase tracking-wide"
            style={{ background: "var(--ink)", color: "var(--paper-raised)" }}
          >
            {downloading ? "Preparing PDF…" : "Download PDF report"}
          </button>
          <button
            onClick={onReset}
            className="px-5 py-2.5 rounded-md font-data text-sm uppercase tracking-wide border"
            style={{ borderColor: "var(--line)", color: "var(--ink)" }}
          >
            Run another
          </button>
        </div>

        {!report.aiAvailable && (
          <div
            className="rounded-md px-4 py-3 mb-8 text-sm"
            style={{ background: "#fff3cd", color: "#7a5c00", border: "1px solid #f0d98c" }}
          >
            <strong>AI-powered recommendations (ICP, strategy reasoning, roadmap) couldn&apos;t be generated for this report.</strong>
            <br />
            Reason: {report.aiError || "Unknown error"}
            <br />
            All the live-data scorecards below are unaffected — this only affects the AI-written sections. If this
            keeps happening, double check the <code>GROQ_API_KEY</code> in your deployment settings.
          </div>
        )}

        {report.icp && (
          <section
            className="rounded-lg p-6 mb-8"
            style={{ background: "var(--paper-raised)", border: "1px solid var(--line)" }}
          >
            <p className="font-data text-xs uppercase tracking-widest mb-2" style={{ color: "var(--good)" }}>
              Ideal customer profile
            </p>
            <p className="text-sm mb-3" style={{ color: "var(--ink)" }}>{report.icp.summary}</p>
            <div className="grid sm:grid-cols-3 gap-4 text-xs" style={{ color: "var(--ink-soft)" }}>
              <div><span className="font-medium" style={{ color: "var(--ink)" }}>Who they are: </span>{report.icp.demographics}</div>
              <div><span className="font-medium" style={{ color: "var(--ink)" }}>What drives them: </span>{report.icp.psychographics}</div>
              <div><span className="font-medium" style={{ color: "var(--ink)" }}>What triggers buying: </span>{report.icp.buyingTriggers}</div>
            </div>
          </section>
        )}

        {report.recommendedChannel.channel !== "N/A" && (
          <section
            className="rounded-lg p-6 mb-8"
            style={{ background: "var(--paper-raised)", border: "1px solid var(--line)" }}
          >
            <p className="font-data text-xs uppercase tracking-widest mb-2" style={{ color: "var(--good)" }}>
              Recommended primary channel
            </p>
            <h2 className="font-display text-2xl mb-2" style={{ color: "var(--ink)" }}>
              {report.recommendedChannel.channel}
            </h2>
            <p className="text-sm mb-1" style={{ color: "var(--ink)" }}>
              {report.recommendedChannel.reasoning}
            </p>
            <p className="text-sm italic" style={{ color: "var(--ink-soft)" }}>
              Budget fit: {report.recommendedChannel.budgetFit}
            </p>
          </section>
        )}

        <section
          className="rounded-lg p-6 mb-10"
          style={{ background: "var(--paper-raised)", border: "1px solid var(--line)" }}
        >
          <p className="font-data text-xs uppercase tracking-widest mb-2" style={{ color: "var(--good)" }}>
            Recommended marketing strategy
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>{report.marketingStrategy.headline}</p>
          <div className="space-y-3">
            {report.marketingStrategy.allocations.map((a, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="font-data text-lg w-14 text-right" style={{ color: "var(--good)" }}>
                  {a.allocationPct}%
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>{a.channel}</div>
                  <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{a.rationale}</div>
                </div>
                <div
                  className="h-2 rounded-full flex-shrink-0"
                  style={{ width: `${Math.max(a.allocationPct, 8)}px`, background: "var(--good)" }}
                />
              </div>
            ))}
          </div>
        </section>

        <div className="grid sm:grid-cols-2 gap-4 mb-10">
          {report.cards.map((card) => (
            <div
              key={card.id}
              className="rounded-lg p-5"
              style={{
                background: "var(--paper-raised)",
                border: "1px solid var(--line)",
                borderLeft: `4px solid ${statusColor[card.status]}`,
                boxShadow: "0 1px 2px rgba(22,36,31,0.04)",
              }}
            >
              <div className="flex items-center justify-between mb-2 gap-3">
                <h3 className="font-medium text-sm" style={{ color: "var(--ink)" }}>
                  {card.title}
                </h3>
                {card.score !== null ? (
                  <span className="font-data text-xl flex-shrink-0" style={{ color: statusColor[card.status] }}>
                    {card.score}
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>/100</span>
                  </span>
                ) : (
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: statusColor[card.status] }}
                    title={card.status}
                  />
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--ink-soft)" }}>
                {card.summary}
              </p>
              <ul className="text-xs space-y-1" style={{ color: "var(--ink-soft)" }}>
                {card.details.slice(0, 4).map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {report.roadmap.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-2xl mb-4" style={{ color: "var(--ink)" }}>
              Priority roadmap
            </h2>
            <ol className="space-y-3">
              {report.roadmap
                .sort((a, b) => a.priority - b.priority)
                .map((r) => (
                  <li
                    key={r.priority}
                    className="rounded-lg p-4 flex gap-4"
                    style={{ background: "var(--paper-raised)", border: "1px solid var(--line)" }}
                  >
                    <span className="font-data text-2xl" style={{ color: "var(--good)" }}>
                      {r.priority}
                    </span>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                        {r.action}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
                        {r.why}
                      </p>
                    </div>
                  </li>
                ))}
            </ol>
          </section>
        )}

        {report.avoidList.length > 0 && (
          <section>
            <h2 className="font-display text-2xl mb-4" style={{ color: "var(--ink)" }}>
              What to avoid right now
            </h2>
            <ul className="space-y-2">
              {report.avoidList.map((a, i) => (
                <li
                  key={i}
                  className="text-sm rounded-md px-4 py-3"
                  style={{ background: "#f6e4e0", color: "var(--critical)" }}
                >
                  {a}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const status = score >= 75 ? "good" : score >= 45 ? "warning" : "critical";
  const color = statusColor[status];
  // Semicircular gauge: 180° arc, radius 42, drawn as a stroke-dasharray fraction.
  const radius = 42;
  const circumference = Math.PI * radius; // half-circle length
  const filled = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width="104" height="62" viewBox="0 0 104 62">
        <path
          d="M 10 56 A 42 42 0 0 1 94 56"
          fill="none"
          stroke="var(--line)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M 10 56 A 42 42 0 0 1 94 56"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
        <text
          x="52"
          y="46"
          textAnchor="middle"
          className="font-data"
          style={{ fontSize: "22px", fill: "var(--ink)", fontWeight: 600 }}
        >
          {score}
        </text>
      </svg>
      <div className="text-xs -mt-1" style={{ color: "var(--ink-soft)" }}>
        overall score
      </div>
    </div>
  );
}
