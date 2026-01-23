import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BugAntIcon,
  DocumentTextIcon,
  EyeIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  consolidateIssues,
  categorizeIssue,
  consolidatedIssuesToHtmlDigest,
  formatSeverityLabel,
  parseStarkHtmlReport,
  type ConsolidatedIssue,
  type ParsedIssue,
  type ParseDebugInfo,
  type SeverityScheme,
} from "../lib/starkParser";

import {
  computeIssueKey,
  issuesToRemediationPlanHtml,
  type EstimateOverrides,
} from "../lib/remediationPlan";

type ParsedFileResult = {
  fileName: string;
  issuesFound: number;
  debug: ParseDebugInfo;
};

function downloadTextFile(
  filename: string,
  contents: string,
  mime = "text/plain;charset=utf-8",
) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatSeverityBadge(
  severity: ParsedIssue["severity"],
  scheme: SeverityScheme,
) {
  const label = formatSeverityLabel(severity, scheme);
  const color =
    severity === "Critical"
      ? "bg-red-700 dark:bg-red-600"
      : severity === "Serious"
        ? "bg-orange-700 dark:bg-orange-600"
        : severity === "Moderate"
          ? "bg-amber-700 dark:bg-amber-600"
          : severity === "Minor"
            ? "bg-emerald-700 dark:bg-emerald-600"
            : "bg-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white ${color}`}
    >
      {label}
    </span>
  );
}

