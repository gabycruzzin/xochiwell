import { useEffect, useMemo, useState, type FormEvent } from "react";
import { deleteWeight, KG_PER_LB, loadWeights, saveWeight, type WeighIn } from "./db";
import Sheet from "./Sheet";

// Optional weight log. Deliberately calm: the story is the 7-day average trend, not any single day, and nothing is
// framed as good or bad (no red/green, no "gained"/"lost", no goal weight).

type Props = { unit: "lb" | "kg"; today: string; onClose: () => void; onError: (what: string) => (e: unknown) => void };

const noon = (day: string) => new Date(`${day}T12:00:00`).getTime();
const DAY = 86400000;
const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const RANGES = [["1M", 31], ["3M", 92], ["All", Infinity]] as const;

export default function WeightLog({ unit, today, onClose, onError }: Props) {
  const toUnit = (kg: number) => (unit === "kg" ? kg : kg / KG_PER_LB);
  const fmt = (kg: number) => (Math.round(toUnit(kg) * 10) / 10).toFixed(1);

  const [list, setList] = useState<WeighIn[] | null>(null);
  const [day, setDay] = useState(today);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("1M");
  const [picked, setPicked] = useState<WeighIn | null>(null);

  useEffect(() => { loadWeights().then(setList).catch(onError("load your weigh-ins")); }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!n || n <= 0) return;
    setSaving(true);
    saveWeight(day, unit === "kg" ? n : n * KG_PER_LB, note.trim() || null)
      .then((w) => {
        setList((l) => [...(l ?? []).filter((x) => x.day !== w.day), w].sort((a, b) => a.day.localeCompare(b.day)));
        setValue(""); setNote("");
      })
      .catch(onError("save that weigh-in"))
      .finally(() => setSaving(false));
  };
  const remove = (w: WeighIn) => {
    setList((l) => (l ?? []).filter((x) => x.id !== w.id));
    deleteWeight(w.id).catch((e) => { setList((l) => [...(l ?? []), w].sort((a, b) => a.day.localeCompare(b.day))); onError("delete that weigh-in")(e); });
  };

  // Each weigh-in's 7-day average: the mean of weigh-ins in the 7 days up to and including it.
  const withAvg = useMemo(() => (list ?? []).map((w) => {
    const window = (list ?? []).filter((x) => noon(x.day) <= noon(w.day) && noon(x.day) > noon(w.day) - 7 * DAY);
    return { ...w, avg: window.reduce((a, x) => a + x.kg, 0) / window.length };
  }), [list]);

  // Summary: this week's average against the week before, in neutral words.
  const avgBetween = (fromDaysAgo: number, toDaysAgo: number) => {
    const xs = (list ?? []).filter((w) => noon(w.day) > noon(today) - fromDaysAgo * DAY && noon(w.day) <= noon(today) - toDaysAgo * DAY);
    return xs.length ? xs.reduce((a, w) => a + w.kg, 0) / xs.length : null;
  };
  const thisWeek = avgBetween(7, 0), lastWeek = avgBetween(14, 7);
  let summary = "Log a weigh-in whenever you like. Your trend appears after two or more.";
  if (thisWeek !== null) {
    summary = `Your 7-day average: ${fmt(thisWeek)} ${unit}`;
    if (lastWeek !== null) {
      const diff = toUnit(thisWeek) - toUnit(lastWeek);
      summary += Math.abs(diff) < (unit === "kg" ? 0.15 : 0.3)
        ? ", about the same as the week before."
        : `, ${Math.abs(diff).toFixed(1)} ${unit} ${diff < 0 ? "lower" : "higher"} than the week before.`;
    } else summary += ".";
  } else if (list && list.length) summary = `Your last weigh-in was ${fmt(list[list.length - 1].kg)} ${unit} on ${short(list[list.length - 1].day)}.`;

  const days = RANGES.find(([r]) => r === range)![1];
  const shown = withAvg.filter((w) => noon(w.day) > noon(today) - days * DAY);

  return (
    <Sheet title="weight" onClose={onClose} className="weight">
      <form className="weigh-in" onSubmit={save}>
        <label>Weight ({unit})
          <input type="number" inputMode="decimal" step="0.1" min="1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={unit === "kg" ? "e.g. 64.5" : "e.g. 142.5"} />
        </label>
        <label>Date
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
        </label>
        <label className="weigh-note">Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. after the gym" maxLength={120} />
        </label>
        <button type="submit" disabled={saving || !value}>{saving ? "Saving…" : "Save weigh-in"}</button>
      </form>

      <p className="weight-summary">{list ? summary : "Loading your weigh-ins…"}</p>

      {/* A trend needs at least two weigh-ins in range; one dot alone just looks empty. */}
      {shown.length > 1 && (
        <section className="weight-chart">
          <div className="range-switch" role="radiogroup" aria-label="Chart range">
            {RANGES.map(([r]) => (
              <button key={r} role="radio" aria-checked={range === r} className={range === r ? "on" : ""} onClick={() => { setRange(r); setPicked(null); }}>{r}</button>
            ))}
          </div>
          <TrendChart points={shown} toUnit={toUnit} onPick={setPicked} picked={picked} />
          <p className="note chart-caption">
            {picked ? `${short(picked.day)}: ${fmt(picked.kg)} ${unit}${picked.note ? ` · ${picked.note}` : ""}`
              : "Dots are weigh-ins; the line is your 7-day average. Tap a dot for details."}
          </p>
        </section>
      )}

      {list && list.length > 0 && (
        <section className="weight-history">
          <h3>history</h3>
          <ul className="list">
            {[...list].reverse().map((w) => (
              <li key={w.id}>
                <div><b>{fmt(w.kg)} {unit}</b><small>{short(w.day)}{w.note ? ` · ${w.note}` : ""}</small></div>
                <button className="ghost" onClick={() => remove(w)} aria-label={`Remove weigh-in from ${short(w.day)}`}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}

const W = 340, H = 170, PAD = { l: 40, r: 10, t: 12, b: 24 };

function TrendChart({ points, toUnit, onPick, picked }: {
  points: (WeighIn & { avg: number })[]; toUnit: (kg: number) => number; onPick: (w: WeighIn) => void; picked: WeighIn | null;
}) {
  const t0 = noon(points[0].day), t1 = noon(points[points.length - 1].day);
  const vals = points.flatMap((p) => [toUnit(p.kg), toUnit(p.avg)]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 1);
  lo -= pad; hi += pad;
  const x = (day: string) => (t1 === t0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + ((noon(day) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(toUnit(p.avg)).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img"
      aria-label={`Weight trend from ${points[0].day} to ${points[points.length - 1].day}`}>
      {[hi - pad, lo + pad].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{v.toFixed(0)}</text>
        </g>
      ))}
      <text x={PAD.l} y={H - 6} className="axis">{short(points[0].day)}</text>
      {points.length > 1 && <text x={W - PAD.r} y={H - 6} textAnchor="end" className="axis">{short(points[points.length - 1].day)}</text>}
      {points.length > 1 && <path d={line} className="avg-line" />}
      {points.map((p) => (
        <g key={p.id} onClick={() => onPick(p)} className="dot-hit">
          <circle cx={x(p.day)} cy={y(toUnit(p.kg))} r={14} fill="transparent" />
          <circle cx={x(p.day)} cy={y(toUnit(p.kg))} r={picked?.id === p.id ? 5.5 : 4} className={picked?.id === p.id ? "dot on" : "dot"} />
        </g>
      ))}
    </svg>
  );
}
