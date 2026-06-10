const BRAND = "38;2;255;87;34";
const TEAL = "38;2;118;171;174";
const LIGHT = "38;2;245;245;245";

const supports = (stream: NodeJS.WriteStream): boolean =>
  !!stream.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const colorOut = supports(process.stdout);
const colorErr = supports(process.stderr);

const wrap = (code: string, s: string, on: boolean): string =>
  on ? `\x1b[${code}m${s}\x1b[0m` : s;

const makeStyle = (on: boolean) => ({
  bold: (s: string) => wrap("1", s, on),
  dim: (s: string) => wrap("2", s, on),
  orange: (s: string) => wrap(BRAND, s, on),
  brand: (s: string) => wrap(BRAND, s, on),
  teal: (s: string) => wrap(TEAL, s, on),
  light: (s: string) => wrap(LIGHT, s, on),
  green: (s: string) => wrap(TEAL, s, on),
  red: (s: string) => wrap(BRAND, s, on),
  yellow: (s: string) => wrap(LIGHT, s, on),
  cyan: (s: string) => wrap(TEAL, s, on),
  gray: (s: string) => wrap("90", s, on),
});

export type Style = ReturnType<typeof makeStyle>;
export const out: Style = makeStyle(colorOut);
export const err: Style = makeStyle(colorErr);

export const visibleLen = (s: string): number =>
  s.replace(/\x1b\[[0-9;]*m/g, "").length;

export const box = (s: Style, lines: string[]): string => {
  const width = Math.max(...lines.map(visibleLen));
  const bar = "─".repeat(width + 2);
  const top = s.orange(`╭${bar}╮`);
  const bottom = s.orange(`╰${bar}╯`);
  const body = lines.map(
    (l) => `${s.orange("│")} ${l}${" ".repeat(width - visibleLen(l))} ${s.orange("│")}`
  );
  return [top, ...body, bottom].join("\n");
};

const BIG = [
  "███████╗██████╗ ███████╗ ██████╗",
  "██╔════╝██╔══██╗██╔════╝██╔════╝",
  "███████╗██████╔╝█████╗  ██║     ",
  "╚════██║██╔═══╝ ██╔══╝  ██║     ",
  "███████║██║     ███████╗╚██████╗",
  "╚══════╝╚═╝     ╚══════╝ ╚═════╝",
  "██████╗ ██████╗ ██╗███████╗████████╗",
  "██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝",
  "██║  ██║██████╔╝██║█████╗     ██║   ",
  "██║  ██║██╔══██╗██║██╔══╝     ██║   ",
  "██████╔╝██║  ██║██║██║        ██║   ",
  "╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ",
];

export const banner = (s: Style, columns = 80): string =>
  (columns || 80) < 38
    ? s.orange(s.bold("◆ spec-drift"))
    : s.orange(BIG.map((l) => ` ${l}`).join("\n"));

export const intro = (columns = 80): string =>
  [
    "",
    banner(err, columns),
    err.dim("  semantic drift between your AGENTS.md and your code"),
    "",
    box(err, [
      `${err.orange("✳")}  ${err.bold("spec-drift")} ${err.dim("· runs on your Claude Code")}`,
      err.dim("no API key · no external account · no extra cost"),
    ]),
    "",
  ].join("\n");

export const statusLabel = (s: Style, status: string): string => {
  if (status === "drift") return s.red(s.bold("✗ DRIFT  "));
  if (status === "aligned") return s.green("✓ ALIGNED");
  return s.yellow("? UNKNOWN");
};

export const scoreboard = (
  s: Style,
  drift: number,
  unknown: number,
  aligned: number
): string => {
  const seg = (n: number, label: string, paint: (x: string) => string): string =>
    n ? `${paint("█".repeat(Math.min(n, 24)))} ${s.bold(String(n))} ${s.dim(label)}` : "";
  return [seg(drift, "drift", s.red), seg(unknown, "unknown", s.yellow), seg(aligned, "aligned", s.green)]
    .filter((x) => x.trim().length)
    .join("   ");
};

export const wrapText = (text: string, maxWidth: number, indent = ""): string[] => {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = indent;
  for (const w of words) {
    if (cur !== indent && cur.length + 1 + w.length > maxWidth) {
      lines.push(cur);
      cur = indent + w;
    } else {
      cur = cur === indent ? indent + w : `${cur} ${w}`;
    }
  }
  if (cur !== indent) lines.push(cur);
  return lines;
};

export interface Spinner {
  start(text: string): void;
  succeed(text: string): void;
  stop(): void;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const createSpinner = (s: Style): Spinner => {
  const tty = !!process.stderr.isTTY && !process.env.NO_COLOR;
  let timer: ReturnType<typeof setInterval> | null = null;
  let label = "";
  let started = 0;
  let frame = 0;
  const draw = (): void => {
    const secs = Math.round((Date.now() - started) / 1000);
    process.stderr.write(`\r\x1b[K${s.orange(FRAMES[frame])} ${label} ${s.gray(`${secs}s`)}`);
    frame = (frame + 1) % FRAMES.length;
  };
  return {
    start(text: string) {
      label = text;
      started = Date.now();
      frame = 0;
      if (tty) {
        process.stderr.write("\x1b[?25l");
        draw();
        timer = setInterval(draw, 90);
      } else {
        process.stderr.write(`${s.gray("·")} ${text}...\n`);
      }
    },
    succeed(text: string) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (tty) process.stderr.write(`\r\x1b[K${s.green("✓")} ${text}\n\x1b[?25h`);
      else process.stderr.write(`${s.green("✓")} ${text}\n`);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (tty) process.stderr.write("\r\x1b[K\x1b[?25h");
    },
  };
};
