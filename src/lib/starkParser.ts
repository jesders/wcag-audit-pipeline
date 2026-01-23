import exportCss from "../styles/export.css?inline";

export type SeverityLabel =
  | "Critical"
  | "Serious"
  | "Moderate"
  | "Minor"
  | "Unknown";

/**
 * Different Stark exports can label severities either using axe-style names
 * (Critical/Serious/Moderate/Minor) or High/Medium/Low.
 * We keep an internal normalized SeverityLabel, but can format display labels
 * to match what the report used.
 */
export type SeverityScheme = "axe" | "hml" | "unknown";

export function formatSeverityLabel(
  severity: SeverityLabel,
  scheme: SeverityScheme | undefined,
): string {
  if (scheme === "hml") {
    if (severity === "Critical") return "Critical";
    if (severity === "Serious") return "High";
    if (severity === "Moderate") return "Medium";
    if (severity === "Minor") return "Low";
    return "Unknown";
  }
  // Default to axe-style labels.
  return severity;
}

function inferSeveritySchemeFromRawLabels(labels: string[]): SeverityScheme {
  const norm = labels
    .map((l) => normalizeText(l).toLowerCase())
    .filter(Boolean);
  const hasHml = norm.some((l) => /\b(high|medium|low)\b/.test(l));
  const hasAxe = norm.some((l) => /\b(serious|moderate|minor)\b/.test(l));

  if (hasHml && !hasAxe) return "hml";
  if (hasAxe) return "axe";
  if (norm.some((l) => /\bcritical\b/.test(l))) return "axe";
  return "unknown";
}

export type IssueCategory =
  | "Alt text"
  | "Color contrast"
  | "Form labels"
  | "Link text"
  | "Button text"
  | "Headings"
  | "ARIA / landmarks"
  | "Keyboard / focus"
  | "Language"
  | "Tables"
  | "Other";

export type ConsolidatedIssue = {
  title: string;
  description: string;
  severity: SeverityLabel;
  wcag?: string;
  ruleId?: string;
  occurrences: number;
  pages: string[];
  sourceFiles: string[];
  exampleSnippets?: string[];
};

export type ParseDebugInfo = {
  tablesFound: number;
  tableHeaders: Array<{ index: number; headers: string[]; rows: number }>;
  matchedTables: number;
  issuesExtracted: number;
  reportTotals?: {
    violations?: number;
    potentialViolations?: number;
  };
  wcagBreakdownTotals?: {
    criteriaWithCounts: number;
    failures: number;
    potentials: number;
  };
  severityScheme?: SeverityScheme;
  severityLabelsFound?: string[];
  warnings: string[];
};

export type ParsedIssue = {
  title: string;
  description: string;
  severity: SeverityLabel;
  /** Raw severity label found in the Stark export (if available). */
  severityOriginal?: string;
  occurrences: number;
  wcag?: string;
  ruleId?: string;
  page?: string;
  exampleSnippet?: string;
  sourceFile: string;
};

