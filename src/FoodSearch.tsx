import { useRef, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { lookupBarcode, searchFoods, type Food, type Macros, type Serving } from "./api";
import type { NewEntry } from "./db";

// The barcode scanner uses the phone's camera, so it's offered in the iOS app only.
const canScan = Capacitor.isNativePlatform();

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const SERVING_STEP = 0.5;
const roundToStep = (n: number) => Math.max(SERVING_STEP, Math.round(n / SERVING_STEP) * SERVING_STEP);
// How you enter an amount: in servings, in the food's own unit (g or ml), or in ounces (fl oz for drinks).
type Mode = "serving" | "base" | "oz";
const PER_OZ: Record<string, number> = { g: 28.3495, ml: 29.5735 };
const STEP: Record<Mode, number> = { serving: SERVING_STEP, base: 10, oz: 0.5 };
const MODE_KEY = "xochiwell-amount-unit";
const loadMode = (): Mode => {
  try { const m = localStorage.getItem(MODE_KEY); return m === "base" || m === "oz" ? m : "serving"; } catch { return "serving"; }
};
const round1 = (n: number) => Math.round(n * 10) / 10;
export const servingLabel = (n: number) => `${n} serving${n === 1 ? "" : "s"}`;
// Foods without a listed serving size use the size you set for them (remembered by food), or 100 g.
const servingOf = (f: Food, custom: Record<string, number>): Serving => {
  if (f.serving) return f.serving;
  const amount = custom[f.id] ?? 100;
  return { amount, unit: "g", label: `${amount} g` };
};

export const scale = (m: Macros, grams: number): Macros => ({
  kcal: Math.round((m.kcal * grams) / 100),
  protein: Math.round((m.protein * grams) / 10) / 10,
  carbs: Math.round((m.carbs * grams) / 10) / 10,
  fat: Math.round((m.fat * grams) / 10) / 10,
});

export const sumMacros = (items: Macros[]): Macros => items.reduce<Macros>(
  (a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }),
  { kcal: 0, protein: 0, carbs: 0, fat: 0 },
);

// Macro numbers in each nutrient's color, e.g. "90 kcal, 16p 6c 0f".
export const MacroText = ({ m, kcalLabel = "kcal" }: { m: Macros; kcalLabel?: string }) => (
  <>
    <span className="m-kcal">{Math.round(m.kcal)} {kcalLabel}</span>,{" "}
    <span className="m-protein">{Math.round(m.protein * 10) / 10}p</span> <span className="m-carbs">{Math.round(m.carbs * 10) / 10}c</span> <span className="m-fat">{Math.round(m.fat * 10) / 10}f</span>
  </>
);

type Props = {
  customServings: Record<string, number>;
  onCustomServing: (foodId: string, grams: number, save: boolean) => void;
  onAdd: (entry: NewEntry) => void;
  // When set, foods go to this meal; otherwise a meal picker shows next to the servings.
  meal?: string;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
};

