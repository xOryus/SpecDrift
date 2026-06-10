// Shared types for spec-drift.

export type DriftStatus = "aligned" | "drift" | "unknown";

/** An atomic, checkable assertion extracted from the spec doc. */
export interface SpecRule {
  id: string;
  /** The rule restated as a single verifiable claim. */
  rule: string;
  /** Original section/heading it came from, for traceability. */
  source: string;
  /** Search terms used to retrieve relevant code without manual anchoring. */
  keywords: string[];
}

/** A snippet of code retrieved as evidence for a rule. */
export interface Evidence {
  file: string;
  line: number;
  snippet: string;
}

/** A rule with its gathered evidence, ready for the drift check. */
export interface RuleWithEvidence extends SpecRule {
  evidence: Evidence[];
  /** Every repo file whose content matches any of the rule's keywords
   *  (paths only) — the exhaustive search space for prohibition/coverage
   *  reasoning, distinct from the sampled `evidence` snippets. */
  coverageFiles?: string[];
}

/** An exported constant value found hardcoded as a literal elsewhere. */
export interface HardcodedConstant {
  name: string;
  value: string;
  defFile: string;
  uses: { file: string; line: number }[];
}

/** The LLM's verdict for one rule. */
export interface DriftFinding {
  id: string;
  rule: string;
  source: string;
  status: DriftStatus;
  /** Short human explanation of the verdict. */
  explanation: string;
  /** Files the verdict is grounded in. */
  references: string[];
  /** 0-100; how confident the model is. */
  confidence: number;
}

export interface RunResult {
  specPath: string;
  repoRoot: string;
  model: string;
  findings: DriftFinding[];
  /** Rough token + cost accounting for the run. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
  };
  elapsedMs?: number;
  cached?: boolean;
}
