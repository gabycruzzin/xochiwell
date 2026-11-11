import type { Macros } from "./api";

// Calories per gram, used to turn grams into each macro's share of the day's calories.
const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;
const PARTS: [keyof typeof KCAL_PER_GRAM, string][] = [["protein", "Protein"], ["carbs", "Carbs"], ["fat", "Fat"]];

const SIZE = 104, STROKE = 16, R = (SIZE - STROKE) / 2, CIRC = 2 * Math.PI * R;
const GAP = 2; // px of card color between segments

// Donut of where the day's calories come from (protein / carbs / fat), with names, shares and grams beside it.
export default function MacroChart({ total }: { total: Macros }) {
  const kcal = PARTS.map(([k]) => total[k] * KCAL_PER_GRAM[k]);
  const sum = kcal.reduce((a, b) => a + b, 0);
  const shares = kcal.map((c) => (sum ? c / sum : 0));
  // Whole percents that always add up to 100: round down, then give the leftover points to the largest remainders.
  const floors = shares.map((s) => Math.floor(s * 100));
  const leftover = sum ? 100 - floors.reduce((a, b) => a + b, 0) : 0;
  const pct = [...floors];
  shares.map((s, i) => [s * 100 - floors[i], i]).sort((a, b) => b[0] - a[0]).slice(0, leftover).forEach(([, i]) => pct[i]++);

  let offset = 0;
  const segments = PARTS.map(([k], i) => {
    const len = shares[i] * CIRC;
    const seg = { k, dash: Math.max(0, len - (shares[i] < 1 ? GAP : 0)), offset };
    offset += len;
    return seg;
  });

  const summary = sum
    ? `Calories by macro: ${PARTS.map(([, label], i) => `${label} ${pct[i]}%`).join(", ")}`
    : "No calories logged yet";

  return (
    <div className="macro-chart">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={summary}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--track)" strokeWidth={STROKE} />
        {sum > 0 && segments.map((s) => s.dash > 0 && (
          <circle key={s.k} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={`var(--c-${s.k})`} strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${CIRC}`} strokeDashoffset={-s.offset} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="macro-chart-center">{sum ? "macros" : "—"}</text>
        <text x="50%" y="62%" textAnchor="middle" className="macro-chart-sub">{sum ? "% of kcal" : "none yet"}</text>
      </svg>
      <ul className="macro-legend">
        {PARTS.map(([k, label], i) => (
          <li key={k}>
            <i style={{ background: `var(--c-${k})` }} />
            <span>{label}</span>
            <b>{sum ? `${pct[i]}%` : "–"}</b>
            <small>{Math.round(total[k])} g</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
