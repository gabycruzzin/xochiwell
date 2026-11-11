import type { Macros } from "./api";
import type { Entry } from "./db";

// The weekly report: a kind look back at the last 7 full days. Wording rules: celebrate what went well, offer at most
// one gentle suggestion, never shame, never call food or days "bad", and never mention weight.

export type DayEntries = { day: string; entries: Entry[] };
export type WeeklyReport = {
  from: string; to: string;
  headline: string; // one warm sentence for the top of the report
  days: { day: string; logged: boolean; kcal: number }[]; // all 7, oldest first
  daysLogged: number;
  avg: Macros; // per logged day
  wins: string[];
  tryNext: string;
};

const noon = (day: string) => new Date(`${day}T12:00:00`);
export const addDays = (day: string, by: number) => {
  const d = noon(day);
  d.setDate(d.getDate() + by);
  return d.toLocaleDateString("en-CA");
};
export const shortDate = (day: string) => noon(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// The 7 days the report covers: the week up to and including yesterday (Saturday's report covers Sat–Fri).
export const reportRange = (today: string) => ({ from: addDays(today, -7), to: addDays(today, -1) });

const sum = (entries: Entry[]): Macros => entries.reduce<Macros>(
  (a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }),
  { kcal: 0, protein: 0, carbs: 0, fat: 0 },
);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildReport(days: DayEntries[], from: string, to: string, goals: Macros, targetsOn: boolean): WeeklyReport {
  const logged = days.filter((d) => d.entries.length > 0);
  const n = logged.length;
  const totals = logged.map((d) => sum(d.entries));
  const all = sum(logged.flatMap((d) => d.entries));
  const avg: Macros = n
    ? { kcal: Math.round(all.kcal / n), protein: Math.round(all.protein / n), carbs: Math.round(all.carbs / n), fat: Math.round(all.fat / n) }
    : { kcal: 0, protein: 0, carbs: 0, fat: 0 };

  const perDay = days.map((d) => ({ day: d.day, logged: d.entries.length > 0, kcal: Math.round(sum(d.entries).kcal) }));
  const headline = n >= 5 ? "What a steady week" : n >= 3 ? "A lovely week of check-ins" : n >= 1 ? "Every step counts" : "A fresh week ahead";

  if (!n) {
    return {
      from, to, headline, days: perDay, daysLogged: 0, avg, wins: [],
      tryNext: "No logs this week, and that's completely okay. Whenever you're ready, logging even one meal is a lovely place to start.",
    };
  }

  const wins: string[] = [];
  // Consistency always comes first: showing up is the habit everything else grows from.
  wins.push(n >= 5 ? `You logged ${n} of 7 days. That kind of consistency is what makes this work.`
    : n >= 3 ? `You checked in on ${n} days this week, and every one of them counts.`
    : `You logged on ${plural(n, "day")}. Showing up at all is a win.`);

  const proteinDays = targetsOn && goals.protein > 0 ? totals.filter((t) => t.protein >= goals.protein * 0.9).length : 0;
  // Protein is only celebrated when it's genuinely going well, so a "win" never reads like a low score.
  const proteinTarget = targetsOn && goals.protein > 0 ? goals.protein : 100;
  if (proteinDays > 0) wins.push(`You reached your protein goal on ${plural(proteinDays, "day")}.`);
  else if (avg.protein >= proteinTarget * 0.6) wins.push(`You averaged ${avg.protein} g of protein a day. Nice and steady.`);

  const foods = new Set(logged.flatMap((d) => d.entries.map((e) => e.name.toLowerCase()))).size;
  const breakfasts = logged.filter((d) => d.entries.some((e) => e.meal === "Breakfast")).length;
  const entries = logged.reduce((a, d) => a + d.entries.length, 0);
  if (foods >= 8) wins.push(`You enjoyed ${foods} different foods. Variety is great for you.`);
  else if (breakfasts >= 4) wins.push(`You started the day with breakfast on ${plural(breakfasts, "day")}.`);
  else wins.push(`You logged ${plural(entries, "food")} this week. Each one helps you see your patterns a little more clearly.`);

  // One gentle, specific suggestion, picked by what would help most.
  let tryNext = "Keep doing what you're doing. If you'd like something new, try adding one extra vegetable to a meal.";
  const aboveDays = targetsOn ? totals.filter((t) => t.kcal > goals.kcal * 1.15).length : 0;
  if (n <= 3) tryNext = "Try logging just one meal a day next week. Small check-ins add up to a clearer picture.";
  else if (targetsOn && goals.protein > 0 && avg.protein < goals.protein * 0.75)
    tryNext = "Protein came in a little under your goal. Adding eggs, Greek yogurt, beans or chicken to a meal or two could help.";
  else if (targetsOn && avg.kcal < goals.kcal * 0.75)
    tryNext = "Some days looked on the lighter side. Make sure you're eating enough to feel energized. Your body deserves the fuel.";
  else if (aboveDays >= 3)
    tryNext = "A few days ran above your target, which is completely normal. A filling afternoon snack can make evenings feel easier.";

  return { from, to, headline, days: perDay, daysLogged: n, avg, wins: wins.slice(0, 3), tryNext };
}

// Groups a range's entries into the 7 days, including days with nothing logged.
export function groupByDay(rows: (Entry & { day: string })[], from: string): DayEntries[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(from, i);
    return { day, entries: rows.filter((r) => r.day === day) };
  });
}
