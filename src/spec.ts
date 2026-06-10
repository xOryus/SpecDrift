import { readFileSync } from "node:fs";
import { LlmClient, parseJsonArray, withRetry } from "./llm.js";
import { readCache, writeCache, sha1 } from "./cache.js";
import { SpecRule } from "./types.js";

const SYSTEM = `You convert a project's agent-instruction document (AGENTS.md / CLAUDE.md) into a list of atomic, verifiable rules.
Each rule must be a single concrete claim that could be confirmed or contradicted by reading source code.
Discard vague aspirations ("write clean code"), tone/style preferences with no code signature, and meta-instructions about the agent itself.
For each rule provide 3-6 lowercase search keywords likely to appear in code relevant to the rule (function names, identifiers, config keys, conventions).`;

const buildUser = (specText: string): string => `EXTRACT_RULES

Below is the project's agent-instruction document. Extract the checkable rules.

Return ONLY a JSON array, no prose, no markdown fences. Each item:
{"id": "R1", "rule": "<single verifiable claim>", "source": "<nearest heading>", "keywords": ["...", "..."]}

DOCUMENT:
"""
${specText}
"""`;

const normalize = (raw: SpecRule[]): SpecRule[] =>
  raw.map((r, i) => ({
    id: r.id || `R${i + 1}`,
    rule: r.rule,
    source: r.source || "(unknown section)",
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
  }));

const promptVersion = sha1(SYSTEM + buildUser.toString()).slice(0, 12);

export interface ExtractOutput {
  rules: SpecRule[];
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
}

export const extractRules = async (
  llm: LlmClient,
  specPath: string,
  cache?: { salt: string }
): Promise<ExtractOutput> => {
  const specText = readFileSync(specPath, "utf8");
  const key = cache ? sha1(`extract:${promptVersion}:${cache.salt}:${specText}`) : "";

  if (cache) {
    const hit = readCache<SpecRule[]>("rules", key);
    if (hit?.length) {
      return { rules: hit, inputTokens: 0, outputTokens: 0, cached: true };
    }
  }

  const out = await withRetry(async () => {
    const res = await llm.complete({
      system: SYSTEM,
      user: buildUser(specText),
      maxTokens: 4096,
    });
    const rules = normalize(parseJsonArray<SpecRule>(res.text));
    if (!rules.length) throw new Error("extraction returned no rules");
    return {
      rules,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    };
  });

  if (cache) writeCache("rules", key, out.rules);
  return { ...out, cached: false };
};
