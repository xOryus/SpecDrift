import * as readline from "node:readline";
import { out as S } from "./ui.js";

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

const writeOut = (s: string): void => {
  process.stdout.write(s);
};

let restoreInstalled = false;
const installRestore = (): void => {
  if (restoreInstalled) return;
  restoreInstalled = true;
  const restore = (): void => {
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      restoreInstalled = true;
    }
    writeOut("\x1b[?25h");
  };
  process.on("exit", restore);
  process.on("SIGINT", () => {
    restore();
    writeOut("\n");
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restore();
    process.exit(143);
  });
};

export const clear = (): void => writeOut("\x1b[2J\x1b[3J\x1b[H");
export const note = (msg: string): void => writeOut(`  ${msg}\n`);
export const outro = (msg: string): void => writeOut(`\n${S.brand("◆")} ${msg}\n\n`);
export const heading = (msg: string): void => writeOut(`\n${S.brand("▸")} ${S.bold(msg)}\n`);

const ask = (query: string): Promise<string> =>
  new Promise((resolve) => {
    installRestore();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("SIGINT", () => {
      rl.close();
      writeOut("\n");
      process.exit(130);
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });

export const text = async (
  message: string,
  opts: { default?: string } = {}
): Promise<string> => {
  const def = opts.default ? S.dim(` (${opts.default})`) : "";
  const answer = await ask(`${S.brand("?")} ${S.bold(message)}${def} `);
  return answer.trim() || opts.default || "";
};

export const confirm = async (message: string, def = true): Promise<boolean> => {
  const hint = def ? "Y/n" : "y/N";
  const answer = (await ask(`${S.brand("?")} ${S.bold(message)} ${S.dim(`(${hint})`)} `))
    .trim()
    .toLowerCase();
  return answer === "" ? def : answer.startsWith("y");
};

export const pause = async (msg = "Press Enter to continue"): Promise<void> => {
  await ask(`\n${S.dim(msg)} `);
};

export const select = <T>(
  message: string,
  choices: Choice<T>[],
  initial = 0
): Promise<T> =>
  new Promise((resolve) => {
    installRestore();
    const stdin = process.stdin;
    let index = Math.max(0, Math.min(initial, choices.length - 1));
    let ready = false;
    const wasRaw = !!stdin.isRaw;

    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    writeOut("\x1b[?25l");

    const render = (first: boolean): void => {
      if (!first) writeOut(`\x1b[${choices.length + 1}A`);
      writeOut("\x1b[J");
      writeOut(`${S.brand("?")} ${S.bold(message)}\n`);
      choices.forEach((c, i) => {
        const active = i === index;
        const pointer = active ? S.brand("❯") : " ";
        const label = active ? S.brand(c.label) : c.label;
        const hint = active && c.hint ? S.dim(`  — ${c.hint}`) : "";
        writeOut(`${pointer} ${label}${hint}\n`);
      });
    };

    const cleanup = (): void => {
      stdin.off("keypress", onKey);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      writeOut("\x1b[?25h");
    };

    const onKey = (_s: string, key: readline.Key): void => {
      if (!ready || !key) return;
      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + choices.length) % choices.length;
        render(false);
      } else if (key.name === "down" || key.name === "j") {
        index = (index + 1) % choices.length;
        render(false);
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(choices[index].value);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        writeOut("\n");
        process.exit(130);
      }
    };

    stdin.on("keypress", onKey);
    render(true);
    setTimeout(() => {
      ready = true;
    }, 60);
  });