export function StarkConsolidator() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedFiles, setParsedFiles] = useState<ParsedFileResult[]>([]);
  const [issues, setIssues] = useState<ConsolidatedIssue[]>([]);
  const [severityScheme, setSeverityScheme] =
    useState<SeverityScheme>("unknown");
  const [showDebug, setShowDebug] = useState(false);
  const [overrides, setOverrides] = useState<EstimateOverrides>(() => {
    try {
      const raw = localStorage.getItem("stark-remediation-overrides-v1");
      return raw ? (JSON.parse(raw) as EstimateOverrides) : {};
    } catch {
      return {};
    }
  });

  const totalIssues = useMemo(
    () => issues.reduce((acc, i) => acc + i.occurrences, 0),
    [issues],
  );

  const planHtml = useMemo(() => {
    if (issues.length === 0) return null;
    return issuesToRemediationPlanHtml(issues, {
      reportTitle: "Accessibility Remediation Recommendations",
      overrides,
      severityScheme,
    });
  }, [issues, overrides, severityScheme]);

  const digestHtml = useMemo(() => {
    if (issues.length === 0) return null;
    return consolidatedIssuesToHtmlDigest(issues, {
      reportTitle: "Accessibility Issues Digest",
      severityScheme,
    });
  }, [issues, severityScheme]);

  const reportedTotals = useMemo(() => {
    let violations = 0;
    let potentials = 0;
    let hasAny = false;
    for (const f of parsedFiles) {
      if (typeof f.debug.reportTotals?.violations === "number") {
        violations += f.debug.reportTotals.violations;
        hasAny = true;
      }
      if (typeof f.debug.reportTotals?.potentialViolations === "number") {
        potentials += f.debug.reportTotals.potentialViolations;
        hasAny = true;
      }
    }
    return { hasAny, violations, potentials, total: violations + potentials };
  }, [parsedFiles]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "stark-remediation-overrides-v1",
        JSON.stringify(overrides),
      );
    } catch {
      // ignore
    }
  }, [overrides]);

  async function onFilesSelected(fileList: FileList | null) {
    setError(null);
    setIssues([]);
    setParsedFiles([]);
    setOverrides({});
    setSeverityScheme("unknown");

    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    try {
      const files = Array.from(fileList);
      const rawIssues: ParsedIssue[] = [];
      const debugByFile: ParsedFileResult[] = [];

      for (const file of files) {
        const text = await file.text();
        const parsed = parseStarkHtmlReport(text, file.name);
        rawIssues.push(...parsed.issues);
        debugByFile.push({
          fileName: file.name,
          issuesFound: parsed.issues.length,
          debug: parsed.debug,
        });
      }

      // Prefer High/Medium/Low labeling if any file used it.
      const schemes = debugByFile
        .map((f) => f.debug.severityScheme)
        .filter((s): s is SeverityScheme => typeof s === "string");
      const scheme: SeverityScheme = schemes.includes("hml")
        ? "hml"
        : schemes.includes("axe")
          ? "axe"
          : "unknown";
      setSeverityScheme(scheme);

      const consolidated = consolidateIssues(rawIssues);
      setIssues(consolidated);
      setParsedFiles(debugByFile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse files");
    } finally {
      setBusy(false);
    }
  }

  function setEstimate(issue: ConsolidatedIssue, hours: number | undefined) {
    const key = `${categorizeIssue(issue)}|${computeIssueKey(issue)}`;
    setOverrides((prev) => {
      const next = { ...prev };
      if (hours === undefined) {
        if (!next[key]) return prev;
        next[key] = { ...next[key], hours: undefined };
        if (!next[key]?.notes && next[key]?.hours === undefined)
          delete next[key];
        return next;
      }
      next[key] = { ...(next[key] ?? {}), hours };
      return next;
    });
  }

  function setEstimateNotes(issue: ConsolidatedIssue, notes: string) {
    const key = `${categorizeIssue(issue)}|${computeIssueKey(issue)}`;
    setOverrides((prev) => {
      const next = { ...prev };
      const trimmed = notes.trim();
      if (!trimmed) {
        if (!next[key]) return prev;
        next[key] = { ...next[key], notes: undefined };
        if (!next[key]?.notes && next[key]?.hours === undefined)
          delete next[key];
        return next;
      }
      next[key] = { ...(next[key] ?? {}), notes: trimmed };
      return next;
    });
  }

  function clearEstimates() {
    setOverrides({});
  }

  function downloadPlan() {
    if (!planHtml) return;
    downloadTextFile(
      `accessibility-remediation-plan-${new Date().toISOString().slice(0, 10)}.html`,
      planHtml,
      "text/html;charset=utf-8",
    );
  }

  function downloadDigest() {
    if (!digestHtml) return;
    downloadTextFile(
      `accessibility-issues-digest-${new Date().toISOString().slice(0, 10)}.html`,
      digestHtml,
      "text/html;charset=utf-8",
    );
  }

  function openPlanPreview() {
    if (!planHtml) return;
    const blob = new Blob([planHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    // Leave the URL alive for the opened tab; it will be released on refresh.
  }

  function openDigestPreview() {
    if (!digestHtml) return;
    const blob = new Blob([digestHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    // Leave the URL alive for the opened tab; it will be released on refresh.
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/40">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              WCAG Audit Pipeline
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Upload Stark HTML report(s). The app extracts issues, builds a
              consolidated issue list with severity labels, and generates
              remediation recommendations.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="group inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 dark:border-white/20 dark:bg-slate-900/30 dark:text-slate-100 dark:hover:bg-slate-900/50">
            <ArrowUpTrayIcon className="h-5 w-5 text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200" />
            <span>Choose HTML report files…</span>
            <input
              type="file"
              accept="text/html,.html"
              multiple
              onChange={(e) => void onFilesSelected(e.currentTarget.files)}
              disabled={busy}
              className="sr-only"
            />
          </label>

          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            disabled={parsedFiles.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:hover:bg-slate-900/50"
          >
            <BugAntIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
            {showDebug ? "Hide debug" : "Show debug"}
          </button>

          <button
            type="button"
            onClick={clearEstimates}
            disabled={busy || Object.keys(overrides).length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:hover:bg-slate-900/50"
          >
            <TrashIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
            Clear estimates
          </button>

          <button
            type="button"
            onClick={openDigestPreview}
            disabled={!digestHtml || busy}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:hover:bg-slate-900/50"
          >
            <DocumentTextIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
            Preview issues digest
          </button>

          <button
            type="button"
            onClick={downloadDigest}
            disabled={!digestHtml || busy}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:hover:bg-slate-900/50"
          >
            <ArrowDownTrayIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
            Download issues digest (HTML)
          </button>

          <button
            type="button"
            onClick={openPlanPreview}
            disabled={!planHtml || busy}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:hover:bg-slate-900/50"
          >
            <EyeIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
            Preview remediation recommendations
          </button>

          <button
            type="button"
            onClick={downloadPlan}
            disabled={!planHtml || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <ArrowDownTrayIcon className="h-5 w-5" />
            Download remediation recommendations (HTML)
          </button>
        </div>

        {busy && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Parsing…
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        {issues.length > 0 && (
          <div className="mt-6">
            <h3 className="statsTitle">Totals</h3>
            <dl className="statsGrid">
              <div className="statsCard">
                <dt>
                  <div className="statsIconWrap">
                    <DocumentTextIcon className="statsIcon" />
                  </div>
                  <p className="statsLabel">Unique issues</p>
                </dt>
                <dd className="statsValueRow">
                  <p className="statsValue">{issues.length}</p>
                  <div className="statsFooter">
                    <div className="text-sm">
                      <span className="statsFooterText">Details below</span>
                    </div>
                  </div>
                </dd>
              </div>

              <div className="statsCard">
                <dt>
                  <div className="statsIconWrap">
                    <BugAntIcon className="statsIcon" />
                  </div>
                  <p className="statsLabel">Total occurrences</p>
                </dt>
                <dd className="statsValueRow">
                  <p className="statsValue">{totalIssues}</p>
                  <div className="statsFooter">
                    <div className="text-sm">
                      <span className="statsFooterText">
                        Consolidated totals
                      </span>
                    </div>
                  </div>
                </dd>
              </div>

              <div className="statsCard">
                <dt>
                  <div className="statsIconWrap">
                    <ArrowUpTrayIcon className="statsIcon" />
                  </div>
                  <p className="statsLabel">Files parsed</p>
                </dt>
                <dd className="statsValueRow">
                  <p className="statsValue">{parsedFiles.length}</p>
                  <div className="statsFooter">
                    <div className="text-sm">
                      <span className="statsFooterText">From your uploads</span>
                    </div>
                  </div>
                </dd>
              </div>

              <div className="statsCard">
                <dt>
                  <div className="statsIconWrap">
                    <DocumentTextIcon className="statsIcon" />
                  </div>
                  <p className="statsLabel">
                    Report total (violations + potential)
                  </p>
                </dt>
                <dd className="statsValueRow">
                  <p className="statsValue">
                    {reportedTotals.hasAny ? reportedTotals.total : "—"}
                  </p>
                  <div className="statsFooter">
                    <div className="text-sm">
                      <span className="statsFooterText">
                        From Stark breakdown
                      </span>
                    </div>
                  </div>
                </dd>
              </div>

              <div className="statsCard">
                <dt>
                  <div className="statsIconWrap">
                    <DocumentTextIcon className="statsIcon" />
                  </div>
                  <p className="statsLabel">Report violations</p>
                </dt>
                <dd className="statsValueRow">
                  <p className="statsValue">
                    {reportedTotals.hasAny ? reportedTotals.violations : "—"}
                  </p>
                  <div className="statsFooter">
                    <div className="text-sm">
                      <span className="statsFooterText">
                        From Stark breakdown
                      </span>
                    </div>
                  </div>
                </dd>
              </div>

              <div className="statsCard">
                <dt>
                  <div className="statsIconWrap">
                    <DocumentTextIcon className="statsIcon" />
                  </div>
                  <p className="statsLabel">Report potential violations</p>
                </dt>
                <dd className="statsValueRow">
                  <p className="statsValue">
                    {reportedTotals.hasAny ? reportedTotals.potentials : "—"}
                  </p>
                  <div className="statsFooter">
                    <div className="text-sm">
                      <span className="statsFooterText">
                        From Stark breakdown
                      </span>
                    </div>
                  </div>
                </dd>
              </div>
            </dl>
          </div>
        )}

        {issues.length > 0 && (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-white/10">
              <thead>
                <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  <th scope="col" className="px-3 py-3 text-left">
                    Severity
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Occurrences
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Title
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    WCAG
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Pages
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Your est (hrs)
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-white/10 dark:bg-transparent">
                {issues.slice(0, 50).map((i, idx) => {
                  const cat = categorizeIssue(i);
                  const key = `${cat}|${computeIssueKey(i)}`;
                  const your = overrides[key]?.hours;
                  const notes = overrides[key]?.notes ?? "";
                  return (
                    <tr key={`${key}-${idx}`} className="align-top">
                      <td className="px-3 py-3">
                        {formatSeverityBadge(i.severity, severityScheme)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {cat}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {i.occurrences}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-50">
                        {i.title}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {i.wcag ?? ""}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {i.pages.length}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          step={0.25}
                          min={0}
                          value={typeof your === "number" ? your : ""}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            if (!v) return setEstimate(i, undefined);
                            const n = Number.parseFloat(v);
                            setEstimate(i, Number.isFinite(n) ? n : undefined);
                          }}
                          placeholder="e.g. 4"
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm outline-none ring-0 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-50 dark:focus:ring-white/10"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) =>
                            setEstimateNotes(i, e.currentTarget.value)
                          }
                          placeholder="Optional"
                          className="w-56 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm outline-none ring-0 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-50 dark:focus:ring-white/10"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">
              Showing first 50 consolidated issues. Your estimates are saved
              locally and included in the remediation export.
            </p>
          </div>
        )}

        {showDebug && parsedFiles.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">
              Parse debug
            </h2>
            {parsedFiles.map((f) => (
              <details
                key={f.fileName}
                className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-white/10 dark:bg-white/5"
              >
                <summary>
                  <span className="cursor-pointer select-none text-sm font-medium text-slate-900 dark:text-slate-50">
                    {f.fileName}
                  </span>
                  <span className="ml-2 text-sm text-slate-600 dark:text-slate-300">
                    — {f.issuesFound} issues, {f.debug.matchedTables}/
                    {f.debug.tablesFound} tables matched
                  </span>
                </summary>
                <div className="mt-3">
                  {f.debug.reportTotals && (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Report totals — Violations:{" "}
                      {f.debug.reportTotals.violations ?? "—"}, Potential:{" "}
                      {f.debug.reportTotals.potentialViolations ?? "—"}
                    </p>
                  )}
                  {f.debug.wcagBreakdownTotals && (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      WCAG breakdown — Criteria:{" "}
                      {f.debug.wcagBreakdownTotals.criteriaWithCounts},
                      Failures: {f.debug.wcagBreakdownTotals.failures},
                      Potentials: {f.debug.wcagBreakdownTotals.potentials}
                    </p>
                  )}
                  {f.debug.warnings.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
                      {f.debug.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-transparent">
                    <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-white/10">
                      <thead>
                        <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-white/5 dark:text-slate-300">
                          <th scope="col" className="px-3 py-2 text-left">
                            #
                          </th>
                          <th scope="col" className="px-3 py-2 text-left">
                            Rows
                          </th>
                          <th scope="col" className="px-3 py-2 text-left">
                            First-row headers
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white dark:divide-white/10 dark:bg-transparent">
                        {f.debug.tableHeaders.slice(0, 10).map((t) => (
                          <tr key={t.index}>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                              {t.index}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                              {t.rows}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                              {t.headers
                                .filter(Boolean)
                                .slice(0, 12)
                                .join(" | ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
