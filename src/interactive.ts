import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { intro, out as S } from "./ui.js";
import { text, select, confirm, note, outro, heading, clear, pause } from "./prompts.js";
import { autoDetectSpec, runCheck, Backend } from "./run.js";
import { renderTerminal, renderMarkdown } from "./report.js";
import { RunResult } from "./types.js";

interface Settings {
  backend: Backend;
  model: string;
  embeddings: boolean;
  cache: boolean;
}

const MODELS = ["", "claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"];

const modelShort = (m: string): string =>
  !m
    ? "auto"
    : m.includes("haiku")
    ? "haiku"
    : m.includes("sonnet")
    ? "sonnet"
    : m.includes("opus")
    ? "opus"
    : m;

const shortRepo = (p: string): string =>
  p.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/") || p;

const relSpec = (repo: string, spec: string): string =>
  spec.replace(repo, ".").replace(/\\/g, "/");

const compactHeader = (): string =>
  `${S.brand("◆")} ${S.bold("spec-drift")} ${S.dim("· semantic drift detector")}`;

const screen = (full: boolean): void => {
  clear();
  process.stdout.write(`\n${full ? intro(process.stdout.columns) : compactHeader()}\n\n`);
};

const askRepo = async (current: string): Promise<string> => {
  while (true) {
    const input = await text("Which repository should I check?", { default: current });
    const repo = resolve(input);
    const spec = autoDetectSpec(repo);
    if (spec) {
      note(`${S.green("✓")} found ${S.bold(relSpec(repo, spec))}`);
      return repo;
    }
    note(`${S.red("✗")} no AGENTS.md / CLAUDE.md under ${S.bold(repo)}`);
    if (!(await confirm("Try a different path?", true))) return current;
  }
};

const askSettings = async (cur: Settings): Promise<Settings> => {
  const backends: Backend[] = ["claude-code", "api", "mock"];
  const backend = await select<Backend>(
    "How should spec-drift run?",
    [
      { label: "My Claude subscription", value: "claude-code", hint: "no API key, no extra cost" },
      { label: "Anthropic API key", value: "api", hint: "pay per token" },
      { label: "Demo / offline", value: "mock", hint: "fake data, no network" },
    ],
    backends.indexOf(cur.backend)
  );
  const model = await select<string>(
    "Which model?",
    [
      { label: "Auto", value: "", hint: "your Claude default" },
      { label: "Fast — Haiku", value: "claude-haiku-4-5", hint: "quickest first run" },
      { label: "Balanced — Sonnet", value: "claude-sonnet-4-6", hint: "good speed + quality" },
      { label: "Deep — Opus", value: "claude-opus-4-8", hint: "most thorough analysis" },
    ],
    Math.max(0, MODELS.indexOf(cur.model))
  );
  const embeddings = await confirm(
    "Use local semantic embeddings? (downloads ~23MB once)",
    cur.embeddings
  );
  const cache = await confirm("Cache results on disk (instant re-runs)?", cur.cache);
  return { backend, model, embeddings, cache };
};

const saveReport = (result: RunResult): string => {
  const file = join(process.cwd(), "spec-drift-report.md");
  writeFileSync(file, renderMarkdown(result) + "\n");
  return file;
};

const HELP_TEXT = [
  "",
  S.bold("  spec-drift compares your AGENTS.md / CLAUDE.md to your real code."),
  S.dim("  It extracts rules from the doc, finds the matching code, and reports"),
  S.dim("  which rules the code now contradicts (drift), follows (aligned), or"),
  S.dim("  can't be verified (unknown)."),
  "",
  S.dim("  · Run a drift check  — pick a repo and go. No flags, no API key."),
  S.dim("  · Change repository  — point it at any folder with a spec file."),
  S.dim("  · Settings           — backend, embeddings, caching."),
  "",
].join("\n");

export const runInteractive = async (): Promise<number> => {
  let repo = process.cwd();
  let settings: Settings = { backend: "claude-code", model: "", embeddings: false, cache: true };
  let lastDrift = false;
  let first = true;

  while (true) {
    screen(first);
    first = false;
    const spec = autoDetectSpec(repo);
    const action = await select<string>(`spec-drift · ${shortRepo(repo)}`, [
      {
        label: "Run a drift check",
        value: "run",
        hint: spec ? "compare your spec to your code" : "no spec here — change repo first",
      },
      { label: "Change repository", value: "repo", hint: shortRepo(repo) },
      {
        label: "Settings",
        value: "settings",
        hint: `${settings.backend} · ${modelShort(settings.model)} · ${settings.embeddings ? "embeddings" : "keyword"} · ${settings.cache ? "cache on" : "cache off"}`,
      },
      { label: "Help", value: "help" },
      { label: "Exit", value: "exit" },
    ]);

    if (action === "exit") {
      outro("done — keep your spec and code in sync");
      return lastDrift ? 1 : 0;
    }
    if (action === "help") {
      process.stdout.write(HELP_TEXT + "\n");
      continue;
    }
    if (action === "repo") {
      repo = await askRepo(repo);
      continue;
    }
    if (action === "settings") {
      settings = await askSettings(settings);
      continue;
    }

    if (!autoDetectSpec(repo)) {
      note(`${S.red("✗")} no spec file here. Use “Change repository” first.`);
      continue;
    }
    if (settings.backend === "api" && !process.env.ANTHROPIC_API_KEY) {
      note(`${S.red("✗")} the API backend needs ANTHROPIC_API_KEY. Switch to “My Claude subscription” in Settings.`);
      await pause("Press Enter to go back");
      continue;
    }

    let rerun = true;
    while (rerun) {
      rerun = false;
      screen(false);
      heading("Checking for drift");
      try {
        const result = await runCheck({
          repo,
          model: settings.model,
          backend: settings.backend,
          embeddings: settings.embeddings,
          cache: settings.cache,
        });
        process.stdout.write(renderTerminal(result));
        lastDrift = result.findings.some((f) => f.status === "drift");

        const next = await select<string>("What next?", [
          { label: "Run again", value: "again", hint: "re-check after editing code" },
          { label: "Save markdown report", value: "save" },
          { label: "Change repository", value: "repo" },
          { label: "Back to menu", value: "menu" },
          { label: "Exit", value: "exit" },
        ]);

        if (next === "again") rerun = true;
        else if (next === "save") {
          note(`${S.green("✓")} saved ${S.bold(saveReport(result))}`);
          await pause();
          rerun = true;
        } else if (next === "repo") repo = await askRepo(repo);
        else if (next === "exit") {
          outro("done");
          return lastDrift ? 1 : 0;
        }
      } catch (e) {
        note(`${S.red("✗")} ${(e as Error).message}`);
        await pause("Press Enter to go back to the menu");
      }
    }
  }
};
