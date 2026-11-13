// Turns the text read from a photo of a nutrition facts label into numbers for the "add your own food" form.
// The phone's text recognition returns pieces of text with their positions; pieces at the same height are joined
// back into the label's rows ("Total Fat" ... "8g" ... "10%") before the numbers are picked out.

// A piece of recognized text. x, y, w, h are fractions of the photo, measured from its bottom-left corner.
export type TextPiece = { text: string; x: number; y: number; w: number; h: number };

export type LabelValues = {
  servingLabel?: string; // e.g. "2/3 cup"
  servingAmount?: number;
  servingUnit?: "g" | "ml";
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

// Joins pieces that sit at the same height into one line each, top of the photo first, left to right.
export function toLines(pieces: TextPiece[]): string[] {
  const rows: { top: number; bottom: number; pieces: TextPiece[] }[] = [];
  for (const p of [...pieces].sort((a, b) => b.y + b.h / 2 - (a.y + a.h / 2))) {
    const mid = p.y + p.h / 2;
    const row = rows.find((r) => mid <= r.top && mid >= r.bottom);
    if (row) {
      row.pieces.push(p);
    } else {
      rows.push({ top: p.y + p.h * 0.85, bottom: p.y + p.h * 0.15, pieces: [p] });
    }
  }
  return rows.map((r) => r.pieces.sort((a, b) => a.x - b.x).map((p) => p.text.trim()).join(" "));
}

// Fixes the usual misreads around numbers: "Og" for 0g, "lg" for 1g, "8,5 g" for 8.5 g.
const clean = (line: string) => line
  .replace(/\b[oO](?=\s*m?g\b)/g, "0")
  .replace(/\b[lI](?=\s*m?g\b)/g, "1")
  .replace(/(\d),(\d)/g, "$1.$2")
  .replace(/\s+/g, " ")
  .trim();

type Amount = { value: number; unitless: boolean };

// The first amount after `from` in the line that isn't a % daily value or in mg.
function firstAmount(line: string, from = 0): Amount | undefined {
  const re = /(<\s*)?(\d+(?:\.\d+)?)\s*(mg|g|kcal|kj|ml)?\b(\s*%)?/gi;
  re.lastIndex = from;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[4]) continue; // a % daily value
    const unit = m[3]?.toLowerCase();
    if (unit === "mg" || unit === "kj") continue;
    return { value: m[1] ? 0 : Number(m[2]), unitless: !unit };
  }
  return undefined;
}

// The amount on the first line naming this nutrient, or on the line under it if that one starts with a number.
function nutrient(lines: string[], name: RegExp, skip?: RegExp): Amount | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = name.exec(lines[i]);
    if (!m || skip?.test(lines[i])) continue;
    const next = lines[i + 1];
    return firstAmount(lines[i], m.index + m[0].length) ?? (next && /^[<\d]/.test(next) ? firstAmount(next) : undefined);
  }
  return undefined;
}

function calories(lines: string[]): number | undefined {
  // European labels: "Energy 1046 kJ / 250 kcal".
  for (const l of lines) {
    const m = /(\d+(?:\.\d+)?)\s*kcal\b/i.exec(l);
    if (m) return Number(m[1]);
  }
  for (let i = 0; i < lines.length; i++) {
    const m = /\bcalories\b/i.exec(lines[i]);
    if (!m || /from\s+fat/i.test(lines[i])) continue;
    const n = firstAmount(lines[i], m.index + m[0].length) ?? (lines[i + 1] ? firstAmount(lines[i + 1]) : undefined);
    if (n) return n.value;
  }
  return undefined;
}

function serving(lines: string[]): Pick<LabelValues, "servingLabel" | "servingAmount" | "servingUnit"> {
  for (let i = 0; i < lines.length; i++) {
    const m = /serving\s*size:?/i.exec(lines[i]);
    if (!m) continue;
    let text = lines[i].slice(m.index + m[0].length).trim();
    if (!/\d/.test(text) && lines[i + 1]) text = lines[i + 1].trim(); // "Serving size" with the amount on the next line
    const size = /\(?\s*(?:about\s*)?(\d+(?:\.\d+)?)\s*(g|ml)\s*\)?/i.exec(text);
    const label = (size ? text.slice(0, size.index) : text).replace(/[\s(/]+$/, "").trim();
    return {
      servingLabel: label && label.length <= 40 ? label : undefined,
      servingAmount: size ? Number(size[1]) : undefined,
      servingUnit: size ? (size[2].toLowerCase() as "g" | "ml") : undefined,
    };
  }
  // European labels list values per 100 g (or 100 ml).
  for (const l of lines) {
    const m = /per\s*100\s*(g|ml)\b/i.exec(l);
    if (m) return { servingAmount: 100, servingUnit: m[1].toLowerCase() as "g" | "ml" };
  }
  return {};
}

// "8g" is often read as "89" (the g looks like a 9). When the numbers don't add up to the calories,
// try dropping that trailing 9 from amounts that came without a unit and keep whichever adds up best.
function fixTrailingNines(kcal: number, macros: { protein?: Amount; carbs?: Amount; fat?: Amount }) {
  const keys = (["protein", "carbs", "fat"] as const).filter((k) => {
    const a = macros[k];
    return a?.unitless && /\d9$/.test(String(a.value));
  });
  const value = (k: "protein" | "carbs" | "fat", drop: boolean) => {
    const v = macros[k]?.value ?? 0;
    return drop ? Math.floor(v / 10) : v;
  };
  let best = { miss: Infinity, drop: new Set<string>() };
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const drop = new Set(keys.filter((_, i) => mask & (1 << i)));
    const est = 4 * value("protein", drop.has("protein")) + 4 * value("carbs", drop.has("carbs")) + 9 * value("fat", drop.has("fat"));
    const miss = Math.abs(est - kcal);
    if (miss < best.miss - 1e-9) best = { miss, drop };
  }
  return { protein: value("protein", best.drop.has("protein")), carbs: value("carbs", best.drop.has("carbs")), fat: value("fat", best.drop.has("fat")) };
}

export function parseLabel(rawLines: string[]): LabelValues {
  const lines = rawLines.map(clean).filter(Boolean);
  const kcal = calories(lines);
  const amounts = {
    protein: nutrient(lines, /\bprotein[s]?\b/i),
    carbs: nutrient(lines, /\b(total\s+)?carb(ohydrate)?s?\b\.?/i),
    fat: nutrient(lines, /\b(total\s+)?fat\b/i, /\b(sat(urated|\.)?|trans|poly|mono)\b|calories\s+from|\bfat\s+cal/i),
  };
  const fixed = kcal ? fixTrailingNines(kcal, amounts) : { protein: amounts.protein?.value, carbs: amounts.carbs?.value, fat: amounts.fat?.value };
  return {
    ...serving(lines),
    kcal,
    protein: amounts.protein ? fixed.protein : undefined,
    carbs: amounts.carbs ? fixed.carbs : undefined,
    fat: amounts.fat ? fixed.fat : undefined,
  };
}