// Search box with compact results: tap a food to see its serving size, pick servings and add it.
// Used by the diary's add sheet and by setup's typical day.
export default function FoodSearch({
  customServings, onCustomServing, onAdd, meal: fixedMeal, disabled, placeholder = "Search foods, e.g. greek yogurt", autoFocus,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [prefMode, setPrefMode] = useState<Mode>(loadMode);
  const [pickedMeal, setPickedMeal] = useState(MEALS[0]);
  const searchCtrl = useRef<AbortController>();
  const meal = fixedMeal ?? pickedMeal;

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return setStatus("Type at least 2 letters to search.");
    (document.activeElement as HTMLElement | null)?.blur(); // close the phone keyboard so the results are visible
    searchCtrl.current?.abort();
    const ctrl = (searchCtrl.current = new AbortController());
    setStatus("Searching…");
    setSelected(null);
    try {
      const foods = await searchFoods(q, ctrl.signal);
      if (ctrl.signal.aborted) return; // a newer search started (the app's native networking ignores aborts)
      setResults(foods);
      setStatus(foods.length ? "" : "No foods found. Try a simpler name.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus("Search failed. Check your connection and try again.");
    }
  };

  // Opens the camera; a recognized barcode shows that one food, opened and ready to add.
  const scan = async () => {
    searchCtrl.current?.abort();
    const ctrl = (searchCtrl.current = new AbortController());
    let code: string;
    try {
      // Loaded on first use, since the scanner library is only needed here.
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHintALLOption } = await import("@capacitor/barcode-scanner");
      const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHintALLOption.ALL,
        scanInstructions: "Point the camera at the barcode",
      });
      code = ScanResult.trim();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "OS-PLUG-BARC-0006") return; // closed the scanner
      setStatus(err.code === "OS-PLUG-BARC-0007"
        ? "Xochiwell needs camera access to scan. Turn it on in Settings → Xochiwell → Camera."
        : "Couldn't scan that. Try again, or search by name.");
      return;
    }
    if (!/^\d{6,14}$/.test(code)) return setStatus("That doesn't look like a food barcode. Try again, or search by name.");
    setStatus("Looking up barcode…");
    setSelected(null);
    try {
      const found = await lookupBarcode(code, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if ("food" in found) {
        setResults([found.food]);
        open(found.food);
        setStatus("");
      } else {
        setResults([]);
        setStatus(found.missing === "nutrition"
          ? "Found that product, but it has no nutrition facts listed. Try searching by name."
          : "That barcode isn't in the food database yet. Try searching by name.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus("Lookup failed. Check your connection and try again.");
    }
  };

  // Ounces only make sense for foods measured in g or ml; anything else is entered in servings.
  const modeFor = (s: Serving): Mode => (prefMode === "serving" || PER_OZ[s.unit] ? prefMode : "serving");
  const unitLabel = (mode: Mode, s: Serving, n: number) =>
    mode === "serving" ? (n === 1 ? "serving" : "servings") : mode === "base" ? s.unit : s.unit === "ml" ? "fl oz" : "oz";
  // The amount in the food's own unit (g or ml), which is what nutrition is scaled by.
  const toBase = (n: number, mode: Mode, s: Serving) => (mode === "serving" ? n * s.amount : mode === "base" ? n : n * PER_OZ[s.unit]);
  const fromBase = (b: number, mode: Mode, s: Serving) =>
    mode === "serving" ? Math.max(SERVING_STEP, Math.round(b / s.amount / SERVING_STEP) * SERVING_STEP) : mode === "base" ? Math.max(1, Math.round(b)) : Math.max(0.1, round1(b / PER_OZ[s.unit]));

  const open = (f: Food) => {
    const s = servingOf(f, customServings);
    setSelected(f.id);
    setQty(fromBase(s.amount, modeFor(s), s)); // starts at one serving, in whichever unit you last used
  };
  const toggle = (f: Food) => (selected === f.id ? setSelected(null) : open(f));
  const switchMode = (next: Mode, s: Serving) => {
    setQty(fromBase(toBase(qty, modeFor(s), s), next, s));
    setPrefMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* remembered for this visit only */ }
  };

  const add = (f: Food) => {
    const s = servingOf(f, customServings);
    const mode = modeFor(s);
    const base = toBase(qty, mode, s);
    // Servings keep the serving count; g/ml and oz entries are logged in the unit you typed, e.g. "3 oz".
    const logged = mode === "serving" ? { grams: Math.round(base), unit: s.unit, servings: qty }
      : mode === "base" ? { grams: Math.round(qty), unit: s.unit, servings: null }
      : { grams: round1(qty), unit: unitLabel("oz", s, qty), servings: null };
    onAdd({ name: f.name, ...logged, meal, ...scale(f.per100g, base) });
    setSelected(null);
    setStatus(`Added ${f.name} to ${meal.toLowerCase()}.`);
  };

  return (
    <>
      <form className="controls" onSubmit={runSearch} role="search">
        <input placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search foods"
          autoFocus={autoFocus} enterKeyHint="search" />
        <button type="submit">Search</button>
        {canScan && <button type="button" className="ghost scan" onClick={scan} aria-label="Scan a barcode">Scan</button>}
      </form>
      {status && <p className="note" role="status">{status}</p>}
      <ul className="results">
        {results.map((f) => {
          const s = servingOf(f, customServings);
          const per = scale(f.per100g, s.amount);
          const isOpen = selected === f.id;
          const mode = modeFor(s);
          const step = STEP[mode];
          const base = toBase(qty, mode, s);
          return (
            <li key={f.id} className={isOpen ? "open" : ""}>
              <button type="button" className="result" onClick={() => toggle(f)} aria-expanded={isOpen}>
                <span className="result-name"><b>{f.name}</b>{f.brand && <small>{f.brand}</small>}</span>
                <span className="result-kcal">{per.kcal} kcal</span>
              </button>
              {isOpen && (
                <div className="result-detail">
                  {f.serving ? (
                    <small className="serving">1 serving = {s.label}</small>
                  ) : (
                    <small className="serving">
                      1 serving ={" "}
                      <input className="inline" type="number" min={1} value={s.amount} aria-label={`Serving size in grams for ${f.name}`}
                        onChange={(e) => onCustomServing(f.id, Math.max(1, Number(e.target.value) || 1), false)}
                        onBlur={() => onCustomServing(f.id, s.amount, true)} />{" "}
                      g <span className="hint">(none listed, set your own)</span>
                    </small>
                  )}
                  <small><MacroText m={per} kcalLabel="kcal per serving" /></small>
                  <div className="controls amount">
                    <div className="stepper">
                      <button type="button" className="ghost" onClick={() => setQty(Math.max(step, Math.ceil(qty / step - 1) * step))} disabled={qty <= step} aria-label="Less">−</button>
                      <input type="number" inputMode="decimal" min={mode === "oz" ? 0.1 : mode === "base" ? 1 : SERVING_STEP} step="any" value={qty}
                        onChange={(e) => setQty(Number(e.target.value) || 0)}
                        onBlur={() => setQty(mode === "serving" ? roundToStep(qty) : fromBase(toBase(qty, mode, s), mode, s))} aria-label={`Amount in ${unitLabel(mode, s, 2)}`} />
                      <button type="button" className="ghost" onClick={() => setQty(Math.floor(qty / step + 1) * step)} aria-label="More">+</button>
                    </div>
                    {PER_OZ[s.unit] ? (
                      <select className="amount-unit" value={mode} onChange={(e) => switchMode(e.target.value as Mode, s)} aria-label="Unit">
                        <option value="serving">{unitLabel("serving", s, qty)}</option>
                        <option value="base">{s.unit}</option>
                        <option value="oz">{unitLabel("oz", s, qty)}</option>
                      </select>
                    ) : <span>{unitLabel("serving", s, qty)}</span>}
                    {!fixedMeal && (
                      <select value={pickedMeal} onChange={(e) => setPickedMeal(e.target.value)} aria-label="Meal">
                        {MEALS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    )}
                  </div>
                  <button className="add" onClick={() => add(f)} disabled={disabled || !(qty > 0)}>
                    Add {mode === "serving" ? `${qty} (${Math.round(base)} ${s.unit})` : `${round1(qty)} ${unitLabel(mode, s, qty)}`} · {scale(f.per100g, base).kcal} kcal
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
