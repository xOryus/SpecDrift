<div align="center">

<h1>spec-drift</h1>

<p><strong>Your <code>AGENTS.md</code> is a contract. spec-drift tells you when your code stops honoring it.</strong></p>

<p><em>The drift detector for the agentic era. Catch the moment your rules and your code stop agreeing, before your AI agents act on a lie.</em></p>

<p>
  <a href="#backends"><img src="https://img.shields.io/badge/runs_on-Claude_Code-D97757?style=flat-square&logo=anthropic&logoColor=white" alt="Runs on Claude Code"></a>
  <a href="#backends"><img src="https://img.shields.io/badge/API_key-not_required-2EA043?style=flat-square" alt="No API key required"></a>
  <a href="#backends"><img src="https://img.shields.io/badge/extra_cost-%240-2EA043?style=flat-square" alt="No extra cost"></a>
  <a href="#how-it-works"><img src="https://img.shields.io/badge/retrieval-100%25_local-2F81F7?style=flat-square" alt="Local retrieval"></a>
  <a href="#architecture"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/Node-%E2%89%A518-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node >= 18"></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-303841?style=flat-square" alt="MIT License"></a>
</p>

<p>
  <a href="#quick-start">Quick start</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#examples">Examples</a> &middot;
  <a href="#faq">FAQ</a>
</p>

</div>

---

> **No API key. No external account. No per-token bill.**
>
> spec-drift runs on the Claude Code you already have. If you can run `claude`, you can run spec-drift. It reuses your existing Pro/Max login over OAuth. Nothing to sign up for, nothing to integrate, nothing extra to pay.

## Why it exists

Agent instruction files (`AGENTS.md`, `CLAUDE.md`) are the rules your AI coding agents read before they touch your codebase. They are written once, trusted forever, and almost never re-checked. Months later the code has moved on, the rules have not, and every agent that reads them is now building on assumptions the codebase abandoned weeks ago.

Your linter checks syntax. Your tests check behavior. Nothing checks whether your codebase still means what your documentation says it means.

spec-drift closes that gap with a single command. It reads the document the way a reviewer would, turns its prose into atomic checkable rules, finds the relevant code on its own, and grounds every verdict in a specific file and line.

```
DRIFT   Database access must use the DATABASE_ID constant.
        'graph-palette-box' is the value of DATABASE_ID (src/lib/appwrite.ts) but is
        hardcoded as a literal in src/lib/share.ts:40,58,68,74,80.
```

## What sets it apart

- **No manual anchoring.** Rules are extracted from prose and matched to code automatically. You maintain one document, not a mapping table.
- **Structural-aware retrieval.** Beyond keyword search, spec-drift feeds the checker a full repository file tree and tracks exported-constant values across the codebase. This is what lets it catch naming, placement, and "don't hardcode this" rules that text search alone is blind to.
- **Runs on your subscription.** The default backend uses your existing Claude Code login. No API key, no separate account, no per-token billing.
- **Honest by design.** When the evidence is thin, the verdict is `unknown`, never an optimistic pass. It will not manufacture confidence it does not have.
- **Built to run repeatedly.** Results are cached by content, so an unchanged spec and codebase return instantly and for free. Drift detection belongs in CI, and the exit code reflects it.

## How it works

```
  AGENTS.md ──▶  Extract ──▶  atomic rules + keywords        cached by spec
                                   │
       repo  ──▶  Retrieve  ◀──────┘   keyword search · file-tree manifest · constant tracking · optional embeddings
                     │
                     ▼
                  Check    ──▶  aligned · drift · unknown     cached by repo + rules
                     │
                     ▼
                  Report   ──▶  terminal · JSON · Markdown    exit 1 on drift
```

1. **Extract.** One model call distills the spec into atomic, individually verifiable rules with retrieval keywords.
2. **Retrieve.** Fully local. Keyword search, a repository file-tree manifest, exported-constant value tracking, and an optional on-device embedding model assemble the evidence for each rule. Nothing is written into the scanned repository.
3. **Check.** One consolidated model call judges each rule against its evidence and cites the file and line behind every verdict.
4. **Report.** Rendered to the terminal, or emitted as JSON or Markdown for dashboards and pull requests.

Two model calls per run, regardless of repository size, so latency and cost stay flat as you grow, and a cached re-run costs nothing.

## Requirements

- Node.js 18 or later
- For the default backend: Claude Code installed and logged in (`claude` on your `PATH`)

## Installation

```bash
git clone https://github.com/your-org/spec-drift.git
cd spec-drift
npm install
npm run build
```

To make `spec-drift` available as a global command:

```bash
npm link
```

## Quick start

Run it with no arguments to launch the guided, interactive app:

```bash
spec-drift
```

You are walked through choosing a repository, a backend, and a model, then shown a cited report you can act on. No flags to memorize.

For scripts or CI, pass flags and spec-drift skips the menu entirely:

```bash
spec-drift --repo ./my-app
```

## Configuration

### Backends

