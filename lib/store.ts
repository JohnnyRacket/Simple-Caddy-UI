import { randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";

/** Where tokens, proposals and history live. Owned by the app user. */
export const DATA_DIR = process.env.CADDY_UI_DATA_DIR ?? "/var/lib/caddy-ui";

export function dataPath(...parts: string[]): string {
  return path.join(/*turbopackIgnore: true*/ DATA_DIR, ...parts);
}

let lastStamp = "";
let seq = 0;

/** Sortable ids: prefix_<UTC time to the ms><sequence>_<random>, so file order is creation order. */
export function newId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:.Z]/g, "");
  seq = stamp === lastStamp ? seq + 1 : 0;
  lastStamp = stamp;
  return `${prefix}_${stamp}${String(seq).padStart(3, "0")}_${randomBytes(4).toString("hex")}`;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

/** Write via temp file + rename, so readers never see a half-written file. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export const writeJson = (file: string, value: unknown) => writeFileAtomic(file, JSON.stringify(value, null, 2));

// Next can bundle a module into several route chunks; keep process-wide state on globalThis
const g = globalThis as typeof globalThis & { __caddyUiLocks?: Map<string, Promise<unknown>> };
const locks = (g.__caddyUiLocks ??= new Map());

/** Run fn with an in-process lock held for `name`; callers queue in order. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => next);
  locks.set(name, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(name) === chained) locks.delete(name);
  }
}
