import { useState, type FormEvent } from "react";
import type { Food } from "./api";
import { saveCustomFood, updateCustomFood } from "./db";
import type { LabelValues } from "./labelParse";

type Props = {
  name?: string;
  // Numbers read from a photo of the label; fields it couldn't read start empty and are marked.
  scanned?: LabelValues;
  // One of your foods to change, instead of adding a new one.
  editing?: Food;
  onSaved: (food: Food) => void;
  onCancel: () => void;
};

const text = (n?: number) => (n == null ? "" : String(n));

// Add a food that isn't in the database, with the numbers for one serving as the label prints them,
// or change one you added before.
export default function FoodForm({ name: initialName = "", scanned, editing, onSaved, onCancel }: Props) {
  const start = editing?.custom ?? scanned;
  const [name, setName] = useState(editing?.custom?.name ?? initialName);
  const [servingLabel, setServingLabel] = useState(start?.servingLabel ?? "");
  const [amount, setAmount] = useState(text(start?.servingAmount));
  const [unit, setUnit] = useState<"g" | "ml">(start?.servingUnit ?? "g");
  const [kcal, setKcal] = useState(text(start?.kcal));
  const [protein, setProtein] = useState(text(start?.protein));
  const [carbs, setCarbs] = useState(text(start?.carbs));
  const [fat, setFat] = useState(text(start?.fat));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const readAnything = scanned && [scanned.kcal, scanned.protein, scanned.carbs, scanned.fat, scanned.servingAmount].some((v) => v != null);
  // After a scan, a field the photo didn't give a number for is highlighted until it's filled in.
  const missing = (v: string) => (scanned && v.trim() === "" ? "missing" : undefined);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
    const values = { kcal: n(kcal), protein: n(protein), carbs: n(carbs), fat: n(fat) };
    if (!name.trim()) return setError("Give the food a name.");
    if (!(Number(amount) > 0)) return setError(`Enter how many ${unit === "g" ? "grams" : "ml"} one serving is. It's usually in brackets after the serving size.`);
    if (kcal.trim() === "" || Object.values(values).some((v) => !(v >= 0))) return setError("Enter the calories, and numbers only for protein, carbs and fat.");
    setError("");
    setSaving(true);
    try {
      const food = { name, servingLabel, servingAmount: Number(amount), servingUnit: unit, ...values };
      onSaved(await (editing ? updateCustomFood(editing.id, food) : saveCustomFood(food)));
    } catch {
      setError("Couldn't save this food. Check your connection and try again.");
      setSaving(false);
    }
  };

  return (
    <form className="food-form" onSubmit={save}>
      <h3>{editing ? "edit your food" : "add your own food"}</h3>
      {editing && <p className="note">Changes apply from now on. Anything you've already logged keeps its numbers.</p>}
      {scanned && (
        <p className="note">
          {readAnything
            ? "Here's what the photo showed. Add a name, check the numbers against the label, and fill in anything highlighted."
            : "Couldn't read numbers from that photo. Type them in, or try another photo taken closer, flat and in good light."}
        </p>
      )}
      <label>name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initialName && !editing} placeholder="e.g. Grandma's tamales" autoCapitalize="sentences" />
      </label>
      <fieldset>
        <legend>one serving</legend>
        <div className="serving-row">
          <input value={servingLabel} onChange={(e) => setServingLabel(e.target.value)} placeholder="e.g. 2/3 cup (optional)" aria-label="Serving size as the label words it" />
          <input type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)}
            className={missing(amount)} placeholder="55" aria-label={`Serving size in ${unit}`} />
          <select value={unit} onChange={(e) => setUnit(e.target.value as "g" | "ml")} aria-label="Serving unit">
            <option value="g">g</option>
            <option value="ml">ml</option>
          </select>
        </div>
      </fieldset>
      <div className="macro-fields">
        {([["calories", kcal, setKcal, "m-kcal"], ["protein (g)", protein, setProtein, "m-protein"], ["carbs (g)", carbs, setCarbs, "m-carbs"], ["fat (g)", fat, setFat, "m-fat"]] as const).map(([label, value, set, cls]) => (
          <label key={label}><span className={cls}>{label}</span>
            <input type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => set(e.target.value)} className={missing(value)} />
          </label>
        ))}
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="link" onClick={onCancel}>cancel</button>
        <button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save food"}</button>
      </div>
    </form>
  );
}