| Backend | Authentication | Cost |
| --- | --- | --- |
| `claude-code` *(default)* | Your existing Claude Code login | Covered by your Pro/Max plan |
| `api` | `ANTHROPIC_API_KEY` | Pay per token |
| `mock` | None | Free, offline, deterministic |

> When using the default backend, keep `ANTHROPIC_API_KEY` **unset**. Claude Code prioritizes an API key when one is present and would bill per token instead of using your subscription. spec-drift also strips the key from its own subprocess as a safeguard.

### Models

In the interactive app, **Settings** lets you choose the model: `Auto` (your Claude default), `Haiku` for the fastest first run, `Sonnet` for a balance, or `Opus` for the most thorough analysis. From the command line, use `--model`.

### Options

```
--spec <path>      Spec file. Default: auto-detect AGENTS.md, then CLAUDE.md
--repo <dir>       Repository root to scan. Default: current directory
--backend <name>   claude-code | api | mock. Default: claude-code
--model <id>       Model override. Default: the backend's default
--format <fmt>     terminal | json | markdown. Default: terminal
--embeddings       Enable the optional on-device semantic model (~23MB, downloaded once)
--no-cache         Bypass the on-disk extract and result cache
--fail-on <when>   drift | never. Exit 1 on drift. Default: drift
--interactive      Force the interactive app
--no-interactive   Force one-shot mode
-h, --help         Show help
```

The semantic model is off by default; keyword and file-tree retrieval require no native modules and download nothing.

## Examples

```bash
# Audit the current directory, auto-detecting AGENTS.md or CLAUDE.md
spec-drift

# Point at any repository
spec-drift --repo ~/code/service-api

# Emit JSON for tooling
spec-drift --repo ~/code/service-api --format json

# Write a Markdown report for a pull request
spec-drift --repo ~/code/service-api --format markdown > drift-report.md

# Check a specific document
spec-drift --spec docs/CONVENTIONS.md --repo .
```

Use it as a gate in continuous integration:

```bash
# .git/hooks/pre-commit
spec-drift --fail-on drift || {
  echo "Spec drift detected. Update AGENTS.md or fix the code."
  exit 1
}
```

## Architecture

spec-drift is a small, typed pipeline with a clear separation between orchestration, retrieval, and presentation.

| Module | Responsibility |
| --- | --- |
| `spec.ts` | Extract atomic rules from the spec document |
| `retrieve.ts` | Assemble evidence: keyword search, file-tree manifest, constant tracking, embeddings |
| `check.ts` | Judge each rule against its evidence |
| `run.ts` | The end-to-end pipeline, shared by both entry points |
| `index.ts` | Argument parsing and one-shot mode |
| `interactive.ts`, `prompts.ts` | The guided application and its dependency-free prompt layer |
| `report.ts`, `ui.ts` | Terminal, JSON, and Markdown rendering |
| `cache.ts` | Content-addressed cache, keyed by spec, repository, and prompt version |
| `llm.ts` | Backend clients with retry and tolerant parsing |

Design choices worth noting:

- **Local retrieval, minimal calls.** All evidence is gathered on your machine; only the two model calls leave it. The cache is keyed in part by a hash of the prompts themselves, so results never go stale when the analysis logic changes.
- **Read-only targets.** The scanned repository is never modified. Caches live in your user cache directory, never inside the project under review.
- **Dependency-light by default.** The interactive experience, styling, and prompts are built without third-party UI libraries. The embedding model is the only heavy dependency, and it is optional.

## FAQ

**Do I need an Anthropic API key?**
No. The default `claude-code` backend uses your existing Claude Code login. A key is only needed if you deliberately choose the `api` backend.

**Will it cost me per token?**
Not on the default backend; it runs under your Pro/Max plan at no additional cost. The `api` backend bills per token by design; you would opt into that explicitly.

**Does it send my code anywhere, or write into my repository?**
Retrieval is entirely local and never writes into the scanned repository; caches live in your user cache directory. Only the two model calls leave your machine.

**What does it install?**
Node 18+ and Claude Code. No native modules and no model downloads, unless you opt into `--embeddings`.

**Can I run it offline?**
Use `--mock` for an offline, deterministic run that exercises the full pipeline without the network.

## Roadmap

- [x] Hybrid keyword and semantic retrieval
- [x] File-tree retrieval for naming and placement rules
- [x] Exported-constant value tracking
- [x] Content-addressed caching for instant, free re-runs
- [x] Interactive application and one-shot CLI
- [ ] GitHub Action with inline pull-request annotations
- [ ] Multi-spec monorepo support
- [ ] Drift diffing across commits (`spec-drift --since <ref>`)

## Contributing

Issues and pull requests are welcome.

```bash
npm install
npm run build
node dist/index.js --repo ./fixture --mock
```

The `--mock` backend runs the entire pipeline offline and deterministically, which makes it the fastest way to verify a change end to end. Code is TypeScript in strict mode; please keep new modules small and single-purpose.

## License

[MIT](LICENSE)
