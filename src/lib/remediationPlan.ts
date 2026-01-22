import {
  categorizeIssue,
  formatSeverityLabel,
  type ConsolidatedIssue,
  type IssueCategory,
  type SeverityLabel,
  type SeverityScheme,
} from "./starkParser";

import exportCss from "../styles/export.css?inline";

export type PlanIssueGroup = ConsolidatedIssue & {
  key: string;
  category: IssueCategory;
};

export type Estimate = {
  lowHours: number;
  highHours: number;
  assumptions: string[];
};

export type EstimateOverride = {
  /** If set, overrides the tool estimate for totals and display. */
  hours?: number;
  /** Optional notes to carry into the remediation document. */
  notes?: string;
};

export type EstimateOverrides = Record<string, EstimateOverride>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function severityMultiplier(severity: SeverityLabel): number {
  if (severity === "Critical") return 1.35;
  if (severity === "Serious") return 1.2;
  if (severity === "Moderate") return 1.0;
  if (severity === "Minor") return 0.85;
  return 1.0;
}

export function estimateForCategory(
  category: IssueCategory,
  occurrences: number,
  severity: SeverityLabel,
): Estimate {
  // Base time per *unique issue group* (not per occurrence), scaled sublinearly by occurrences.
  // These are intentionally coarse “initial estimates” and should be refined after implementation discovery.
  const base = (() => {
    switch (category) {
      case "Alt text":
        return { low: 0.5, high: 1.5 };
      case "Color contrast":
        return { low: 1.5, high: 6 };
      case "Form labels":
        return { low: 1, high: 4 };
      case "Link text":
        return { low: 0.5, high: 2 };
      case "Button text":
        return { low: 0.5, high: 2 };
      case "Headings":
        return { low: 0.5, high: 2 };
      case "ARIA / landmarks":
        return { low: 1, high: 5 };
      case "Keyboard / focus":
        return { low: 1.5, high: 7 };
      case "Language":
        return { low: 0.25, high: 1 };
      case "Tables":
        return { low: 2, high: 8 };
      default:
        return { low: 1, high: 4 };
    }
  })();

  const sev = severityMultiplier(severity);
  const occurrenceFactor = 1 + Math.log10(Math.max(1, occurrences)); // 1..~3
  const lowHours = base.low * sev * occurrenceFactor;
  const highHours = base.high * sev * occurrenceFactor;

  const assumptions: string[] = [];
  if (category === "Color contrast") {
    assumptions.push(
      "Assumes a small number of shared design tokens or CSS variables can fix multiple failures.",
    );
    assumptions.push(
      "If contrast failures are baked into images, effort increases (asset updates).",
    );
  }
  if (category === "Alt text")
    assumptions.push(
      "Assumes images are content-managed or have accessible text equivalents available.",
    );
  if (category === "Form labels")
    assumptions.push(
      "Assumes form fields can be labelled with <label> or aria-label/aria-labelledby without redesign.",
    );
  if (category === "Keyboard / focus")
    assumptions.push(
      "Assumes interactive elements can be made keyboard reachable and focus styles are allowed by design.",
    );

  return {
    lowHours: clamp(lowHours, 0.25, 80),
    highHours: clamp(highHours, 0.5, 120),
    assumptions,
  };
}

export function computeIssueKey(
  issue: Pick<ConsolidatedIssue, "ruleId" | "wcag" | "title" | "description">,
): string {
  const title = normalizeText(issue.title) || "Issue";
  const description = normalizeText(issue.description);
  const wcag = normalizeText(issue.wcag) || "";
  const ruleId = normalizeText(issue.ruleId) || "";
  return `${ruleId}|${wcag}|${title}|${description}`.toLowerCase();
}

export function estimateForConsolidatedIssue(
  issue: ConsolidatedIssue,
): Estimate {
  const category = categorizeIssue(issue);
  return estimateForCategory(category, issue.occurrences, issue.severity);
}

