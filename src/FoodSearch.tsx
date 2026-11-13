import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Capacitor } from "@capacitor/core";
import { lookupBarcode, matchesQuery, PER_OZ, searchFoods, type Food, type Macros, type Serving } from "./api";
import { deleteCustomFood, loadCustomFoods, loadRecentFoods, recentFromEntry, type NewEntry } from "./db";
import FoodForm from "./FoodForm";
import type { LabelValues } from "./labelParse";
import { scanNutritionLabel } from "./labelReader";

// The barcode scanner uses the phone's camera, so it's offered in the iOS app only.
const canScan = Capacitor.isNativePlatform();

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const SERVING_STEP = 0.5;
const roundToStep = (n: number) => Math.max(SERVING_STEP, Math.round(n / SERVING_STEP) * SERVING_STEP);
// How you enter an amount: in servings, in the food's own unit (g or ml), or in ounces (fl oz for drinks).
type Mode = "serving" | "base" | "oz";
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
  const [recents, setRecents] = useState<Food[]>([]);
  const [customs, setCustoms] = useState<Food[]>([]);
  useEffect(() => {
    loadRecentFoods().then(setRecents).catch(() => {});
    loadCustomFoods().then(setCustoms).catch(() => {});
  }, []);
  // Your own foods, then foods you've logged before (a logged custom food is listed once, as yours).
  const customNames = new Set(customs.map((f) => f.name.trim().toLowerCase()));
  const mine = [...customs, ...recents.filter((f) => !customNames.has(f.name.trim().toLowerCase()))];
  // The ones whose names match what you've typed so far.
  const recentMatches = query.trim() ? mine.filter((f) => matchesQuery(f.name, query)) : mine;
  // The add-your-own-food form, with what a label photo showed if it came from one, or one of your foods to edit.
  const [creating, setCreating] = useState<{ scanned?: LabelValues; editing?: Food } | null>(null);
  // Your food waiting for "yes, delete it", and whether that's in progress.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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
      const yours = mine.filter((f) => matchesQuery(f.name, q)).slice(0, 3); // yours first: you know they're right
      setResults([...yours, ...foods]);
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

  // Takes or picks a photo of a nutrition label and opens the add-your-own-food form with what it read.
  const scanLabel = async () => {
    searchCtrl.current?.abort();
    setStatus("");
    const scan = await scanNutritionLabel();
    if ("values" in scan) return setCreating({ scanned: scan.values });
    if (scan.error === "camera-denied") setStatus("Xochiwell needs camera access to photograph a label. Turn it on in Settings → Xochiwell → Camera, or choose a photo from your library.");
    else if (scan.error === "unreadable") setStatus("Couldn't read that photo. Try again, or enter the food yourself.");
  };
  const saved = (f: Food) => {
    const edited = creating?.editing;
    setCreating(null);
    if (edited) {
      setCustoms((c) => c.map((x) => (x.id === f.id ? f : x)));
      setResults((r) => (r.length ? r.map((x) => (x.id === f.id ? f : x)) : r));
      open(f);
      setStatus(`Updated ${f.name}.`);
    } else {
      setCustoms((c) => [f, ...c]);
      setResults([f]);
      open(f);
      setStatus(`Saved ${f.name}. Pick an amount to add it.`);
    }
  };
  const remove = async (f: Food) => {
    setDeleting(true);
    try {
      await deleteCustomFood(f.id);
      setCustoms((c) => c.filter((x) => x.id !== f.id));
      setResults((r) => r.filter((x) => x.id !== f.id));
      setSelected(null);
      setStatus(`Deleted ${f.name}. Anything you've already logged stays in your diary.`);
    } catch {
      setStatus(`Couldn't delete ${f.name}. Check your connection and try again.`);
    }
    setConfirmDelete(null);
    setDeleting(false);
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
    setConfirmDelete(null);
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
    const entry = { name: f.name, ...logged, meal, ...scale(f.per100g, base) };
    onAdd(entry);
    const recent = recentFromEntry(entry);
    if (recent) setRecents((r) => [recent, ...r.filter((x) => x.id !== recent.id)]);
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
      {creating ? (
        <FoodForm key={creating.editing?.id ?? "new"} name={query.trim()} scanned={creating.scanned} editing={creating.editing}
          onSaved={saved} onCancel={() => setCreating(null)} />
      ) : (<>
      {!results.length && recentMatches.length > 0 && <h3 className="recent-head">your recent foods</h3>}
      <ul className="results">
        {(results.length ? results : recentMatches.slice(0, 8)).map((f) => {
          const s = servingOf(f, customServings);
          const per = scale(f.per100g, s.amount);
          const isOpen = selected === f.id;
          const mode = modeFor(s);
          const step = STEP[mode];
          const base = toBase(qty, mode, s);
          return (
            <li key={f.id} className={isOpen ? "open" : ""}>
              <button type="button" className="result" onClick={() => toggle(f)} aria-expanded={isOpen}>
                <span className="result-name"><b>{f.name}</b>{f.recent || f.custom ? <small className="recent-tag">{f.custom ? "your food" : "you've logged this"}</small> : f.brand && <small>{f.brand}</small>}</span>
                <span className="result-kcal">{per.kcal} kcal</span>
              </button>
              {isOpen && (
                <div className="result-detail">
                  {f.serving ? (
                    <small className="serving">1 serving = {s.label}</small>
                  ) : (
                    <small className="serving">
                      1 serving ={" "}
                      <NumberField className="inline" min={1} value={s.amount} aria-label={`Serving size in grams for ${f.name}`}
                        onValue={(n) => onCustomServing(f.id, Math.round(n), false)}
                        onDone={(n) => onCustomServing(f.id, Math.round(n), true)} />{" "}
                      g <span className="hint">(none listed, set your own)</span>
                    </small>
                  )}
                  <small><MacroText m={per} kcalLabel="kcal per serving" /></small>
                  <div className="controls amount">
                    <div className="stepper">
                      <button type="button" className="ghost" onClick={() => setQty(Math.max(step, Math.ceil(qty / step - 1) * step))} disabled={qty <= step} aria-label="Less">−</button>
                      <NumberField inputMode="decimal" min={mode === "oz" ? 0.1 : mode === "base" ? 1 : SERVING_STEP} step="any" value={qty}
                        onValue={setQty}
                        onDone={(n) => setQty(mode === "serving" ? roundToStep(n) : fromBase(toBase(n, mode, s), mode, s))} aria-label={`Amount in ${unitLabel(mode, s, 2)}`} />
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
                  {f.custom && (confirmDelete === f.id ? (
                    <div className="confirm-delete">
                      <p>Delete {f.name} from your foods? It won't show up in search anymore. Anything you've already logged stays in your diary.</p>
                      <div className="form-actions">
                        <button type="button" className="link" onClick={() => setConfirmDelete(null)} disabled={deleting}>keep it</button>
                        <button type="button" className="danger" onClick={() => remove(f)} disabled={deleting}>{deleting ? "Deleting…" : "Delete food"}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="own-food-actions">
                      <button type="button" className="link" onClick={() => { setStatus(""); setCreating({ editing: f }); }}>edit this food</button>
                      <button type="button" className="link" onClick={() => setConfirmDelete(f.id)}>delete</button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="create-food">
        Can't find it?{" "}
        {canScan && <><button type="button" className="link" onClick={scanLabel}>Scan the nutrition label</button> or{" "}</>}
        <button type="button" className="link" onClick={() => setCreating({})}>{canScan ? "enter it yourself" : "Add it yourself"}</button>
      </p>
      </>)}
    </>
  );
}

// A number box you can clear and retype freely. While you're typing, only real positive numbers are passed on
// (so an empty box doesn't snap back to 1). Leaving it empty puts back the number it had before you started.
function NumberField({ value, onValue, onDone, ...rest }: {
  value: number; onValue: (n: number) => void; onDone?: (final: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState<string | null>(null); // null when not being edited
  const before = useRef(value);
  return (
    <input {...rest} type="number" value={text ?? String(value)}
      onFocus={(e) => { before.current = value; setText(String(value)); rest.onFocus?.(e); }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && n > 0) onValue(n);
      }}
      onBlur={(e) => {
        const final = Number(text) > 0 ? Number(text) : before.current;
        if (final !== Number(text)) onValue(final);
        setText(null);
        onDone?.(final);
        rest.onBlur?.(e);
      }} />
  );
}
