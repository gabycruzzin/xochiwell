import { useEffect, useState } from "react";
import { loadPastMeals, type NewEntry, type PastMeal } from "./db";
import FoodSearch, { sumMacros } from "./FoodSearch";

type Props = {
  meal: string;
  date: string; // the diary day being added to (YYYY-MM-DD)
  customServings: Record<string, number>;
  onCustomServing: (foodId: string, grams: number, save: boolean) => void;
  onAdd: (entry: NewEntry) => void;
  // Copies a whole earlier meal into this day; resolves once it's saved.
  onCopy: (entries: NewEntry[]) => Promise<void>;
  onClose: () => void;
  disabled?: boolean;
};

// A panel that slides up over the diary to search and add foods to one meal. It stays open so several foods
// can be added in a row; "done", the backdrop or Escape closes it. Recent days' versions of the meal are listed first
// so a repeat meal is one tap.
export default function AddSheet({ meal, date, customServings, onCustomServing, onAdd, onCopy, onClose, disabled }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // Keep the diary behind the sheet from scrolling.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Add food to ${meal}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>add to {meal.toLowerCase()}</h2>
          <button className="link" onClick={onClose}>done</button>
        </div>
        <PastMeals meal={meal} date={date} onCopy={onCopy} disabled={disabled} />
        <FoodSearch meal={meal} customServings={customServings} onCustomServing={onCustomServing} onAdd={onAdd} disabled={disabled} />
      </div>
    </div>
  );
}

// "yesterday", or a short date like "Mon, Nov 9", relative to the day being viewed.
function dayLabel(day: string, viewing: string) {
  const d = new Date(`${day}T12:00:00`), v = new Date(`${viewing}T12:00:00`);
  if (Math.round((v.getTime() - d.getTime()) / 86400000) === 1) return "yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function PastMeals({ meal, date, onCopy, disabled }: { meal: string; date: string; onCopy: Props["onCopy"]; disabled?: boolean }) {
  const [past, setPast] = useState<PastMeal[]>([]);
  const [copied, setCopied] = useState<Record<string, "copying" | "done">>({});

  useEffect(() => {
    let current = true;
    loadPastMeals(meal, date).then((p) => current && setPast(p)).catch(console.error);
    return () => { current = false; };
  }, [meal, date]);

  if (!past.length) return null;
  const copy = (p: PastMeal) => {
    setCopied((c) => ({ ...c, [p.day]: "copying" }));
    onCopy(p.entries)
      .then(() => setCopied((c) => ({ ...c, [p.day]: "done" })))
      .catch(() => setCopied(({ [p.day]: _, ...rest }) => rest));
  };

  return (
    <section className="past-meals">
      <h3>copy a recent {meal.toLowerCase()}</h3>
      <ul className="results">
        {past.map((p) => (
          <li key={p.day} className="past-meal">
            <div className="result-name">
              <b>{dayLabel(p.day, date)} · {Math.round(sumMacros(p.entries).kcal)} kcal</b>
              <small>{p.entries.map((e) => e.name).join(", ")}</small>
            </div>
            <button className="ghost" disabled={disabled || !!copied[p.day]} onClick={() => copy(p)}>
              {copied[p.day] === "done" ? "copied ✓" : copied[p.day] === "copying" ? "copying…" : "copy"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