function recommendationForCategory(category: IssueCategory): {
  summary: string;
  steps: string[];
  verification: string[];
} {
  switch (category) {
    case "Color contrast":
      return {
        summary:
          "Adjust foreground/background colors to meet contrast ratios (4.5:1 normal text, 3:1 large text and UI components).",
        steps: [
          "Identify failing component(s) and the exact foreground/background pair used in the UI.",
          "Prefer fixing via shared tokens (CSS variables / theme tokens) so many pages improve at once.",
          "For text on images, add a scrim/overlay or change the image/placement to ensure readable contrast.",
          "Check hover/active/disabled states too.",
        ],
        verification: [
          "Re-run Stark and confirm WCAG 1.4.3 no longer reports failures.",
          "Spot-check key pages in both light/dark modes (if applicable).",
        ],
      };
    case "Alt text":
      return {
        summary:
          'Add meaningful alt text for informative images; use empty alt (alt="") for decorative images.',
        steps: [
          "For each failing image, decide if it is informative or decorative.",
          "If informative: provide concise alt text that conveys purpose; avoid repeating nearby text.",
          'If decorative: set alt="" and ensure it is not a link-only control without other label.',
        ],
        verification: [
          "Re-run Stark and verify the “Non-text content / alt text” failures are resolved.",
          "Use a screen reader quick pass (VO/NVDA) on representative pages.",
        ],
      };
    case "Form labels":
      return {
        summary:
          "Ensure every form control has an accessible name via <label>, aria-label, or aria-labelledby.",
        steps: [
          "Prefer <label for=...> for inputs; ensure ids are unique and stable.",
          "For custom controls, ensure role, name, value are correct and programmatically associated.",
          "Validate placeholder text is not used as the only label.",
        ],
        verification: [
          "Tab through forms; confirm each field announces a useful label.",
          "Re-run Stark and confirm label-related failures drop to zero.",
        ],
      };
    case "Link text":
      return {
        summary:
          "Make link text descriptive (avoid “click here”); ensure icon-only links have accessible names.",
        steps: [
          "Update anchor text to describe destination or action.",
          "For icon-only links, add visible text, sr-only text, or aria-label.",
        ],
        verification: [
          "Re-run Stark and confirm “discernible link text” issues are resolved.",
        ],
      };
    case "Button text":
      return {
        summary: "Ensure buttons have discernible text or an accessible name.",
        steps: [
          "For icon-only buttons, add aria-label or sr-only text.",
          "Ensure the accessible name matches the intended action.",
        ],
        verification: ["Re-run Stark; verify button-name issues are resolved."],
      };
    case "Headings":
      return {
        summary:
          "Fix heading structure (H1..H6) to reflect page outline and avoid skipping levels.",
        steps: [
          "Ensure each page has a single H1 that describes the page.",
          "Use headings in order; do not skip levels for styling.",
        ],
        verification: [
          "Use a screen reader rotor/headings list; verify the outline is logical.",
        ],
      };
    case "ARIA / landmarks":
      return {
        summary:
          "Use native semantics first; add ARIA only when necessary and ensure roles/labels are valid.",
        steps: [
          "Prefer semantic elements (<nav>, <main>, <header>, <button>, <a>) over role replacements.",
          "Ensure landmark regions are unique and labelled when multiple exist.",
          "Validate aria-* references point to existing ids.",
        ],
        verification: [
          "Re-run Stark; spot-check landmarks with a screen reader rotor.",
        ],
      };
    case "Keyboard / focus":
      return {
        summary:
          "Ensure all interactive elements are keyboard operable and focus is visible.",
        steps: [
          "Ensure interactive elements are reachable via Tab and operable via Enter/Space.",
          "Fix focus traps and ensure logical focus order.",
          "Add a visible focus style that meets contrast requirements.",
        ],
        verification: [
          "Do a full keyboard pass of key flows; re-run Stark and confirm keyboard/focus issues improve.",
        ],
      };
    case "Language":
      return {
        summary:
          "Set the page language (lang) and mark language changes within content where needed.",
        steps: [
          'Ensure <html lang="..."> is present and correct.',
          "For mixed-language content, use lang on specific elements.",
        ],
        verification: [
          "Re-run Stark and confirm language-related checks pass.",
        ],
      };
    case "Tables":
      return {
        summary:
          "Ensure data tables use proper headers (<th>, scope) and associations.",
        steps: [
          "Add <th> for header cells and scope attributes when appropriate.",
          "Avoid tables for layout.",
        ],
        verification: [
          "Navigate the table with a screen reader; confirm header associations are announced.",
        ],
      };
    default:
      return {
        summary:
          "Address the underlying issue following WCAG guidance and best practices.",
        steps: [
          "Identify the component/content source causing the issue and fix at the source.",
          "Re-test after changes.",
        ],
        verification: ["Re-run Stark to confirm the issue is resolved."],
      };
  }
}