const SEVERITY_ORDER: Record<SeverityLabel, number> = {
  Critical: 4,
  Serious: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

export function categorizeIssue(
  input: Pick<ConsolidatedIssue, "title" | "description" | "ruleId" | "wcag">,
): IssueCategory {
  const hay = normalizeText(
    `${input.ruleId ?? ""} ${input.wcag ?? ""} ${input.title} ${input.description}`,
  ).toLowerCase();

  // Order matters: first match wins.
  if (
    /(^|\b)(alt|alt text|alternate text)\b|missing\s+alt|image\s+.*\balt\b|non-text\s+content/.test(
      hay,
    )
  )
    return "Alt text";
  if (
    /contrast|4\.5|3:1|color\s+contrast|background\s+is\s+an\s+image/.test(hay)
  )
    return "Color contrast";
  if (
    /label\b|labels\b|form\s+field|input\b|textarea\b|select\b|aria-label\b.*(input|textbox)|missing\s+label/.test(
      hay,
    )
  )
    return "Form labels";
  if (
    /link\b|links?\s+must\s+have\s+discernible\s+text|empty\s+link|link\s+name|anchor\b/.test(
      hay,
    )
  )
    return "Link text";
  if (
    /button\b|buttons?\s+must\s+have\s+discernible\s+text|button\s+name/.test(
      hay,
    )
  )
    return "Button text";
  if (/heading\b|headings\b|h1\b|h2\b|h3\b|heading\s+level|outline/.test(hay))
    return "Headings";
  if (
    /aria-(label|labelledby|describedby|hidden)\b|role\b|landmark\b|region\b|navigation\b.*aria/.test(
      hay,
    )
  )
    return "ARIA / landmarks";
  if (/keyboard\b|focus\b|tab\s+order|visible\s+focus|operable/.test(hay))
    return "Keyboard / focus";
  if (/(\blang\b|language\s+of\s+page|language\s+of\s+parts)/.test(hay))
    return "Language";
  if (/table\b|th\b|scope\b|header\s+cell|data\s+table/.test(hay))
    return "Tables";
  return "Other";
}

function isAltTextRelated(description: string): boolean {
  const hay = normalizeText(description).toLowerCase();
  return /(^|\b)(alt|alt text|alternate text)\b|missing\s+alt|image\s+.*\balt\b|non-text\s+content/.test(
    hay,
  );
}

function isUsefulAltExampleSnippet(snippet: string): boolean {
  const s = normalizeText(snippet).toLowerCase();
  // Only keep snippets that actually look like image markup.
  return (
    /<\s*img\b/.test(s) ||
    /\balt\s*=/.test(s) ||
    /<\s*picture\b/.test(s) ||
    /<\s*source\b/.test(s)
  );
}

function clampSnippet(value: string, max = 420): string {
  const v = normalizeText(value);
  if (v.length <= max) return v;
  return `${v.slice(0, max - 1)}…`;
}

function normalizeText(value: string | null | undefined): string {
  let t = (value ?? "").replace(/\s+/g, " ").trim();
  // Stark exports sometimes concatenate counters into labels; strip those artifacts
  // so they don't leak into WCAG/title/description fields.
  t = t.replace(/\b\d+passed\d+\b/gi, "");
  t = t.replace(/\b\d+\s*passed\s*\d+\b/gi, "");
  t = t.replace(/\bpassed\s*\d+\b/gi, "");
  t = t.replace(/\b\d+\s*passed\b/gi, "");
  return t.replace(/\s+/g, " ").trim();
}

function normalizeSeverity(value: string): SeverityLabel {
  const v = value.toLowerCase();
  if (/(critical|blocker|severe)/.test(v)) return "Critical";
  if (/(serious|high)/.test(v)) return "Serious";
  if (/(moderate|medium)/.test(v)) return "Moderate";
  if (/(minor|low)/.test(v)) return "Minor";
  return "Unknown";
}

function pickHighestSeverity(values: SeverityLabel[]): SeverityLabel {
  let best: SeverityLabel = "Unknown";
  for (const v of values) {
    if (SEVERITY_ORDER[v] > SEVERITY_ORDER[best]) best = v;
  }
  return best;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function headerLooksLikeIssuesTable(headerKeys: string[]): boolean {
  const set = new Set(headerKeys);
  const hasSeverity = [...set].some((h) => /(severity|impact|level)/.test(h));
  const hasDescriptionLike = [...set].some((h) =>
    /(description|details|why it matters|explanation)/.test(h),
  );
  const hasTitleLike = [...set].some((h) =>
    /(title|issue|problem|summary|rule|check)/.test(h),
  );
  // Stark exports vary; accept a broader set of "issue table" shapes.
  return hasSeverity && (hasDescriptionLike || hasTitleLike);
}

function getCellText(cell: Element): string {
  return normalizeText(cell.textContent);
}

function parseOccurrences(value: string): number {
  const v = normalizeText(value);
  if (!v) return 1;
  const match = v.match(/\d+/);
  if (!match) return 1;
  const n = Number.parseInt(match[0]!, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseFirstPositiveInt(value: string): number | undefined {
  const match = normalizeText(value).match(/\d+/);
  if (!match) return undefined;
  const n = Number.parseInt(match[0]!, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function extractBreakdownTotals(doc: Document): {
  violations?: number;
  potentialViolations?: number;
} {
  const nodes = Array.from(doc.querySelectorAll("p,span,div")) as Element[];

  const findMetric = (label: RegExp): number | undefined => {
    const labelEl = nodes.find((n) => label.test(normalizeText(n.textContent)));
    if (!labelEl) return undefined;

    // Walk up a few ancestors and pick the most plausible numeric value inside.
    let cur: Element | null = labelEl;
    for (let i = 0; i < 6 && cur; i += 1) {
      const container: Element = (cur.closest("div") as Element | null) ?? cur;
      const inner = Array.from(
        container.querySelectorAll("div,span"),
      ) as Element[];
      const candidates = inner
        .map((c) => normalizeText(c.textContent))
        .map(parseFirstPositiveInt)
        .filter((n): n is number => typeof n === "number");
      if (candidates.length > 0) {
        // Prefer smaller numbers when there are multiple (avoid pulling a huge count when looking for violations)
        candidates.sort((a, b) => a - b);
        return candidates[0];
      }
      cur = container.parentElement;
    }

    return undefined;
  };

  return {
    violations: findMetric(/^violations$/i),
    potentialViolations: findMetric(/^potential\s+violations?$/i),
  };
}

type WcagCriterionTotals = {
  wcag: string;
  failures: number;
  potentials: number;
};

function extractWcagBreakdownTotals(doc: Document): WcagCriterionTotals[] {
  // Stark exports often show per-criterion counts even when details (cards) are collapsed.
  // Those counts are encoded as: svg[aria-label="Failures|Potentials"] + a numeric sibling.
  const svgs = Array.from(
    doc.querySelectorAll(
      'svg[aria-label="Failures"], svg[aria-label="Potentials"]',
    ),
  );
  const byWcag = new Map<string, WcagCriterionTotals>();

  for (const svg of svgs) {
    const label = normalizeText(svg.getAttribute("aria-label"));
    if (!label) continue;
    const wcag = extractBestWcagLabelFromAncestors(svg);
    if (!wcag || !/^\d+(?:\.\d+)+\s+/.test(wcag)) continue;

    const wrapper = svg.closest("div");
    const numberText =
      normalizeText(wrapper?.querySelector("div")?.textContent) ||
      normalizeText(wrapper?.textContent);
    const n = parseFirstPositiveInt(numberText);
    if (typeof n !== "number") continue;

    const existing = byWcag.get(wcag) ?? { wcag, failures: 0, potentials: 0 };
    if (/^failures$/i.test(label)) existing.failures = n;
    else if (/^potentials$/i.test(label)) existing.potentials = n;
    byWcag.set(wcag, existing);
  }

  return Array.from(byWcag.values());
}

function extractPrimaryPageUrl(doc: Document): string | undefined {
  // In many Stark exports, the scanned page URL appears as a standalone <p> with just the URL.
  const pTags = Array.from(doc.querySelectorAll("p"));
  for (const p of pTags) {
    const t = normalizeText(p.textContent);
    if (/^https?:\/\//i.test(t) && t.length < 300) return t;
  }

  // Fallback: grab the first visible-looking URL from text content.
  const bodyText = normalizeText(doc.body?.textContent);
  const match = bodyText.match(/https?:\/\/[^\s)\]"']+/i);
  return match?.[0];
}

function parseTableIssues(
  table: HTMLTableElement,
  sourceFile: string,
): ParsedIssue[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return [];

  const headerRow =
    table.tHead?.rows?.[0] ??
    rows.find((r) => r.querySelectorAll("th").length > 0) ??
    rows[0];
  const headerCells = Array.from(headerRow.querySelectorAll("th,td")).map((c) =>
    getCellText(c),
  );
  const headerKeys = headerCells.map(toHeaderKey);
  if (!headerLooksLikeIssuesTable(headerKeys)) return [];

  const colIndex = (regex: RegExp): number | undefined => {
    const idx = headerKeys.findIndex((h) => regex.test(h));
    return idx >= 0 ? idx : undefined;
  };

  const severityIdx = colIndex(/(severity|impact|level)/);
  const occurrencesIdx = colIndex(
    /(occurrences|occurrence|instances|instance|count|violations|items)/,
  );
  const titleIdx = colIndex(/(title|issue|problem|summary|rule)/);
  const descriptionIdx = colIndex(
    /(description|details|why it matters|explanation)/,
  );
  const wcagIdx = colIndex(/(wcag|success criterion|sc)/);
  const ruleIdx = colIndex(/(rule id|ruleid|rule|check|code)/);
  const pageIdx = colIndex(/(page|url|screen|route)/);

  const bodyRows =
    table.tBodies && table.tBodies.length > 0
      ? Array.from(table.tBodies).flatMap((b) => Array.from(b.rows))
      : rows;

  const dataRows = bodyRows.filter(
    (r) => r !== headerRow && r.querySelectorAll("td,th").length > 0,
  );
  const issues: ParsedIssue[] = [];

  for (const r of dataRows) {
    const cells = Array.from(r.querySelectorAll("td,th")).map((c) =>
      getCellText(c),
    );
    const get = (idx: number | undefined): string =>
      idx === undefined ? "" : normalizeText(cells[idx] ?? "");

    const severityRaw = get(severityIdx);
    const occurrences = parseOccurrences(get(occurrencesIdx));
    const title = get(titleIdx) || get(descriptionIdx) || "Issue";
    const description = get(descriptionIdx) || get(titleIdx) || "";
    if (!severityRaw && !description) continue;

    issues.push({
      title,
      description,
      severity: normalizeSeverity(severityRaw),
      severityOriginal: severityRaw || undefined,
      occurrences,
      wcag: get(wcagIdx) || undefined,
      ruleId: get(ruleIdx) || undefined,
      page: get(pageIdx) || undefined,
      sourceFile,
    });
  }

  return issues;
}

function parseHeuristicIssues(
  doc: Document,
  sourceFile: string,
): ParsedIssue[] {
  // Fallback heuristic: look for repeated "Severity" labels near issue blocks.
  const issues: ParsedIssue[] = [];
  const candidates = Array.from(
    doc.querySelectorAll("section, article, li, div"),
  );

  for (const el of candidates) {
    const text = normalizeText(el.textContent);
    if (!text) continue;
    if (!/(severity|impact)/i.test(text)) continue;

    const sevMatch = text.match(
      /(?:severity|impact)\s*[:\-]?\s*(critical|serious|high|moderate|medium|minor|low)/i,
    );
    if (!sevMatch) continue;

    // Try to find a nearby heading/title
    const heading = el.querySelector("h1,h2,h3,h4,h5")?.textContent;
    const title = normalizeText(heading) || "Issue";
    const description = text.slice(0, 400);

    issues.push({
      title,
      description,
      severity: normalizeSeverity(sevMatch[1] ?? ""),
      severityOriginal: sevMatch[1] ?? undefined,
      occurrences: 1,
      sourceFile,
    });
  }

  // De-dupe noisy heuristic results
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.severity}|${i.title}|${i.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractBestWcagLabelFromAncestors(el: Element): string | undefined {
  const sanitizeWcagLabel = (raw: string): string | undefined => {
    let t = normalizeText(raw);
    if (!t) return undefined;

    // Some Stark exports concatenate the criterion title with counters. Strip any trailing counters.
    t = t.replace(/\s*\d*\s*(failures|potentials)\b.*$/i, "");
    t = t.replace(/\s*\d+\s*$/g, "");
    t = normalizeText(t);

    return /^\d+(?:\.\d+)+\s+/.test(t) ? t : undefined;
  };

  const candidates: string[] = [];

  let cur: Element | null = el;
  for (let depth = 0; depth < 15 && cur; depth += 1) {
    if (cur.tagName === "LI") {
      const button = cur.querySelector("button");
      if (button) {
        const texts = Array.from(button.querySelectorAll("div"))
          .map((d) => normalizeText(d.textContent))
          .filter(Boolean);
        for (const t of texts) {
          const cleaned = sanitizeWcagLabel(t);
          if (cleaned) candidates.push(cleaned);
        }
      }
    }
    cur = cur.parentElement;
  }

  if (candidates.length === 0) return undefined;

  // Prefer the most specific WCAG-like label (more dot segments)
  candidates.sort((a, b) => {
    const segA = (a.match(/\./g) ?? []).length;
    const segB = (b.match(/\./g) ?? []).length;
    return segB - segA;
  });

  return candidates[0];
}

function parseCategoriesCardIssues(
  doc: Document,
  sourceFile: string,
  pageUrl?: string,
): ParsedIssue[] {
  // Stark "Categories" exports often encode issues as cards with aria-labels like:
  // "Violation. <message>. (2 instances)" or "Potential Violation. <message>. (3 instances)"
  const elements = Array.from(doc.querySelectorAll("[aria-label]"));
  const issues: ParsedIssue[] = [];

  for (const el of elements) {
    const aria = normalizeText(el.getAttribute("aria-label"));
    if (!aria) continue;
    if (!/^(potential\s+)?violation\b/i.test(aria)) continue;

    const isPotential = /^potential\s+violation\b/i.test(aria);

    // Try to extract message + instances from aria-label
    const match = aria.match(
      /^(Potential\s+)?Violation\.?\s*(.*?)(?:\s*\((\d+)\s+instances?\))?\s*$/i,
    );
    const fromAriaMessage = normalizeText(match?.[2] ?? "");
    const fromAriaOccurrences = match?.[3]
      ? Number.parseInt(match[3], 10)
      : undefined;

    // Prefer visible card title text if present
    let description = normalizeText(
      (el as Element).querySelector(".col-[title]")?.textContent,
    );
    if (!description) description = fromAriaMessage;
    description = description.replace(
      /\s*[–-]\s*\(\d+\s+instances?\)\s*$/i,
      "",
    );

    const occurrences =
      (fromAriaOccurrences &&
      Number.isFinite(fromAriaOccurrences) &&
      fromAriaOccurrences > 0
        ? fromAriaOccurrences
        : undefined) ?? parseOccurrences(description);

    if (!description) continue;
    const title =
      description.length > 90 ? `${description.slice(0, 87)}…` : description;
    const wcag = extractBestWcagLabelFromAncestors(el);
    const wantsInstances = isAltTextRelated(description);

    if (wantsInstances) {
      const instanceSnippets = Array.from(
        el.querySelectorAll('ul[aria-label="Instances"] li code'),
      )
        .map((c) => clampSnippet((c as Element).textContent ?? ""))
        .filter((s) => Boolean(s) && isUsefulAltExampleSnippet(s));

      // Emit one ParsedIssue per extracted instance so consolidation can group across pages
      for (const snip of instanceSnippets) {
        issues.push({
          title,
          description,
          severity: isPotential ? "Moderate" : "Critical",
          occurrences: 1,
          wcag,
          page: pageUrl,
          exampleSnippet: snip,
          sourceFile,
        });
      }

      // If the card claims more instances than present in the DOM, preserve the remainder as a synthetic count
      const known = instanceSnippets.length;
      const remainder = Math.max(0, occurrences - known);
      if (remainder > 0) {
        issues.push({
          title,
          description: `${description} (Additional ${remainder} instance(s) not included in the HTML export)`,
          severity: isPotential ? "Moderate" : "Critical",
          occurrences: remainder,
          wcag,
          page: pageUrl,
          sourceFile,
        });
      }
      continue;
    }

    issues.push({
      title,
      description,
      // Categories reports don't include Critical/Serious explicitly; map to usable buckets.
      severity: isPotential ? "Moderate" : "Critical",
      occurrences,
      wcag,
      page: pageUrl,
      sourceFile,
    });
  }

  // Do not de-dupe here; consolidation happens later and premature de-duping can drop counts.
  return issues;
}

export function parseStarkHtmlReport(
  html: string,
  sourceFile: string,
): { issues: ParsedIssue[]; debug: ParseDebugInfo } {
  const debug: ParseDebugInfo = {
    tablesFound: 0,
    tableHeaders: [],
    matchedTables: 0,
    issuesExtracted: 0,
    warnings: [],
  };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    debug.warnings.push("DOMParser failed to parse HTML.");
    return { issues: [], debug };
  }

  // Extract report-level totals (when present)
  const reportTotals = extractBreakdownTotals(doc);
  if (
    reportTotals.violations !== undefined ||
    reportTotals.potentialViolations !== undefined
  ) {
    debug.reportTotals = reportTotals;
  }

  // Extract WCAG breakdown totals for coverage and gap-filling.
  const wcagBreakdown = extractWcagBreakdownTotals(doc);
  if (wcagBreakdown.length > 0) {
    debug.wcagBreakdownTotals = {
      criteriaWithCounts: wcagBreakdown.length,
      failures: wcagBreakdown.reduce((acc, c) => acc + c.failures, 0),
      potentials: wcagBreakdown.reduce((acc, c) => acc + c.potentials, 0),
    };
  }

  const pageUrl = extractPrimaryPageUrl(doc);
  if (pageUrl) debug.warnings.push(`Detected page URL: ${pageUrl}`);

  const tables = Array.from(
    doc.querySelectorAll("table"),
  ) as HTMLTableElement[];
  debug.tablesFound = tables.length;

  let issues: ParsedIssue[] = [];
  tables.forEach((t, index) => {
    const headerRow =
      t.tHead?.rows?.[0] ??
      t.querySelector("tr:has(th)") ??
      t.querySelector("tr");
    const headers = headerRow
      ? Array.from(headerRow.querySelectorAll("th,td")).map((c) =>
          normalizeText(c.textContent),
        )
      : [];
    debug.tableHeaders.push({
      index,
      headers,
      rows: t.querySelectorAll("tr").length,
    });

    const tableIssues = parseTableIssues(t, sourceFile);
    if (tableIssues.length > 0) debug.matchedTables += 1;
    issues = issues.concat(tableIssues);
  });

  if (issues.length === 0) {
    const categoryIssues = parseCategoriesCardIssues(doc, sourceFile, pageUrl);

    if (categoryIssues.length > 0 || wcagBreakdown.length > 0) {
      if (categoryIssues.length > 0) {
        debug.warnings.push(
          "No issue tables matched; parsed Categories-style issue cards.",
        );
      }
      if (wcagBreakdown.length > 0) {
        debug.warnings.push(
          "WCAG breakdown counts detected; using them to ensure totals align even if sections are collapsed.",
        );
      }

      issues = categoryIssues;

      // Fill gaps: some exports only include detailed cards for expanded criteria.
      if (wcagBreakdown.length > 0) {
        const covered = new Map<
          string,
          { failures: number; potentials: number }
        >();
        for (const i of categoryIssues) {
          const wcag = normalizeText(i.wcag);
          if (!wcag) continue;
          const key = wcag;
          const existing = covered.get(key) ?? { failures: 0, potentials: 0 };
          if (i.severity === "Critical") existing.failures += i.occurrences;
          else if (i.severity === "Moderate")
            existing.potentials += i.occurrences;
          covered.set(key, existing);
        }

        const synth: ParsedIssue[] = [];
        for (const c of wcagBreakdown) {
          const existing = covered.get(c.wcag) ?? {
            failures: 0,
            potentials: 0,
          };
          const missingFailures = Math.max(0, c.failures - existing.failures);
          const missingPotentials = Math.max(
            0,
            c.potentials - existing.potentials,
          );

          if (missingFailures > 0) {
            synth.push({
              title: `WCAG ${c.wcag} — Violations (details not in export)`,
              description:
                "Count taken from the WCAG breakdown in the Stark report. Detailed issue cards were not present in the HTML export (often because the section was collapsed).",
              severity: "Critical",
              occurrences: missingFailures,
              wcag: c.wcag,
              page: pageUrl,
              sourceFile,
            });
          }
          if (missingPotentials > 0) {
            synth.push({
              title: `WCAG ${c.wcag} — Potential violations (details not in export)`,
              description:
                "Count taken from the WCAG breakdown in the Stark report. Detailed issue cards were not present in the HTML export (often because the section was collapsed).",
              severity: "Moderate",
              occurrences: missingPotentials,
              wcag: c.wcag,
              page: pageUrl,
              sourceFile,
            });
          }
        }

        if (synth.length > 0) {
          debug.warnings.push(
            `Added ${synth.length} synthetic issue(s) to account for collapsed sections so totals match the report.`,
          );
          issues = issues.concat(synth);
        }
      }
    } else {
      debug.warnings.push("No issue tables matched; using fallback heuristic.");
      issues = parseHeuristicIssues(doc, sourceFile);
    }
  }

  debug.issuesExtracted = issues.length;

  // Try to infer what label scheme the report used (High/Medium/Low vs Serious/Moderate/Minor)
  // so UI and exports can match it.
  const severityLabels = Array.from(
    new Set(
      issues
        .map((i) => normalizeText(i.severityOriginal ?? ""))
        .filter(Boolean),
    ),
  );
  if (severityLabels.length > 0) {
    debug.severityLabelsFound = severityLabels;
    debug.severityScheme = inferSeveritySchemeFromRawLabels(severityLabels);
  }

  return { issues, debug };
}

export function consolidateIssues(
  rawIssues: ParsedIssue[],
): ConsolidatedIssue[] {
  const map = new Map<string, { issues: ParsedIssue[] }>();

  for (const issue of rawIssues) {
    const title = normalizeText(issue.title) || "Issue";
    const description = normalizeText(issue.description);
    const ruleId = normalizeText(issue.ruleId);
    const wcag = normalizeText(issue.wcag);
    const key =
      `${ruleId || ""}|${wcag || ""}|${title}|${description}`.toLowerCase();

    const existing = map.get(key);
    if (existing)
      existing.issues.push({
        ...issue,
        title,
        description,
        ruleId: ruleId || undefined,
        wcag: wcag || undefined,
      });
    else
      map.set(key, {
        issues: [
          {
            ...issue,
            title,
            description,
            ruleId: ruleId || undefined,
            wcag: wcag || undefined,
          },
        ],
      });
  }

  const consolidated: ConsolidatedIssue[] = [];
  for (const { issues } of map.values()) {
    const pages = Array.from(
      new Set(issues.map((i) => normalizeText(i.page)).filter(Boolean)),
    );
    const sourceFiles = Array.from(new Set(issues.map((i) => i.sourceFile)));
    const occurrences = issues.reduce(
      (acc, i) => acc + (Number.isFinite(i.occurrences) ? i.occurrences : 1),
      0,
    );
    const exampleSnippets = Array.from(
      new Set(
        issues.map((i) => clampSnippet(i.exampleSnippet ?? "")).filter(Boolean),
      ),
    ).slice(0, 8);
    consolidated.push({
      title: issues[0]?.title ?? "Issue",
      description: issues[0]?.description ?? "",
      severity: pickHighestSeverity(issues.map((i) => i.severity)),
      wcag: issues[0]?.wcag,
      ruleId: issues[0]?.ruleId,
      occurrences,
      pages,
      sourceFiles,
      exampleSnippets: exampleSnippets.length > 0 ? exampleSnippets : undefined,
    });
  }

  consolidated.sort((a, b) => {
    const sev = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sev !== 0) return sev;
    return b.occurrences - a.occurrences;
  });

  return consolidated;
}

export type HtmlDigestOptions = {
  reportTitle?: string;
  generatedAt?: Date;
  filterCategory?: IssueCategory;
  severityScheme?: SeverityScheme;
};

export function consolidatedIssuesToHtmlDigest(
  issues: ConsolidatedIssue[],
  options: HtmlDigestOptions = {},
): string {
  const appName = "WCAG Audit Pipeline";
  const docTitle = options.reportTitle ?? "Issues Digest";
  const pageTitle = `${appName} — ${docTitle}`;
  const generatedAt = options.generatedAt ?? new Date();
  const filteredIssues = options.filterCategory
    ? issues.filter((i) => categorizeIssue(i) === options.filterCategory)
    : issues;

  const totalsBySeverity: Record<SeverityLabel, number> = {
    Critical: 0,
    Serious: 0,
    Moderate: 0,
    Minor: 0,
    Unknown: 0,
  };
  for (const issue of filteredIssues)
    totalsBySeverity[issue.severity] += issue.occurrences;

  const groups: Array<{
    severity: SeverityLabel;
    issues: ConsolidatedIssue[];
  }> = [
    { severity: "Critical", issues: [] },
    { severity: "Serious", issues: [] },
    { severity: "Moderate", issues: [] },
    { severity: "Minor", issues: [] },
    { severity: "Unknown", issues: [] },
  ];
  for (const issue of filteredIssues) {
    groups.find((g) => g.severity === issue.severity)?.issues.push(issue);
  }

  const severityClass: Record<SeverityLabel, string> = {
    Critical: "sev sev-critical",
    Serious: "sev sev-serious",
    Moderate: "sev sev-moderate",
    Minor: "sev sev-minor",
    Unknown: "sev sev-unknown",
  };

  const sevLabel = (s: SeverityLabel) =>
    formatSeverityLabel(s, options.severityScheme);

  const issueCard = (i: ConsolidatedIssue) => {
    const pagesDetails = i.pages.length
      ? `<details class="sources"><summary>Source pages (${i.pages.length})</summary><div class="sourceList">${i.pages
          .map((p) => `<div class="source">${escapeHtml(p)}</div>`)
          .join("")}</div></details>`
      : "";
    const wcag = i.wcag
      ? `<span class="pill">WCAG ${escapeHtml(i.wcag)}</span>`
      : "";
    const rule = i.ruleId
      ? `<span class="pill">Rule ${escapeHtml(i.ruleId)}</span>`
      : "";
    const sources = i.sourceFiles.length
      ? `<details class="sources"><summary>Source files (${i.sourceFiles.length})</summary><div class="sourceList">${i.sourceFiles
          .map((s) => `<div class="source">${escapeHtml(s)}</div>`)
          .join("")}</div></details>`
      : "";
    const examples = i.exampleSnippets?.length
      ? `<details class="sources"><summary>Example snippets (${i.exampleSnippets.length})</summary><div class="sourceList">${i.exampleSnippets
          .map((s) => `<div class="source">${escapeHtml(s)}</div>`)
          .join("")}</div></details>`
      : "";

    return `
			<article class="issue">
				<header class="issueHeader">
					<div class="badges">
						<span class="${severityClass[i.severity]}">${escapeHtml(sevLabel(i.severity))}</span>
						<span class="occ">${i.occurrences}×</span>
						${wcag}${rule}
					</div>
					<h4>${escapeHtml(i.title)}</h4>
				</header>
				<p class="desc">${escapeHtml(i.description || "")}</p>
				${sources}
				${pagesDetails}
				${examples}
			</article>
		`;
  };

  const totalUnique = filteredIssues.length;
  const totalOccurrences = filteredIssues.reduce(
    (acc, i) => acc + i.occurrences,
    0,
  );
  const generatedLabel = generatedAt
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const tabsSeverities = groups
    .filter((g) => g.issues.length > 0)
    .map((g) => g.severity);

  const tabsHtml = `
    <div class="tabsShell" data-severity-tabs>
      <h3 class="tabsTitle">Severity</h3>
      <div class="tabsTop">
        <div class="tabsSelectWrap">
          <select aria-label="Select a severity tab" class="tabsSelect">
            <option value="All">All (${filteredIssues.length})</option>
            ${tabsSeverities
              .map((s) => {
                const count =
                  groups.find((g) => g.severity === s)?.issues.length ?? 0;
                return `<option value="${s}">${escapeHtml(sevLabel(s))} (${count})</option>`;
              })
              .join("")}
          </select>
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="tabsChevron">
            <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" fill-rule="evenodd" />
          </svg>
        </div>
        <div class="tabsNavWrap">
          <nav class="tabsNav" aria-label="Severity tabs">
            <button type="button" class="tabBtn" data-tab="All" data-active="true">All <span class="tabCount">${filteredIssues.length}</span></button>
            ${tabsSeverities
              .map((s) => {
                const count =
                  groups.find((g) => g.severity === s)?.issues.length ?? 0;
                return `<button type="button" class="tabBtn" data-tab="${s}" data-active="false">${escapeHtml(sevLabel(s))} <span class="tabCount">${count}</span></button>`;
              })
              .join("")}
          </nav>
        </div>
      </div>
    </div>
  `;

  return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
	<style>${exportCss}</style>
</head>
<body>
	<div class="container">
    <div class="card header">
      <h2 class="sr-only">Report overview</h2>
      <p class="kicker">${escapeHtml(appName)}</p>
      <h1 class="big">${escapeHtml(docTitle)}</h1>
      <p class="small">Consolidated issue list with severity labels.</p>
      <div class="sub">Generated ${escapeHtml(generatedLabel)} • ${totalUnique} unique issues • ${totalOccurrences} total occurrences</div>
    </div>

    <h3 class="statsTitle">Totals</h3>
    <dl class="statsGrid">
      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">${escapeHtml(sevLabel("Critical"))} occurrences</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalsBySeverity.Critical}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">By severity</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">${escapeHtml(sevLabel("Serious"))} occurrences</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalsBySeverity.Serious}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">By severity</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">${escapeHtml(sevLabel("Moderate"))} occurrences</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalsBySeverity.Moderate}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">By severity</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">${escapeHtml(sevLabel("Minor"))} occurrences</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalsBySeverity.Minor}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">By severity</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">Unknown occurrences</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalsBySeverity.Unknown}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">By severity</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">All occurrences</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalOccurrences}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">Across all issues</span></div></div>
        </dd>
      </div>
    </dl>

    ${tabsHtml}

		${groups
      .map((g) => {
        if (g.issues.length === 0) return "";
        const severityTotal = g.issues.reduce(
          (acc, i) => acc + i.occurrences,
          0,
        );

        const byCategory = new Map<IssueCategory, ConsolidatedIssue[]>();
        for (const issue of g.issues) {
          const cat = categorizeIssue(issue);
          const arr = byCategory.get(cat) ?? [];
          arr.push(issue);
          byCategory.set(cat, arr);
        }
        const categories = Array.from(byCategory.entries())
          .map(([category, list]) => ({
            category,
            issues: list,
            occurrences: list.reduce((acc, i) => acc + i.occurrences, 0),
          }))
          .sort((a, b) => b.occurrences - a.occurrences);

        return `
          <section class="section" data-severity-panel="${g.severity}">
						<div class="sectionHeader">
							<h2>${escapeHtml(sevLabel(g.severity))}</h2>
							<div class="count">${g.issues.length} issues • ${severityTotal} occurrences</div>
						</div>
						${categories
              .map((c) => {
                return `
									<div class="group">
										<div class="groupHeader">
											<div class="name">${escapeHtml(c.category)}</div>
											<div class="meta">${c.issues.length} issues • ${c.occurrences} occurrences</div>
										</div>
										${c.issues.map(issueCard).join("")}
									</div>
								`;
              })
              .join("")}
					</section>
				`;
      })
      .join("")}

    <div class="footer">Generated by WCAG Audit Pipeline (local, in-browser parsing).</div>
  </div>
  <script>
    (() => {
      const root = document.querySelector('[data-severity-tabs]');
      if (!root) return;
      const select = root.querySelector('select');
      const buttons = Array.from(root.querySelectorAll('[data-tab]'));
      const panels = Array.from(document.querySelectorAll('[data-severity-panel]'));

      function setActive(tab) {
        for (const b of buttons) b.dataset.active = String(b.dataset.tab === tab);
        if (select) select.value = tab;
        for (const p of panels) {
          const sev = p.getAttribute('data-severity-panel');
          p.hidden = tab !== 'All' && sev !== tab;
        }
      }

      for (const b of buttons) {
        b.addEventListener('click', () => setActive(b.dataset.tab || 'All'));
      }
      if (select) select.addEventListener('change', () => setActive(select.value));
      setActive('All');
    })();
  </script>
</body>
</html>`;
}
