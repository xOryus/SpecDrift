import { existsSync } from "node:fs";
import { join } from "node:path";
import { extractRules } from "./spec.js";
import { retrieveEvidence } from "./retrieve.js";
import { checkDrift, checkVersion } from "./check.js";
import {
  AnthropicClient,
  ClaudeCodeClient,
  MockClient,
  LlmClient,
  estimateUsd,
} from "./llm.js";
import { readCache, writeCache, sha1 } from "./cache.js";
import { loadEmbedder } from "./embed.js";
import { createSpinner, err } from "./ui.js";
import { DriftFinding, RunResult } from "./types.js";

export type Backend = "claude-code" | "api" | "mock";

export interface RunOptions {
  spec?: string;
  repo: string;
  model: string;
  backend: Backend;
  embeddings: boolean;
  cache: boolean;
}

export const autoDetectSpec = (repo: string): string | undefined => {
  for (const name of ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"]) {
    const p = join(repo, name);
    if (existsSync(p)) return p;
  }
  return undefined;
};

export const makeClient = (opts: RunOptions): LlmClient => {
  switch (opts.backend) {
    case "mock":
      return new MockClient();
    case "api":
      return new AnthropicClient(opts.model || "claude-haiku-4-5");
    default:
      return new ClaudeCodeClient(opts.model || undefined);
  }
};

export const runCheck = async (opts: RunOptions): Promise<RunResult> => {
  const t0 = Date.now();
  const specPath = opts.spec ?? autoDetectSpec(opts.repo);
  if (!specPath || !existsSync(specPath)) {
    throw new Error("no spec file found (add an AGENTS.md or CLAUDE.md)");
  }

  const llm = makeClient(opts);
  const cacheable = opts.cache && opts.backend !== "mock";
  const salt = `${opts.backend}:${opts.model || "default"}`;
  const spin = createSpinner(err);

  spin.start("Extracting rules from spec");
  const ext = await extractRules(llm, specPath, cacheable ? { salt } : undefined);
  spin.succeed(`${ext.rules.length} rules extracted${ext.cached ? err.gray(" (cached)") : ""}`);

  let embedder = null;
  if (opts.embeddings) {
    spin.start("Loading local embedding model");
    embedder = await loadEmbedder();
    spin.succeed("embedding model ready");
  }

  spin.start("Retrieving evidence");
  const retrieved = await retrieveEvidence(opts.repo, ext.rules, { embedder });
  spin.succeed(`evidence retrieved across ${ext.rules.length} rules`);

  const checkKey = sha1(
    `check:${checkVersion}:${salt}:${retrieved.repoHash}:${JSON.stringify(ext.rules)}`
  );
  const cached = cacheable ? readCache<DriftFinding[]>("findings", checkKey) : null;

  let findings: DriftFinding[];
  let it2 = 0;
  let ot2 = 0;
  spin.start("Checking drift");
  if (cached) {
    findings = cached;
    spin.succeed("drift result served from cache");
  } else {
    const checked = await checkDrift(
      llm,
      retrieved.rules,
      retrieved.manifest,
      retrieved.hardcodedConstants
    );
    findings = checked.findings;
    it2 = checked.inputTokens;
    ot2 = checked.outputTokens;
    spin.succeed("drift check complete");
    if (cacheable) writeCache("findings", checkKey, findings);
  }

  const inputTokens = ext.inputTokens + it2;
  const outputTokens = ext.outputTokens + ot2;
  const onSubscription = opts.backend === "claude-code";
  const modelLabel =
    opts.backend === "mock"
      ? "mock"
      : opts.backend === "api"
      ? opts.model || "claude-haiku-4-5"
      : (opts.model || "claude-code") + " (Max plan)";

  return {
    specPath,
    repoRoot: opts.repo,
    model: modelLabel,
    findings,
    usage: {
      inputTokens,
      outputTokens,
      estimatedUsd: onSubscription
        ? 0
        : estimateUsd(opts.model || "claude-haiku-4-5", inputTokens, outputTokens),
    },
    elapsedMs: Date.now() - t0,
    cached: !!cached,
  };
};
