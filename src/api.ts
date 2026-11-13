import { Capacitor } from "@capacitor/core";

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };
// serving: one serving as the label prints it (e.g. "1 container (150 g)"), plus its weight or volume.
export type Serving = { amount: number; unit: string; label: string };
// recent: a food rebuilt from your own diary rather than from the food database; custom: one you added yourself.
export type Food = {
  id: string; name: string; brand?: string; per100g: Macros; serving?: Serving; recent?: boolean;
  // A food you added yourself, with the numbers for one serving as you entered them (so it can be edited).
  custom?: CustomFoodValues;
};
export type CustomFoodValues = Macros & { name: string; servingLabel: string; servingAmount: number; servingUnit: "g" | "ml" };

// Ounces per food unit: weight ounces for foods measured in grams, fluid ounces for drinks in ml.
export const PER_OZ: Record<string, number> = { g: 28.3495, ml: 29.5735 };

type OFFProduct = {
  code?: string;
  product_name?: string;
  brands?: string | string[];
  nutriments?: Record<string, number | string | undefined>;
  countries_tags?: string[];
  completeness?: number; // 0–1, how much of the product page has been filled in
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

// Open Food Facts is crowd-sourced, so the same food can appear many times with very different numbers (turkey
// bacon ranges from 30 to 233 kcal per 100 g). Results are re-ranked so the likely-right ones come first.
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
const sameWord = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
export const matchesQuery = (name: string, query: string) => {
  const n = words(name);
  return words(query).every((w) => n.some((x) => sameWord(x, w) || x.startsWith(w)));
};

// Your country, from the phone's region setting, to favor products sold where you shop.
const COUNTRIES: Record<string, string> = {
  US: "united-states", CA: "canada", MX: "mexico", GB: "united-kingdom", IE: "ireland", AU: "australia", NZ: "new-zealand",
  FR: "france", DE: "germany", ES: "spain", IT: "italy", NL: "netherlands", BE: "belgium", CH: "switzerland",
};
const myCountry = `en:${COUNTRIES[(navigator.language.split("-")[1] ?? "US").toUpperCase()] ?? "united-states"}`;

function score(p: OFFProduct, f: Food, query: string): number {
  const q = words(query), name = words(f.name);
  const { kcal, protein, carbs, fat } = f.per100g;
  let s = 0;
  // Name: all the words you typed, and not much else ("turkey bacon" over "turkey bacon cheddar wrap").
  s += (3 * q.filter((w) => name.some((x) => sameWord(x, w) || x.startsWith(w))).length) / Math.max(1, q.length);
  s -= Math.min(2, 0.4 * Math.max(0, name.length - q.length));
  if (name.length === q.length && q.every((w) => name.some((x) => sameWord(x, w)))) s += 2; // exactly what you typed
  if (p.countries_tags?.includes(myCountry)) s += 1.5;
  if (f.brand) s += 1;
  s += 1.5 * (p.completeness ?? 0);
  // Protein and carbs are ~4 kcal/g and fat ~9, so the macros should roughly add up to the calories.
  // When they don't, the entry was probably typed in wrong (often per-serving numbers entered as per 100 g).
  const est = 4 * protein + 4 * carbs + 9 * fat;
  const off = Math.abs(est - kcal) / Math.max(kcal, est, 1);
  if (Math.max(kcal, est) >= 20) s -= off > 0.35 ? 4 : off > 0.2 ? 1.5 : 0;
  if (kcal === 0 && protein + carbs + fat === 0) s -= 1; // nothing filled in at all
  return s;
}

export function rankFoods(hits: OFFProduct[], query: string, limit = 20): Food[] {
  const scored: { f: Food; s: number }[] = [];
  for (const p of hits) {
    const f = toFood(p);
    if (!f) continue;
    const { kcal, protein, carbs, fat } = f.per100g;
    if (kcal > 900 || protein + carbs + fat > 102) continue; // impossible per 100 g
    scored.push({ f, s: score(p, f, query) });
  }
  scored.sort((a, b) => b.s - a.s);
  // The same product is often entered several times; keep the best-scored copy.
  const seen = new Set<string>();
  const out: Food[] = [];
  for (const { f } of scored) {
    const key = `${words(f.name).join(" ")}|${(f.brand ?? "").toLowerCase()}|${Math.round(f.per100g.kcal / 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length === limit) break;
  }
  return out;
}

// Open Food Facts search API (free, no key). Fetches extra results so there's room to re-rank.
export async function searchFoods(query: string, signal?: AbortSignal): Promise<Food[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: "50",
    fields: "code,product_name,brands,nutriments,countries_tags,completeness",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, { signal, headers: HEADERS });
  if (!res.ok) throw new Error(`Food search failed (${res.status})`);
  const data = (await res.json()) as { hits?: OFFProduct[] };
  const foods = rankFoods(data.hits ?? [], query);
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
