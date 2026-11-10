import { Capacitor } from "@capacitor/core";

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };
// serving: one serving as the label prints it (e.g. "1 container (150 g)"), plus its weight or volume.
export type Serving = { amount: number; unit: string; label: string };
export type Food = { id: string; name: string; brand?: string; per100g: Macros; serving?: Serving };

type OFFProduct = {
  code?: string;
  product_name?: string;
  brands?: string | string[];
  nutriments?: Record<string, number | string | undefined>;
};

type OFFServing = { code: string; serving_size?: string; serving_quantity?: number | string; serving_quantity_unit?: string };

// In the iOS app, requests go straight to Open Food Facts through native networking (see capacitor.config.ts);
// in a browser they go through the dev server's proxy in vite.config.ts.
const native = Capacitor.isNativePlatform();
const SEARCH_URL = native ? "https://search.openfoodfacts.org/search" : "/api/off/search";
const PRODUCTS_URL = native ? "https://world.openfoodfacts.org/api/v2/search" : "/api/products";
const BARCODE_URL = native ? "https://world.openfoodfacts.org/api/v2/product" : "/api/barcode";
// Open Food Facts asks apps to identify themselves; the proxy adds this header in the browser.
const HEADERS: HeadersInit | undefined = native ? { "User-Agent": "xochiwell/0.1 (food log)" } : undefined;

const num = (v: unknown) => Math.round((typeof v === "number" ? v : Number(v) || 0) * 10) / 10;

// Products without a name or calories can't be logged, so they're left out.
function toFood(p: OFFProduct): Food | null {
  if (!p.product_name || p.nutriments?.["energy-kcal_100g"] == null) return null;
  return {
    id: p.code ?? p.product_name,
    name: p.product_name,
    brand: Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(",")[0],
    per100g: {
      kcal: num(p.nutriments["energy-kcal_100g"]),
      protein: num(p.nutriments["proteins_100g"]),
      carbs: num(p.nutriments["carbohydrates_100g"]),
      fat: num(p.nutriments["fat_100g"]),
    },
  };
}

const toServing = (p: OFFServing): Serving | null => {
  const amount = Math.round(Number(p.serving_quantity) || 0);
  return amount > 0 ? { amount, unit: p.serving_quantity_unit || "g", label: p.serving_size || `${amount} g` } : null;
};

// What a barcode lookup found: the food, a product with no nutrition facts listed, or nothing.
export type BarcodeResult = { food: Food } | { missing: "nutrition" | "product" };

// Looks up a scanned barcode (the number under it) in Open Food Facts. US labels print 12 digits (UPC-A)
// where the database may store 13 (EAN-13, a leading 0), so both are tried.
export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<BarcodeResult> {
  const fields = "code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit";
  const tries = code.length === 12 ? [code, `0${code}`] : [code];
  let named = false;
  for (const c of tries) {
    const res = await fetch(`${BARCODE_URL}/${c}?fields=${fields}`, { signal, headers: HEADERS });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Barcode lookup failed (${res.status})`);
    const data = (await res.json()) as { status?: number; product?: OFFProduct & OFFServing };
    if (!data.product || data.status === 0) continue;
    const food = toFood({ ...data.product, code: data.product.code ?? c });
    if (!food) { named = true; continue; }
    return { food: { ...food, serving: toServing(data.product) ?? undefined } };
  }
  return { missing: named ? "nutrition" : "product" };
}

// Open Food Facts search API (free, no key).
export async function searchFoods(query: string, signal?: AbortSignal): Promise<Food[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: "20",
    fields: "code,product_name,brands,nutriments",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, { signal, headers: HEADERS });
  if (!res.ok) throw new Error(`Food search failed (${res.status})`);
  const data = (await res.json()) as { hits?: OFFProduct[] };
  const foods = (data.hits ?? []).map(toFood).filter((f): f is Food => f !== null);
  const servings = await fetchServings(foods.map((f) => f.id), signal);
  return foods.map((f) => ({ ...f, serving: servings.get(f.id) }));
}

// Serving sizes already looked up, by product code (null = product lists none), kept across visits.
const SERVING_CACHE_KEY = "servingCache";
const loadServingCache = (): Record<string, Serving | null> => {
  try {
    return JSON.parse(localStorage.getItem(SERVING_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); });
  });

// The search index has no serving sizes, so look up the uncached ones in one request.
// This API answers 503 now and then, so retry with a short pause; if it never works, foods fall back to 100 g.
async function fetchServings(codes: string[], signal?: AbortSignal): Promise<Map<string, Serving>> {
  const cache = loadServingCache();
  const ids = codes.filter((c) => /^\d+$/.test(c) && !(c in cache));
  if (ids.length) {
    const params = new URLSearchParams({
      code: ids.join(","),
      fields: "code,serving_size,serving_quantity,serving_quantity_unit",
      page_size: String(ids.length),
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await wait(500 * attempt, signal);
      try {
        const res = await fetch(`${PRODUCTS_URL}?${params}`, { signal, headers: HEADERS });
        if (!res.ok) continue;
        const data = (await res.json()) as { products?: OFFServing[] };
        for (const id of ids) cache[id] = null;
        for (const p of data.products ?? []) cache[p.code] = toServing(p);
        try { localStorage.setItem(SERVING_CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ }
        break;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
      }
    }
  }
  const servings = new Map<string, Serving>();
  for (const c of codes) if (cache[c]) servings.set(c, cache[c]!);
  return servings;
}
