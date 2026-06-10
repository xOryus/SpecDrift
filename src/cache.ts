import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT =
  process.env.SPEC_DRIFT_CACHE_DIR ||
  join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "spec-drift");

export const sha1 = (input: string): string =>
  createHash("sha1").update(input).digest("hex");

export const cacheDir = (...parts: string[]): string => {
  const dir = join(ROOT, ...parts);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

export const readCache = <T>(namespace: string, key: string): T | null => {
  try {
    const file = join(cacheDir(namespace), `${key}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
};

export const writeCache = <T>(namespace: string, key: string, value: T): void => {
  try {
    writeFileSync(join(cacheDir(namespace), `${key}.json`), JSON.stringify(value));
  } catch {
    return;
  }
};
