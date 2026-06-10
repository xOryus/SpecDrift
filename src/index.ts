#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderTerminal, renderMarkdown, renderJson } from "./report.js";
import { intro } from "./ui.js";
import { runCheck, autoDetectSpec, Backend } from "./run.js";
import { runInteractive } from "./interactive.js";

interface Options {
  spec?: string;
  repo: string;
  model: string;
  backend: Backend;
  format: "terminal" | "json" | "markdown";
  embeddings: boolean;
  cache: boolean;
  failOn: "drift" | "never";
}

const RUN_FLAGS = new Set([
  "--spec", "--repo", "--backend", "--model", "--format",
  "--embeddings", "--no-embeddings", "--no-cache", "--fail-on", "--mock",
]);

const parseArgs = (argv: string[]): Options => {
  const opts: Options = {
    repo: process.cwd(),
    model: "",
    backend: "claude-code",
    format: "terminal",
    embeddings: false,
    cache: true,
    failOn: "drift",
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--spec": opts.spec = argv[++i]; break;
      case "--repo": opts.repo = resolve(argv[++i]); break;
      case "--model": opts.model = argv[++i]; break;
      case "--backend": opts.backend = argv[++i] as Backend; break;
      case "--format": opts.format = argv[++i] as Options["format"]; break;
      case "--embeddings": opts.embeddings = true; break;
      case "--no-embeddings": opts.embeddings = false; break;
      case "--no-cache": opts.cache = false; break;
      case "--fail-on": opts.failOn = argv[++i] as Options["failOn"]; break;
      case "--mock": opts.backend = "mock"; break;
    }
  }
  return opts;
};

const HELP = `
spec-drift — detect semantic drift between your AGENTS.md / CLAUDE.md and your code

Usage:
  spec-drift                     Start the interactive, menu-driven app
  spec-drift [options]           Run once with flags (for scripts / CI)

Options:
  --spec <path>     Spec file. Default: auto-detect AGENTS.md, then CLAUDE.md
  --repo <dir>      Repo root to scan. Default: current directory
  --backend <b>     claude-code | api | mock. Default: claude-code
  --model <id>      Model override. Default: backend's default
  --format <fmt>    terminal | json | markdown. Default: terminal
  --embeddings      Add local semantic retrieval (downloads a ~23MB model once)
  --no-cache        Disable the on-disk extract/result cache
  --fail-on <when>  drift | never. Exit 1 on drift (for CI). Default: drift
  --interactive     Force the interactive app
  --no-interactive  Force one-shot flag mode
  -h, --help        Show this help

The default backend (claude-code) runs on your Claude Code login — no API key,
no per-token billing. Just keep ANTHROPIC_API_KEY unset.
`;

const shouldBeInteractive = (argv: string[]): boolean =>
  !!process.stdin.isTTY &&
  !!process.stdout.isTTY &&
  !argv.includes("--no-interactive") &&
  (argv.includes("--interactive") || !argv.some((a) => RUN_FLAGS.has(a)));

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }

  if (shouldBeInteractive(argv)) {
    process.exit(await runInteractive());
  }

  const opts = parseArgs(argv);

  if (!["claude-code", "api", "mock"].includes(opts.backend)) {
    process.stderr.write(`error: unknown backend '${opts.backend}'. Use claude-code | api | mock.\n`);
    process.exit(2);
  }
  if (!["terminal", "json", "markdown"].includes(opts.format)) {
    process.stderr.write(`error: unknown format '${opts.format}'. Use terminal | json | markdown.\n`);
    process.exit(2);
  }

  const specPath = opts.spec ?? autoDetectSpec(opts.repo);
  if (!specPath || !existsSync(specPath)) {
    process.stderr.write(
      "error: no spec file found. Pass --spec or add an AGENTS.md / CLAUDE.md (or run with no flags for the interactive app).\n"
    );
    process.exit(2);
  }

  if (opts.backend === "api" && !process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      "error: backend 'api' needs ANTHROPIC_API_KEY. Use --backend claude-code for your Max plan, or --mock.\n"
    );
    process.exit(2);
  }

  if (opts.format === "terminal" && process.stderr.isTTY) {
    process.stderr.write(intro(process.stderr.columns) + "\n");
  }

  const result = await runCheck({
    spec: specPath,
    repo: opts.repo,
    model: opts.model,
    backend: opts.backend,
    embeddings: opts.embeddings,
    cache: opts.cache,
  });

  if (opts.format === "json") process.stdout.write(renderJson(result) + "\n");
  else if (opts.format === "markdown") process.stdout.write(renderMarkdown(result) + "\n");
  else process.stdout.write(renderTerminal(result));

  const drifted = result.findings.some((f) => f.status === "drift");
  process.exit(opts.failOn === "drift" && drifted ? 1 : 0);
};

main().catch((e) => {
  process.stderr.write(`spec-drift failed: ${e?.message ?? e}\n`);
  process.exit(2);
});
