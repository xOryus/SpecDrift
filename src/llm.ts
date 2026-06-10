// Thin wrapper around the Anthropic SDK with a deterministic mock mode
// (so the whole pipeline can run/test without an API key) and per-call
// token + cost accounting.
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Per-MTok pricing (USD). claude-haiku-4-5 = $1 in / $5 out.
// Source: Anthropic pricing, verified 2026-06.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
};

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = PRICING[model] ?? PRICING["claude-haiku-4-5"];
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 600
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}

export interface LlmClient {
  complete(args: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<LlmResult>;
}

/** Real Anthropic-backed client. */
export class AnthropicClient implements LlmClient {
  private client: Anthropic;
  constructor(private model: string, apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete({
    system,
    user,
    maxTokens = 2048,
  }: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<LlmResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }
}

/**
 * Backend that shells out to the Claude Code CLI in headless mode
 * (`claude -p`). This lets Pro/Max subscribers run spec-drift WITHOUT an
 * API key — the call is covered by the subscription via OAuth.
 *
 * Safety: it runs `claude` in a fresh temp directory so the target repo's
 * own CLAUDE.md / AGENTS.md is NOT auto-loaded as the agent's instructions
 * (which would contaminate extraction/checking). The model id is validated
 * before it reaches a shell, and tools are disabled on the binary path.
 */
export class ClaudeCodeClient implements LlmClient {
  constructor(private model?: string) {}

  complete({
    system,
    user,
  }: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<LlmResult> {
    const prompt = `${system}\n\n${user}`;
    const cwd = mkdtempSync(join(tmpdir(), "spec-drift-"));
    const safeModel =
      this.model && /^[A-Za-z0-9._-]+$/.test(this.model) ? this.model : "";
    const args = ["-p", "--output-format", "json"];
    if (safeModel) args.push("--model", safeModel);

    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;

      const execPath = process.env.CLAUDE_CODE_EXECPATH;
      const child = execPath
        ? spawn(execPath, [...args, "--allowedTools", ""], { cwd, env })
        : spawn(["claude", ...args].join(" "), { cwd, env, shell: true });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("error", (e) =>
        reject(
          new Error(
            `could not run 'claude'. Is Claude Code installed and on PATH? (${e.message})`
          )
        )
      );
      child.on("close", (code) => {
        if (code !== 0) {
          return reject(
            new Error(`claude exited ${code}: ${err.slice(0, 400)}`)
          );
        }
        try {
          const envelope = JSON.parse(out);
          resolve({
            text: envelope.result ?? "",
            inputTokens: envelope.usage?.input_tokens ?? 0,
            outputTokens: envelope.usage?.output_tokens ?? 0,
          });
        } catch (e) {
          reject(
            new Error(`could not parse claude output: ${out.slice(0, 400)}`)
          );
        }
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

/**
 * Deterministic mock used by `--mock`. It does not call the network; it
 * returns canned-but-plausible JSON so the pipeline, retrieval and report
 * rendering can be validated end to end.
 */
export class MockClient implements LlmClient {
  async complete({ user }: { system: string; user: string }): Promise<LlmResult> {
    const inputTokens = Math.ceil(user.length / 4);
    let text = "[]";

    if (user.includes("EXTRACT_RULES")) {
      text = JSON.stringify([
        {
          id: "R1",
          rule: "All API route handlers must require authentication.",
          source: "## Security",
          keywords: ["route", "auth", "app.get", "app.post", "router"],
        },
        {
          id: "R2",
          rule: "Use snake_case for database column names.",
          source: "## Database conventions",
          keywords: ["column", "snake_case", "schema", "createTable"],
        },
        {
          id: "R3",
          rule: "Never log secrets or API keys.",
          source: "## Logging",
          keywords: ["console.log", "logger", "apiKey", "secret", "token"],
        },
      ]);
    } else if (user.includes("CHECK_DRIFT")) {
      // Mock verdicts keyed off whatever evidence happens to be present.
      const hasPublicRoute = user.includes("// public");
      text = JSON.stringify([
        {
          id: "R1",
          rule: "All API route handlers must require authentication.",
          source: "## Security",
          status: hasPublicRoute ? "drift" : "aligned",
          explanation: hasPublicRoute
            ? "Found a route handler marked '// public' with no auth middleware, contradicting the spec."
            : "Sampled route handlers attach an auth middleware.",
          references: ["src/routes/users.ts"],
          confidence: 78,
        },
        {
          id: "R2",
          rule: "Use snake_case for database column names.",
          source: "## Database conventions",
          status: "drift",
          explanation:
            "Schema defines camelCase columns (createdAt), contradicting the snake_case rule.",
          references: ["src/db/schema.ts"],
          confidence: 71,
        },
        {
          id: "R3",
          rule: "Never log secrets or API keys.",
          source: "## Logging",
          status: "unknown",
          explanation:
            "No logging of secret-like values found in the retrieved snippets; insufficient evidence to confirm full compliance.",
          references: [],
          confidence: 40,
        },
      ]);
    }

    return {
      text,
      inputTokens,
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}

/** Strip ```json fences and parse, tolerating preamble. */
export function parseJsonArray<T>(raw: string): T[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error(`LLM did not return a JSON array. Got: ${cleaned.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T[];
}
