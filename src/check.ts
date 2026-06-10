import { LlmClient, parseJsonArray, withRetry } from "./llm.js";
import { sha1 } from "./cache.js";
import { DriftFinding, HardcodedConstant, RuleWithEvidence } from "./types.js";

const SYSTEM = `You are a code auditor. For each rule you receive: (a) a REPOSITORY FILE TREE listing every source file path in the project, (b) sampled code snippets retrieved as EVIDENCE, (c) a KEYWORD COVERAGE list naming every file whose contents match the rule's keywords, and (d) STRUCTURAL SIGNALS listing exported-constant values found hardcoded as string literals elsewhere.
Decide for each rule: "aligned" (the code honors the rule), "drift" (the code contradicts it), or "unknown" (evidence is insufficient to judge).

Judge by rule type:
- File-naming / file-location rules (kebab-case, PascalCase, "lives in folder X", "only in ui/"): judge from the FILE TREE, which is authoritative and complete. A single path that violates the convention is "drift" — cite that path.
- Prohibition / exclusivity rules ("never X", "only in Y", "not outside Z"): the KEYWORD COVERAGE is the search space. Inspect any file outside the allowed location; if none offends across full coverage, that supports "aligned"; if coverage cannot exercise the rule, answer "unknown".
- "Use the constant / never hardcode" rules: consult STRUCTURAL SIGNALS. A constant value hardcoded as a literal outside its definition file is "drift" — cite the offending file:line.
- Behavioral rules: judge from the EVIDENCE snippets.

Calibration (important): do NOT answer "aligned" unless the FILE TREE, COVERAGE, STRUCTURAL SIGNALS, or EVIDENCE affirmatively confirms compliance across the rule's full stated scope. When you only have a partial sample that cannot establish a universal ("all", "every") or absence ("never", "no") claim, answer "unknown" rather than an optimistic "aligned". Never assume code you cannot see. Cite the exact path or snippet behind every verdict.`;

const MAX_SNIPPET_CHARS = 6000;
const MAX_TREE_FILES = 800;
const MAX_COVERAGE_SHOWN = 40;

const signalsBlock = (consts: HardcodedConstant[]): string =>
  consts.length
    ? consts
        .map(
          (c) =>
            `- "${c.value}" = exported constant ${c.name} (${c.defFile}); hardcoded as a literal in: ${c.uses
              .map((u) => `${u.file}:${u.line}`)
              .join(", ")}`
        )
        .join("\n")
    : "(none detected)";

const buildUser = (
  rules: RuleWithEvidence[],
  manifest: string,
  consts: HardcodedConstant[]
): string => {
  const all = manifest ? manifest.split("\n") : [];
  const treeBlock =
    all.slice(0, MAX_TREE_FILES).join("\n") +
    (all.length > MAX_TREE_FILES ? `\n...(+${all.length - MAX_TREE_FILES} more files)` : "");

  const blocks = rules
    .map((r) => {
      const ev = r.evidence.length
        ? r.evidence
            .map((e) => `--- ${e.file}:${e.line} ---\n${e.snippet.slice(0, MAX_SNIPPET_CHARS)}`)
            .join("\n")
        : "(no matching code found)";
      const files = r.coverageFiles ?? [];
      const cov = files.length
        ? files.slice(0, MAX_COVERAGE_SHOWN).join(", ") +
          (files.length > MAX_COVERAGE_SHOWN ? `, ...(+${files.length - MAX_COVERAGE_SHOWN} more)` : "")
        : "(no files match the keywords)";
      return `### ${r.id}\nRULE: ${r.rule}\nSOURCE: ${r.source}\nKEYWORD COVERAGE: ${cov}\nEVIDENCE:\n${ev}`;
    })
    .join("\n\n");

  return `CHECK_DRIFT

For each rule below, judge alignment. Use the REPOSITORY FILE TREE for file-naming/location rules, the KEYWORD COVERAGE as the search space for prohibition rules, STRUCTURAL SIGNALS for hardcoded-constant rules, and the EVIDENCE snippets for behavioral rules.

Return ONLY a JSON array, no prose, no markdown fences. One object per rule:
{"id": "R1", "rule": "<copy of rule>", "source": "<copy of source>", "status": "aligned|drift|unknown", "explanation": "<specific reason>", "references": ["file paths the verdict relies on"], "confidence": <0-100>}

REPOSITORY FILE TREE:
${treeBlock}

STRUCTURAL SIGNALS (hardcoded constant values):
${signalsBlock(consts)}

RULES AND EVIDENCE:
${blocks}`;
};

export const checkVersion = sha1(SYSTEM + buildUser.toString()).slice(0, 12);

export interface CheckOutput {
  findings: DriftFinding[];
  inputTokens: number;
  outputTokens: number;
}

export const checkDrift = async (
  llm: LlmClient,
  rules: RuleWithEvidence[],
  manifest = "",
  consts: HardcodedConstant[] = []
): Promise<CheckOutput> => {
  if (!rules.length) return { findings: [], inputTokens: 0, outputTokens: 0 };
  const maxTokens = Math.min(8192, 1024 + rules.length * 320);

  return withRetry(async () => {
    const res = await llm.complete({
      system: SYSTEM,
      user: buildUser(rules, manifest, consts),
      maxTokens,
    });
    const findings = parseJsonArray<DriftFinding>(res.text).map((f) => ({
      id: f.id,
      rule: f.rule,
      source: f.source ?? "",
      status: (["aligned", "drift", "unknown"].includes(f.status)
        ? f.status
        : "unknown") as DriftFinding["status"],
      explanation: f.explanation ?? "",
      references: Array.isArray(f.references) ? f.references : [],
      confidence: typeof f.confidence === "number" ? f.confidence : 0,
    }));
    if (!findings.length) throw new Error("check returned no findings");
    return { findings, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  });
};
