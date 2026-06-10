import {
  Evidence,
  HardcodedConstant,
  RuleWithEvidence,
  SpecRule,
} from "./types.js";
import { FileEntry, loadFiles, buildManifest } from "./files.js";
import { Embedder, embedRetrieve } from "./embed.js";
import { createHash } from "node:crypto";

const CONTEXT_LINES = 3;
const MAX_SNIPPETS_PER_RULE = 12;
const MAX_SNIPPETS_PER_FILE = 2;
const ENTRY_CHARS = 6000;
const MAX_CONST_USES = 15;
const ENTRY_RE = /(^|\/)(app|main|index|router|routes)\.[jt]sx?$|\.config\.[jt]s$/i;
const CONST_RE = /export\s+const\s+([A-Z][A-Z0-9_]{2,})\s*=\s*["']([^"']{6,})["']/g;

const normRel = (rel: string): string => rel.split("\\").join("/");
const isEntry = (rel: string): boolean => ENTRY_RE.test(normRel(rel));

const snippetAround = (entry: FileEntry, lineIdx: number): Evidence => {
  const start = Math.max(0, lineIdx - CONTEXT_LINES);
  const end = Math.min(entry.lines.length, lineIdx + CONTEXT_LINES + 1);
  return {
    file: normRel(entry.rel),
    line: lineIdx + 1,
    snippet: entry.lines.slice(start, end).join("\n"),
  };
};

const wholeFile = (entry: FileEntry): Evidence => ({
  file: normRel(entry.rel),
  line: 1,
  snippet: entry.content.slice(0, ENTRY_CHARS),
});

const keywordEvidence = (rule: SpecRule, files: FileEntry[]): Evidence[] => {
  const found: Evidence[] = [];
  const seen = new Set<string>();
  const terms = rule.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (!terms.length) return found;

  for (const entry of files) {
    if (!terms.some((t) => entry.lower.includes(t))) continue;

    if (isEntry(entry.rel)) {
      const key = `${entry.rel}:whole`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(wholeFile(entry));
      }
      if (found.length >= MAX_SNIPPETS_PER_RULE) break;
      continue;
    }

    let perFile = 0;
    for (let i = 0; i < entry.lines.length; i++) {
      if (terms.some((t) => entry.lines[i].toLowerCase().includes(t))) {
        const key = `${entry.rel}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(snippetAround(entry, i));
        if (++perFile >= MAX_SNIPPETS_PER_FILE) break;
      }
    }
    if (found.length >= MAX_SNIPPETS_PER_RULE) break;
  }
  return found;
};

const keywordCoverage = (rule: SpecRule, files: FileEntry[]): string[] => {
  const terms = rule.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (!terms.length) return [];
  return files
    .filter((e) => terms.some((t) => e.lower.includes(t)))
    .map((e) => normRel(e.rel))
    .sort();
};

const mergeEvidence = (...lists: Evidence[][]): Evidence[] => {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const list of lists) {
    for (const e of list) {
      const key = `${e.file}:${e.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.slice(0, MAX_SNIPPETS_PER_RULE + 4);
};

interface ConstDef {
  name: string;
  value: string;
  lower: string;
  defFile: string;
}

const scanConstants = (files: FileEntry[]): HardcodedConstant[] => {
  const defs: ConstDef[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    CONST_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CONST_RE.exec(f.content))) {
      const [, name, value] = m;
      if (seen.has(value)) continue;
      seen.add(value);
      defs.push({ name, value, lower: value.toLowerCase(), defFile: normRel(f.rel) });
    }
  }
  if (!defs.length) return [];

  const uses = new Map<string, { file: string; line: number }[]>();
  for (const f of files) {
    const rel = normRel(f.rel);
    const candidates = defs.filter((d) => d.defFile !== rel && f.lower.includes(d.lower));
    if (!candidates.length) continue;
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      for (const d of candidates) {
        const list = uses.get(d.value);
        if ((list?.length ?? 0) >= MAX_CONST_USES) continue;
        if (line.includes(d.value)) {
          const arr = list ?? uses.set(d.value, []).get(d.value)!;
          arr.push({ file: rel, line: i + 1 });
        }
      }
    }
  }

  return defs
    .filter((d) => uses.has(d.value))
    .map((d) => ({ name: d.name, value: d.value, defFile: d.defFile, uses: uses.get(d.value)! }));
};

const computeRepoHash = (files: FileEntry[]): string => {
  const h = createHash("sha1");
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    h.update(normRel(f.rel));
    h.update(" ");
    h.update(f.content);
    h.update("\n");
  }
  return h.digest("hex");
};

export interface RetrieveOptions {
  embedder?: Embedder | null;
}

export interface RetrieveOutput {
  rules: RuleWithEvidence[];
  manifest: string;
  hardcodedConstants: HardcodedConstant[];
  repoHash: string;
}

export const retrieveEvidence = async (
  repoRoot: string,
  rules: SpecRule[],
  opts: RetrieveOptions = {}
): Promise<RetrieveOutput> => {
  const files = loadFiles(repoRoot);
  const manifest = buildManifest(files);
  const hardcodedConstants = scanConstants(files);

  const keyword = new Map<string, Evidence[]>();
  const coverage = new Map<string, string[]>();
  for (const rule of rules) {
    keyword.set(rule.id, keywordEvidence(rule, files));
    coverage.set(rule.id, keywordCoverage(rule, files));
  }

  let semantic = new Map<string, Evidence[]>();
  if (opts.embedder) {
    semantic = await embedRetrieve(repoRoot, files, rules, opts.embedder);
  }

  const withEvidence = rules.map((rule) => ({
    ...rule,
    evidence: mergeEvidence(keyword.get(rule.id) ?? [], semantic.get(rule.id) ?? []),
    coverageFiles: coverage.get(rule.id) ?? [],
  }));

  return {
    rules: withEvidence,
    manifest,
    hardcodedConstants,
    repoHash: computeRepoHash(files),
  };
};
