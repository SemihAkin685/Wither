import { Catalog, parseLang, type UiSource } from "./catalog";
import { isObject, parseUiJson } from "./parse";

/**
 * Vanilla ui files and textures come from Mojang's public bedrock-samples repo.
 * Nothing is bundled, they're downloaded once on request and kept in IndexedDB.
 */
export const VANILLA_VERSION = "v1.26.60.5";
const BASE = `https://raw.githubusercontent.com/Mojang/bedrock-samples/${VANILLA_VERSION}/resource_pack/`;
const CONCURRENCY = 16;

const DB_NAME = "wither-vanilla";
const STORE = "files";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

// a missing cache is never fatal, everything just gets fetched again next time
async function cacheGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function cachePut(key: string, value: unknown) {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    // quota or a closed db, not worth surfacing
  }
}

/**
 * Fetches one file of the vanilla pack. A 404 is cached as null so probing for
 * optional files (texture sidecars, .jpg fallbacks) stays cheap after the first run.
 */
async function fetchVanilla<T extends string | Blob>(path: string, as: "text" | "blob"): Promise<T | null> {
  const key = `${VANILLA_VERSION}/${path}`;
  const cached = await cacheGet<T | null>(key);
  if (cached !== undefined) return cached;
  const response = await fetch(BASE + path);
  if (response.status === 404) {
    void cachePut(key, null);
    return null;
  }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const body = (as === "text" ? await response.text() : await response.blob()) as T;
  void cachePut(key, body);
  return body;
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

let catalogPromise: Promise<Catalog> | null = null;

/** The vanilla ui catalog, loaded once per session. onProgress gets (done, total). */
export function loadVanillaCatalog(onProgress?: (done: number, total: number) => void): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const defsText = await fetchVanilla<string>("ui/_ui_defs.json", "text");
    const defs = defsText ? parseUiJson(defsText) : null;
    const files = isObject(defs) && Array.isArray(defs.ui_defs) ? defs.ui_defs.filter((p) => typeof p === "string") : [];
    const all = ["ui/_global_variables.json", ...(files as string[])];
    let done = 0;
    const sources = await mapLimit(all, CONCURRENCY, async (path): Promise<UiSource | null> => {
      const text = await fetchVanilla<string>(path, "text").catch(() => null);
      onProgress?.(++done, all.length);
      return text === null ? null : { path, text };
    });
    const lang = await fetchVanilla<string>("texts/en_US.lang", "text").catch(() => null);
    return new Catalog(
      sources.filter((s): s is UiSource => s !== null),
      lang ? parseLang(lang) : new Map(),
    );
  })();
  catalogPromise.catch(() => {
    catalogPromise = null;
  });
  return catalogPromise;
}

export interface Texture {
  image: ImageBitmap;
  /** Size the ui math uses, `base_size` from the sidecar or the image itself. */
  base: [number, number];
  nineslice: [number, number, number, number] | null;
}

export function ninesliceOf(value: unknown): [number, number, number, number] | null {
  if (typeof value === "number") return [value, value, value, value];
  if (Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === "number")) {
    return value as [number, number, number, number];
  }
  return null;
}

async function loadTexture(path: string): Promise<Texture | null> {
  const clean = path.replace(/\.(png|jpg|jpeg|tga)$/i, "");
  const blob =
    (await fetchVanilla<Blob>(`${clean}.png`, "blob")) ?? (await fetchVanilla<Blob>(`${clean}.jpg`, "blob"));
  if (!blob) return null;
  const image = await createImageBitmap(blob);
  const sidecarText = await fetchVanilla<string>(`${clean}.json`, "text").catch(() => null);
  let sidecar = null;
  try {
    sidecar = sidecarText ? parseUiJson(sidecarText) : null;
  } catch {
    sidecar = null;
  }
  const meta = isObject(sidecar) ? sidecar : {};
  const base = Array.isArray(meta.base_size) && meta.base_size.length === 2 ? meta.base_size : null;
  return {
    image,
    base: base ? [Number(base[0]) || image.width, Number(base[1]) || image.height] : [image.width, image.height],
    nineslice: ninesliceOf(meta.nineslice_size),
  };
}

/**
 * Textures by path. get() answers synchronously so painting never waits:
 * undefined while loading, null when vanilla has no such texture.
 */
export class TextureStore {
  private readonly entries = new Map<string, Texture | null>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();

  get(path: string): Texture | null | undefined {
    if (this.entries.has(path)) return this.entries.get(path);
    if (!this.pending.has(path)) {
      this.pending.add(path);
      loadTexture(path)
        .catch(() => null)
        .then((texture) => {
          this.pending.delete(path);
          this.entries.set(path, texture);
          this.listeners.forEach((listener) => listener());
        });
    }
    return undefined;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const vanillaTextures = new TextureStore();
