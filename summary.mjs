// prisma/cloud-deploy-action: the job summary, rendered from the run report
// the deploy writes to PRISMA_COMPOSER_REPORT_FILE.
import { readFileSync, statSync } from "node:fs";

/**
 * The run report the deploy wrote during this run, or null when there is
 * none. A file older than `notBefore` (epoch ms) is left over from an earlier
 * run, so it counts as none; so does a file that is not valid JSON.
 */
export function readRunReport(path, notBefore) {
  try {
    if (statSync(path).mtimeMs < notBefore) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The job summary markdown for one run. Without a report it still names the
 * outcome, the commit, and any service URLs the deploy output carried.
 *
 * @param {object} run
 * @param {"succeeded" | "failed" | "skipped-no-credential"} run.outcome
 * @param {"deploy" | "destroy"} run.mode
 * @param {string} run.stage - Empty for production.
 * @param {string} [run.sha]
 * @param {string} [run.ref]
 * @param {string | null} [run.buildId]
 * @param {object | null} [run.report] - The parsed run report.
 * @param {string} [run.reportPath]
 * @param {Record<string, string>} [run.urls] - Service URLs from the deploy output, used when there is no report.
 * @param {string} [run.cause] - The action's own error text, used when the report names no failure.
 */
export function renderJobSummary({ outcome, mode, stage, sha, ref, buildId, report, reportPath, urls = {}, cause }) {
  const target = stage ? `\`${stage}\`` : "production";
  const app = report?.app ? `\`${report.app}\` ` : "";
  const heading =
    outcome === "skipped-no-credential"
      ? "⏭ Skipped: no credential"
      : outcome !== "succeeded"
        ? `❌ ${mode === "destroy" ? "Destroy" : "Deploy"} failed`
        : mode === "destroy"
          ? `✅ Destroyed stage ${target}`
          : `✅ Deployed ${app}to ${target}`;
  const lines = [`### ${heading}`, ""];

  const context = [
    sha && `Commit \`${sha.slice(0, 7)}\``,
    ref && `on \`${ref}\``,
    buildId && `· build \`${buildId}\``,
  ].filter(Boolean);
  if (context.length > 0) lines.push(context.join(" "), "");

  const nodes = report?.nodes ?? [];
  const entities = (kind) =>
    nodes.flatMap((node) => (node.entities ?? []).filter((e) => e.kind === kind).map((e) => ({ ...e, address: node.address })));
  const services = report
    ? entities("compute-service")
    : Object.entries(urls).map(([address, url]) => ({ address, url }));
  if (services.length > 0) {
    lines.push("#### Services", "", "| Service | URL |", "| --- | --- |");
    for (const s of services) lines.push(`| \`${s.address}\` | ${s.url ?? ""} |`);
    lines.push("");
  }
  const databases = entities("postgres-database").map((d) => `\`${d.address}\` (\`${d.id}\`)`);
  if (databases.length > 0) lines.push(`Databases: ${databases.join(", ")}.`, "");

  // Phase timings belong here, once the deploy reports a duration per phase.

  // `absent` holds one "input path → variable" line per optional input whose variable was unset.
  const warnings = services.flatMap((s) => {
    const names = (s.details?.absent ?? "")
      .split("\n")
      .map((line) => line.split(" → ").pop().trim())
      .filter(Boolean)
      .map((name) => `\`${name}\``);
    if (names.length === 0) return [];
    return names.length === 1
      ? [`- \`${s.address}\`: optional input ${names[0]} is not set.`]
      : [`- \`${s.address}\`: optional inputs ${names.join(", ")} are not set.`];
  });
  if (warnings.length > 0) lines.push(`#### ⚠️ Warnings (${warnings.length})`, "", ...warnings, "");

  if (outcome === "failed") {
    const failure = report?.failure;
    const text = failure ? `${failure.code}: ${failure.message}` : cause;
    if (text) lines.push("#### Cause", "", "```text", text, "```", "");
  }

  if (report) {
    lines.push(
      "<details><summary>For tools and agents</summary>",
      "",
      `- Report: \`${reportPath}\` (step output \`report-path\`, run report version ${report.version})`,
      "",
      "</details>",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
