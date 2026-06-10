import { RunResult } from "./types.js";
import { out, box, scoreboard, statusLabel, wrapText } from "./ui.js";

export const renderTerminal = (result: RunResult): string => {
  const width = Math.min(process.stdout.columns || 80, 100);
  const drift = result.findings.filter((f) => f.status === "drift");
  const unknown = result.findings.filter((f) => f.status === "unknown");
  const aligned = result.findings.filter((f) => f.status === "aligned");
  const order = [...drift, ...unknown, ...aligned];

  const lines: string[] = [""];

  lines.push(
    box(out, [
      out.light(out.bold("spec-drift report")),
      `${out.dim("spec  ")}${out.light(result.specPath)}`,
      `${out.dim("repo  ")}${out.light(result.repoRoot)}`,
      `${out.dim("model ")}${out.light(result.model)}`,
    ])
  );
  lines.push("");
  lines.push(scoreboard(out, drift.length, unknown.length, aligned.length));
  lines.push("");

  for (const f of order) {
    lines.push(`${statusLabel(out, f.status)}  ${out.bold(f.id)}  ${out.light(f.rule)}`);
    lines.push(`   ${out.dim(`${f.source} · confidence ${f.confidence}%`)}`);
    for (const l of wrapText(f.explanation, width, "   ")) lines.push(out.dim(l));
    if (f.references.length) {
      for (const l of wrapText(`↳ ${f.references.join(", ")}`, width, "   ")) {
        lines.push(out.cyan(l));
      }
    }
    lines.push("");
  }

  lines.push(out.teal("─".repeat(Math.min(width, 56))));

  const total = result.usage.inputTokens + result.usage.outputTokens;
  const cost =
    result.usage.estimatedUsd === 0
      ? total > 0
        ? "covered by your plan"
        : ""
      : `≈ $${result.usage.estimatedUsd.toFixed(4)}`;
  const meta = [
    `${result.findings.length} rules`,
    total > 0 ? `~${total} tokens` : "",
    cost,
    result.elapsedMs != null ? `${(result.elapsedMs / 1000).toFixed(1)}s` : "",
    result.cached ? "cached" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  lines.push(out.dim(meta));

  lines.push(
    drift.length
      ? out.red("drift detected — fix the code or update your spec")
      : out.green("in sync — code matches the spec")
  );
  lines.push("");
  return lines.join("\n");
};

export function renderMarkdown(result: RunResult): string {
  const drift = result.findings.filter((f) => f.status === "drift");
  const out: string[] = [];
  out.push(`## 🛰️ spec-drift report`);
  out.push("");
  out.push(`Checked \`${result.specPath}\` against the codebase with \`${result.model}\`.`);
  out.push("");
  if (!drift.length) {
    out.push(`✅ No drift detected across ${result.findings.length} rules.`);
  } else {
    out.push(`❌ **${drift.length} rule(s) drifted** out of ${result.findings.length} checked.`);
    out.push("");
    for (const f of drift) {
      out.push(`### ✗ ${f.id} — ${f.rule}`);
      out.push(`*${f.source} · confidence ${f.confidence}%*`);
      out.push("");
      out.push(f.explanation);
      if (f.references.length) {
        out.push("");
        out.push(`Files: ${f.references.map((r) => `\`${r}\``).join(", ")}`);
      }
      out.push("");
    }
  }
  const total = result.usage.inputTokens + result.usage.outputTokens;
  const cost =
    result.usage.estimatedUsd === 0
      ? total > 0
        ? "covered by your plan"
        : ""
      : `≈ $${result.usage.estimatedUsd.toFixed(4)}`;
  out.push(`<sub>~${total} tokens${cost ? ` · ${cost}` : ""}</sub>`);
  return out.join("\n");
}

export function renderJson(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}
