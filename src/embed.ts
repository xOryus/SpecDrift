// Local, key-free semantic retrieval using a small embedding model
// (Xenova/all-MiniLM-L6-v2) via @huggingface/transformers. Runs fully on
// CPU, downloads the model once (~23MB) then works offline. Degrades
// gracefully: if the model can't load, loadEmbedder() returns null and the
// caller falls back to keyword retrieval.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Evidence, SpecRule } from "./types.js";
import { FileEntry } from "./files.js";
import { cacheDir, sha1 } from "./cache.js";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const WINDOW_LINES = 40;
const OVERLAP_LINES = 10;
const TOP_K = 5;

export interface Chunk {
  file: string;
  startLine: number;
  text: string;
}

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Split files into overlapping line-windows for embedding. */
export function chunkFiles(files: FileEntry[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const f of files) {
    const step = WINDOW_LINES - OVERLAP_LINES;
    for (let i = 0; i < f.lines.length; i += step) {
      const slice = f.lines.slice(i, i + WINDOW_LINES);
      const text = slice.join("\n").trim();
      if (text.length < 10) continue;
      chunks.push({ file: f.rel, startLine: i + 1, text });
      if (i + WINDOW_LINES >= f.lines.length) break;
    }
  }
  return chunks;
}

/** Dot product of two L2-normalized vectors == cosine similarity. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Indices of the top-k most similar chunk vectors to a query vector. */
export function topK(
  query: Float32Array,
  chunkVecs: Float32Array[],
  k: number
): number[] {
  return chunkVecs
    .map((v, i) => ({ i, score: cosine(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i);
}

/** Lazy-loads the transformers.js pipeline; returns null on any failure. */
export async function loadEmbedder(): Promise<Embedder | null> {
  try {
    // @ts-ignore - optional dependency, resolved at runtime; build must not require it
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline("feature-extraction", MODEL);
    return {
      async embed(texts: string[]): Promise<Float32Array[]> {
        const out: Float32Array[] = [];
        for (const t of texts) {
          const res: any = await extractor(t, {
            pooling: "mean",
            normalize: true,
          });
          out.push(Float32Array.from(res.data as Float32Array));
        }
        return out;
      },
    };
  } catch (err) {
    process.stderr.write(
      `spec-drift: embedding model unavailable, falling back to keyword retrieval (${
        (err as Error)?.message ?? err
      })\n`
    );
    return null;
  }
}

/** Disk-cached chunk embeddings keyed by chunk-text hash. */
class EmbeddingCache {
  private file: string;
  private map: Record<string, number[]> = {};
  constructor(repoRoot: string) {
    this.file = join(cacheDir("embeddings"), `${sha1(repoRoot)}.json`);
    if (existsSync(this.file)) {
      try {
        this.map = JSON.parse(readFileSync(this.file, "utf8"));
      } catch {
        this.map = {};
      }
    }
  }
  key(text: string): string {
    return createHash("sha1").update(text).digest("hex");
  }
  get(text: string): Float32Array | undefined {
    const v = this.map[this.key(text)];
    return v ? Float32Array.from(v) : undefined;
  }
  set(text: string, vec: Float32Array): void {
    this.map[this.key(text)] = Array.from(vec);
  }
  flush(): void {
    writeFileSync(this.file, JSON.stringify(this.map));
  }
}

/**
 * Embed all chunks (using cache), then for each rule return the top-K most
 * semantically similar chunks as evidence.
 */
export async function embedRetrieve(
  repoRoot: string,
  files: FileEntry[],
  rules: SpecRule[],
  embedder: Embedder
): Promise<Map<string, Evidence[]>> {
  const chunks = chunkFiles(files);
  const cache = new EmbeddingCache(repoRoot);

  // Embed chunks (only the ones not already cached).
  const missing = chunks.filter((c) => !cache.get(c.text));
  if (missing.length) {
    const vecs = await embedder.embed(missing.map((c) => c.text));
    missing.forEach((c, i) => cache.set(c.text, vecs[i]));
    cache.flush();
  }
  const chunkVecs = chunks.map((c) => cache.get(c.text)!);

  // Embed rules and rank chunks per rule.
  const ruleVecs = await embedder.embed(
    rules.map((r) => `${r.rule} ${r.keywords.join(" ")}`)
  );

  const result = new Map<string, Evidence[]>();
  rules.forEach((rule, ri) => {
    const idxs = topK(ruleVecs[ri], chunkVecs, TOP_K);
    result.set(
      rule.id,
      idxs.map((i) => ({
        file: chunks[i].file,
        line: chunks[i].startLine,
        snippet: chunks[i].text.slice(0, 600),
      }))
    );
  });
  return result;
}
