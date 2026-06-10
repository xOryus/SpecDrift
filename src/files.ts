// Shared repo file loading, used by both keyword and embedding retrieval.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "vendor", "__pycache__", ".venv", "venv", ".cache", "target", ".spec-drift",
]);

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
  ".java", ".rb", ".php", ".cs", ".sql", ".yaml", ".yml", ".json",
  ".sh", ".vue", ".svelte",
]);

const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 4000;

export interface FileEntry {
  path: string;
  rel: string;
  lines: string[];
  content: string;
  lower: string;
}

function walk(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".env.example") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) stack.push(full);
      } else if (CODE_EXTS.has(extname(name)) && st.size <= MAX_FILE_BYTES) {
        out.push(full);
      }
    }
  }
  return out;
}

export function loadFiles(root: string): FileEntry[] {
  return walk(root).map((path) => {
    const content = readFileSync(path, "utf8");
    return {
      path,
      rel: relative(root, path),
      lines: content.split("\n"),
      content,
      lower: content.toLowerCase(),
    };
  });
}

/**
 * A flat, sorted manifest of every source file path under the repo
 * (forward-slash normalized). This is structural evidence for file-naming
 * and file-location rules that content-grep retrieval is blind to.
 */
export function buildManifest(files: FileEntry[]): string {
  return files
    .map((f) => f.rel.split("\\").join("/"))
    .sort()
    .join("\n");
}