function groupIssues(issues: ConsolidatedIssue[]): PlanIssueGroup[] {
  const map = new Map<string, PlanIssueGroup>();
  for (const i of issues) {
    const title = normalizeText(i.title) || "Issue";
    const description = normalizeText(i.description);
    const wcag = normalizeText(i.wcag) || undefined;
    const ruleId = normalizeText(i.ruleId) || undefined;
    const category = categorizeIssue({ title, description, wcag, ruleId });
    const key = `${category}|${computeIssueKey({ title, description, wcag, ruleId })}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...i,
        key,
        category,
        title,
        description,
        wcag,
        ruleId,
      });
      continue;
    }

    // Shouldn't happen often since input is already consolidated, but keep it safe.
    existing.occurrences += Number.isFinite(i.occurrences) ? i.occurrences : 1;
    const rank: Record<SeverityLabel, number> = {
      Critical: 4,
      Serious: 3,
      Moderate: 2,
      Minor: 1,
      Unknown: 0,
    };
    if (rank[i.severity] > rank[existing.severity])
      existing.severity = i.severity;
    for (const p of i.pages ?? [])
      if (p && !existing.pages.includes(p)) existing.pages.push(p);
    for (const s of i.sourceFiles ?? [])
      if (s && !existing.sourceFiles.includes(s)) existing.sourceFiles.push(s);
  }
  return Array.from(map.values());
}

export function issuesToRemediationPlanHtml(
  issues: ConsolidatedIssue[],
  options: {
    reportTitle?: string;
    generatedAt?: Date;
    scopeCategory?: IssueCategory;
    overrides?: EstimateOverrides;
    severityScheme?: SeverityScheme;
  } = {},
): string {
  const title =
    options.reportTitle ?? "Accessibility Remediation Recommendations";
  const generatedAt = options.generatedAt ?? new Date();
  const scopeCategory = options.scopeCategory;
  const overrides = options.overrides ?? {};
  const sevLabel = (s: SeverityLabel) =>
    formatSeverityLabel(s, options.severityScheme);

  const scoped = scopeCategory
    ? issues.filter((i) => categorizeIssue(i) === scopeCategory)
    : issues;
  const grouped = groupIssues(scoped);

  const byCategory = new Map<IssueCategory, PlanIssueGroup[]>();
  for (const g of grouped) {
    const arr = byCategory.get(g.category) ?? [];
    arr.push(g);
    byCategory.set(g.category, arr);
  }

  const categories = Array.from(byCategory.entries())
    .map(([category, list]) => {
      const occurrences = list.reduce((acc, i) => acc + i.occurrences, 0);
      const estimatedHours = list.reduce((acc, i) => {
        const o = overrides[i.key];
        return (
          acc +
          (typeof o?.hours === "number" && Number.isFinite(o.hours)
            ? o.hours
            : 0)
        );
      }, 0);
      const estimatedCount = list.reduce((acc, i) => {
        const o = overrides[i.key];
        return (
          acc +
          (typeof o?.hours === "number" && Number.isFinite(o.hours) ? 1 : 0)
        );
      }, 0);
      return { category, list, occurrences, estimatedHours, estimatedCount };
    })
    .sort((a, b) => b.occurrences - a.occurrences);

  const totalEstimatedHours = categories.reduce(
    (acc, c) => acc + c.estimatedHours,
    0,
  );
  const totalEstimatedCount = categories.reduce(
    (acc, c) => acc + c.estimatedCount,
    0,
  );
  const totalGroups = grouped.length;
  const unestimatedCount = Math.max(0, totalGroups - totalEstimatedCount);
  const toHours = (n: number) => `${Math.round(n * 10) / 10}h`;
  const generatedLabel = generatedAt
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const issueRow = (i: PlanIssueGroup) => {
    const override = overrides[i.key];
    const meta = [
      i.wcag ? `WCAG ${i.wcag}` : "",
      i.ruleId ? `Rule ${i.ruleId}` : "",
    ]
      .filter(Boolean)
      .join(" • ");
    const pages = i.pages.length
      ? `<details><summary>Pages (${i.pages.length})</summary><ul>${i.pages
          .map((p) => `<li>${escapeHtml(p)}</li>`)
          .join("")}</ul></details>`
      : "";
    const yourEst =
      typeof override?.hours === "number" && Number.isFinite(override.hours)
        ? `<span class="pill">Estimate: ${toHours(override.hours)}</span>`
        : `<span class="pill pill-muted">Unestimated</span>`;
    const notes = override?.notes
      ? `<details><summary>Notes</summary><div class="desc">${escapeHtml(override.notes)}</div></details>`
      : "";
    return `
			<article class="issue">
				<div class="issueTop">
					<div>
						<div class="badges">
							<span class="sev sev-${i.severity.toLowerCase()}">${escapeHtml(sevLabel(i.severity))}</span>
							<span class="pill">${i.occurrences}×</span>
							${yourEst}
						</div>
						<div class="title">${escapeHtml(i.title)}</div>
						${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}
					</div>
				</div>
				<div class="desc">${escapeHtml(i.description || "")}</div>
				${pages}
				${notes}
			</article>
		`;
  };

  return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(title)}</title>
	<style>${exportCss}</style>
</head>
<body>
	<div class="container">
		<h1>${escapeHtml(title)}</h1>
		<div class="sub">Generated ${escapeHtml(generatedLabel)} • ${grouped.length} issue groups • ${scoped.length} raw findings</div>

    <h3 class="statsTitle">Totals</h3>
    <dl class="statsGrid">
      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
            </svg>
          </div>
          <p class="statsLabel">Your estimate total</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${totalEstimatedCount > 0 ? toHours(totalEstimatedHours) : "—"}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">${totalEstimatedCount} of ${totalGroups} groups</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <p class="statsLabel">Unestimated groups</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${unestimatedCount}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">Add estimates in the app</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3 13.5H6A2.25 2.25 0 0 1 3.75 19.25V4.75A2.25 2.25 0 0 1 6 2.5h8.25L20.25 8.5v10.75A2.25 2.25 0 0 1 18 21.5Z" />
            </svg>
          </div>
          <p class="statsLabel">Total occurrences (grouped)</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${grouped.reduce((acc, i) => acc + i.occurrences, 0)}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">Across all categories</span></div></div>
        </dd>
      </div>

      <div class="statsCard">
        <dt>
          <div class="statsIconWrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="statsIcon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m11.142-4.5L21.75 12l-4.179 2.25m-2.822 1.5L12 21.75l-2.75-6m0 0L12 12l2.75 3.75M12 12 9.25 15.75" />
            </svg>
          </div>
          <p class="statsLabel">Categories affected</p>
        </dt>
        <dd class="statsValueRow">
          <p class="statsValue">${categories.length}</p>
          <div class="statsFooter"><div class="text-sm"><span class="statsFooterText">Prioritize top categories</span></div></div>
        </dd>
      </div>
    </dl>

		<div class="reco">
			<div class="title">How to use this</div>
			<ul>
				<li>Start with categories with the highest occurrences and highest severity.</li>
				<li>Fix at the source (shared components, templates, theme tokens) to reduce many findings at once.</li>
				<li>Re-test after each batch of changes; update estimates as unknowns are discovered.</li>
			</ul>
		</div>

		${categories
      .map((c) => {
        const reco = recommendationForCategory(c.category);
        return `
					<section class="section">
						<div class="sectionHeader">
							<h2>${escapeHtml(c.category)}</h2>
							<div class="sub">${c.list.length} groups • ${c.occurrences} occurrences • Your est: ${c.estimatedCount > 0 ? toHours(c.estimatedHours) : "—"} (${c.estimatedCount}/${c.list.length})</div>
						</div>
						<p class="kicker">${escapeHtml(reco.summary)}</p>
						<details class="reco" open>
							<summary>Recommended steps & verification</summary>
							<div class="kicker"><strong>Steps</strong></div>
							<ul>${reco.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
							<div class="kicker"><strong>Verification</strong></div>
							<ul>${reco.verification.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
						</details>
						${c.list
              .sort((a, b) => b.occurrences - a.occurrences)
              .map(issueRow)
              .join("")}
					</section>
				`;
      })
      .join("")}

		<div class="footer">Generated locally from Stark HTML exports. Estimates are directional and should be refined during remediation.</div>
	</div>
</body>
</html>`;
}
