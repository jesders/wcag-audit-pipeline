import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const [exportActionsOpen, setExportActionsOpen] = useState<
    "digest" | "plan" | null
  >(null);
  const digestActionsRef = useRef<HTMLDivElement | null>(null);
  const planActionsRef = useRef<HTMLDivElement | null>(null);
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
      reportTitle: "Remediation Recommendations",
      overrides,
      severityScheme,
    });
  }, [issues, overrides, severityScheme]);

  const digestHtml = useMemo(() => {
    if (issues.length === 0) return null;
    return consolidatedIssuesToHtmlDigest(issues, {
      reportTitle: "Issues Digest",
      severityScheme,
    });
  }, [issues, severityScheme]);

  const canOpenDigest = Boolean(digestHtml) && !busy;
  const canOpenPlan = Boolean(planHtml) && !busy;

  useEffect(() => {
    if (!exportActionsOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (digestActionsRef.current?.contains(target)) return;
      if (planActionsRef.current?.contains(target)) return;
      setExportActionsOpen(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [exportActionsOpen]);

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
      `wcag-audit-remediation-recommendations-${new Date().toISOString().slice(0, 10)}.html`,
      planHtml,
      "text/html;charset=utf-8",
    );
  }

  function downloadDigest() {
    if (!digestHtml) return;
    downloadTextFile(
      `wcag-audit-issues-digest-${new Date().toISOString().slice(0, 10)}.html`,
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
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/40">
        <h2 id="pipeline-overview-title" className="sr-only">
          WCAG Audit Pipeline Overview
        </h2>

        <div className="p-6">
          <div className="sm:flex sm:items-center sm:justify-between sm:gap-8">
            <div className="sm:flex sm:items-start sm:gap-5">
              <div className="shrink-0">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-900/5 text-slate-700 dark:bg-white/10 dark:text-slate-200 dark:outline dark:-outline-offset-1 dark:outline-white/10 sm:size-14">
                  <DocumentTextIcon className="h-6 w-6" />
                </div>
              </div>

              <div className="mt-4 text-center sm:mt-0 sm:max-w-xl sm:text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  Upload Stark HTML report(s)
                </p>
                <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-slate-900 dark:text-slate-50">
                  WCAG Audit Pipeline
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Extract issues, build a consolidated issue list with severity
                  labels, and generate remediation recommendations.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center gap-2 sm:mt-0 sm:items-end">
              <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
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
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-3 sm:gap-4 dark:border-white/10 dark:bg-white/5">
          <label className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-slate-900/30 dark:text-slate-50 dark:hover:bg-slate-900/50">
            <ArrowUpTrayIcon className="h-5 w-5 text-slate-500 group-hover:text-slate-700 dark:text-slate-300 dark:group-hover:text-slate-100" />
            <span>Choose report files</span>
            <input
              type="file"
              accept="text/html,.html"
              multiple
              onChange={(e) => void onFilesSelected(e.currentTarget.files)}
              disabled={busy}
              className="sr-only"
            />
          </label>

          <div ref={digestActionsRef} className="relative">
            <button
              type="button"
              disabled={!canOpenDigest}
              aria-expanded={exportActionsOpen === "digest"}
              onClick={() =>
                setExportActionsOpen((v) => (v === "digest" ? null : "digest"))
              }
              className="inline-flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-50 dark:hover:bg-slate-900/50"
            >
              <span>Issues digest</span>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-300">
                Preview or download
              </span>
            </button>

            {exportActionsOpen === "digest" && canOpenDigest && (
              <div className="absolute inset-0 overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-950/80">
                <div className="grid h-full grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      openDigestPreview();
                      setExportActionsOpen(null);
                    }}
                    className="inline-flex h-full w-full items-center justify-center gap-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:text-slate-50 dark:hover:bg-white/10"
                    aria-label="Preview issues digest"
                    title="Preview"
                  >
                    <EyeIcon className="h-5 w-5" />
                    <span className="sr-only">Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadDigest();
                      setExportActionsOpen(null);
                    }}
                    className="inline-flex h-full w-full items-center justify-center gap-2 border-l border-slate-200 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:border-white/10 dark:text-slate-50 dark:hover:bg-white/10"
                    aria-label="Download issues digest (HTML)"
                    title="Download (HTML)"
                  >
                    <ArrowDownTrayIcon className="h-5 w-5" />
                    <span className="sr-only">Download</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div ref={planActionsRef} className="relative">
            <button
              type="button"
              disabled={!canOpenPlan}
              aria-expanded={exportActionsOpen === "plan"}
              onClick={() =>
                setExportActionsOpen((v) => (v === "plan" ? null : "plan"))
              }
              className="inline-flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-50 dark:hover:bg-slate-900/50"
            >
              <span>Remediation recommendations</span>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-300">
                Preview or download
              </span>
            </button>

            {exportActionsOpen === "plan" && canOpenPlan && (
              <div className="absolute inset-0 overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-950/80">
                <div className="grid h-full grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      openPlanPreview();
                      setExportActionsOpen(null);
                    }}
                    className="inline-flex h-full w-full items-center justify-center gap-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:text-slate-50 dark:hover:bg-white/10"
                    aria-label="Preview remediation recommendations"
                    title="Preview"
                  >
                    <EyeIcon className="h-5 w-5" />
                    <span className="sr-only">Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadPlan();
                      setExportActionsOpen(null);
                    }}
                    className="inline-flex h-full w-full items-center justify-center gap-2 border-l border-slate-200 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:border-white/10 dark:text-slate-50 dark:hover:bg-white/10"
                    aria-label="Download remediation recommendations (HTML)"
                    title="Download (HTML)"
                  >
                    <ArrowDownTrayIcon className="h-5 w-5" />
                    <span className="sr-only">Download</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
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
          <div className="mt-6">
            <div className="grid gap-3">
              {issues.slice(0, 50).map((i, idx) => {
                const cat = categorizeIssue(i);
                const key = `${cat}|${computeIssueKey(i)}`;
                const your = overrides[key]?.hours;
                const notes = overrides[key]?.notes ?? "";

                return (
                  <article
                    key={`${key}-${idx}`}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40"
                  >
                    <header className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {formatSeverityBadge(i.severity, severityScheme)}
                          <span className="inline-flex items-center rounded-full bg-slate-900/5 px-2 py-0.5 text-xs font-semibold text-slate-900 dark:bg-white/10 dark:text-slate-50">
                            {i.occurrences}×
                          </span>
                          {i.wcag ? (
                            <span className="inline-flex items-center rounded-full bg-slate-900/5 px-2 py-0.5 text-xs font-medium text-slate-900 dark:bg-white/10 dark:text-slate-50">
                              WCAG {i.wcag}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center rounded-full bg-slate-900/5 px-2 py-0.5 text-xs font-medium text-slate-900 dark:bg-white/10 dark:text-slate-50">
                            {cat}
                          </span>
                        </div>

                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {i.title}
                        </h4>

                        {i.description ? (
                          <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                            {i.description}
                          </p>
                        ) : null}

                        <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                          {i.pages.length} pages impacted
                        </div>
                      </div>
                    </header>

                    {i.pages.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer select-none text-sm text-slate-600 dark:text-slate-300">
                          View pages
                        </summary>
                        <div className="mt-2 grid gap-2">
                          {i.pages.slice(0, 12).map((p) => (
                            <div
                              key={p}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5"
                              style={{
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                              }}
                            >
                              {p}
                            </div>
                          ))}
                          {i.pages.length > 12 && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              +{i.pages.length - 12} more
                            </div>
                          )}
                        </div>
                      </details>
                    )}

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="grid gap-1">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          Your estimate (hrs)
                        </span>
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
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 shadow-sm outline-none ring-0 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-50 dark:focus:ring-white/10"
                        />
                      </label>

                      <label className="grid gap-1">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          Notes
                        </span>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setEstimateNotes(i, e.currentTarget.value)}
                          placeholder="Optional"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 shadow-sm outline-none ring-0 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-50 dark:focus:ring-white/10"
                        />
                      </label>
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
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
  );
}
