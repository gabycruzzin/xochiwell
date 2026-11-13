import { createClient } from "@supabase/supabase-js";
import { PER_OZ, type CustomFoodValues, type Food, type Macros } from "./api";

// Set these in .env.local (see .env.example). The anon key is meant to be public; row level security
// in supabase/schema.sql is what keeps each user's data private.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

// grams is the logged amount in `unit` (g, or ml for drinks).
export type Entry = Macros & { id: string; name: string; grams: number; unit: string; servings: number | null; meal: string };
export type NewEntry = Omit<Entry, "id">;

export const DEFAULT_GOALS: Macros = { kcal: 2000, protein: 150, carbs: 200, fat: 65 };

const db = () => {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
};
const ENTRY_COLUMNS = "id, name, grams, unit, servings, meal, kcal, protein, carbs, fat";

export async function loadDay(day: string): Promise<Entry[]> {
  const { data, error } = await db().from("diary_entries").select(ENTRY_COLUMNS).eq("day", day).order("created_at");
  if (error) throw error;
  return data;
}

// Every entry from `from` to `to` (inclusive, YYYY-MM-DD), with its day.
export async function loadRange(from: string, to: string): Promise<(Entry & { day: string })[]> {
  const { data, error } = await db().from("diary_entries").select(`day, ${ENTRY_COLUMNS}`)
    .gte("day", from).lte("day", to).order("day").order("created_at");
  if (error) throw error;
  return data;
}

export async function addEntry(day: string, entry: NewEntry): Promise<Entry> {
  const { data, error } = await db().from("diary_entries").insert({ ...entry, day }).select(ENTRY_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function addEntries(day: string, entries: NewEntry[]): Promise<Entry[]> {
  const { data, error } = await db().from("diary_entries").insert(entries.map((e) => ({ ...e, day }))).select(ENTRY_COLUMNS);
  if (error) throw error;
  return data;
}

// One meal as it was logged on an earlier day, for copying into another day.
export type PastMeal = { day: string; entries: NewEntry[] };

// The most recent earlier days that have this meal logged, newest first (at most `limit` days).
export async function loadPastMeals(meal: string, beforeDay: string, limit = 5): Promise<PastMeal[]> {
  const { data, error } = await db().from("diary_entries")
    .select(`day, ${ENTRY_COLUMNS}`)
    .eq("meal", meal).lt("day", beforeDay)
    .order("day", { ascending: false }).order("created_at")
    .limit(80); // a few days' worth of entries; grouped into days below
  if (error) throw error;
  const byDay = new Map<string, NewEntry[]>();
  for (const { day, id: _id, ...entry } of data) {
    if (!byDay.has(day) && byDay.size === limit) break;
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }
  return [...byDay].map(([day, entries]) => ({ day, entries }));
}

// Signs in from an email link that opened the app (xochiwell://auth…). Supabase puts either a one-time code in the
// query (PKCE) or the session tokens in the #fragment, or an error if the link expired or was already used.
// Resolves to "recovery" for a reset-password link, so the app can ask for the new password.
export async function signInFromLink(url: string): Promise<"recovery" | "signed-in"> {
  const [beforeHash, hash = ""] = url.split("#");
  const query = new URLSearchParams(beforeHash.split("?")[1] ?? ""), frag = new URLSearchParams(hash);
  const code = query.get("code");
  const access_token = frag.get("access_token"), refresh_token = frag.get("refresh_token");
  const failed = frag.get("error_description") ?? query.get("error_description");
  if (failed) throw new Error(`${failed.replace(/\+/g, " ")}. Sign in below, or ask for a new link.`);
  const { error } = code ? await db().auth.exchangeCodeForSession(code)
    : access_token && refresh_token ? await db().auth.setSession({ access_token, refresh_token })
    : { error: null };
  if (error) throw error;
  return frag.get("type") === "recovery" || query.get("type") === "recovery" ? "recovery" : "signed-in";
}

// A food rebuilt from a diary entry, so things you've logged before can be found and added again.
// Entries store the amount logged and its totals, so the per-100 g numbers are worked back from those.
export function recentFromEntry(e: Pick<Entry, "name" | "grams" | "unit" | "servings"> & Macros): Food | null {
  const base = e.unit === "oz" ? "g" : e.unit === "fl oz" ? "ml" : e.unit;
  const amount = Number(e.grams) * (base === e.unit ? 1 : PER_OZ[base]);
  if (!(amount > 0) || !PER_OZ[base]) return null;
  const per = (v: number) => Math.round((Number(v) * 1000) / amount) / 10;
  const serving = Math.round(e.servings ? amount / Number(e.servings) : amount);
  return {
    id: `recent:${e.name.trim().toLowerCase()}`,
    name: e.name,
    recent: true,
    per100g: { kcal: Math.round((Number(e.kcal) * 100) / amount), protein: per(e.protein), carbs: per(e.carbs), fat: per(e.fat) },
    // One serving is the serving you logged, or the whole amount if you logged it by weight.
    serving: { amount: serving, unit: base, label: e.servings || base === e.unit ? `${serving} ${base}` : `${e.grams} ${e.unit} (${serving} ${base})` },
  };
}

// Foods from your recent diary entries (one per name), the ones you log most often first.
export async function loadRecentFoods(): Promise<Food[]> {
  const { data, error } = await db().from("diary_entries")
    .select("name, grams, unit, servings, kcal, protein, carbs, fat")
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  const byName = new Map<string, { food: Food; count: number }>();
  for (const e of data) {
    const key = e.name.trim().toLowerCase();
    const seen = byName.get(key);
    if (seen) { seen.count++; continue; }
    const food = recentFromEntry(e);
    if (food) byName.set(key, { food, count: 1 });
  }
  return [...byName.values()].sort((a, b) => b.count - a.count).map((x) => x.food); // stable: ties stay newest first
}

// A food you add yourself, with the numbers for one serving as the label prints them.
export type NewCustomFood = CustomFoodValues;
type CustomFoodRow = Macros & { id: string; name: string; serving_label: string | null; serving_amount: number; serving_unit: string };
const CUSTOM_COLUMNS = "id, name, serving_label, serving_amount, serving_unit, kcal, protein, carbs, fat";

function customToFood(r: CustomFoodRow): Food {
  const amount = Number(r.serving_amount);
  const per = (v: number) => Math.round((Number(v) * 1000) / amount) / 10;
  const label = r.serving_label?.trim();
  return {
    id: `custom:${r.id}`,
    name: r.name,
    custom: {
      name: r.name, servingLabel: label ?? "", servingAmount: amount, servingUnit: r.serving_unit === "ml" ? "ml" : "g",
      kcal: Number(r.kcal), protein: Number(r.protein), carbs: Number(r.carbs), fat: Number(r.fat),
    },
    per100g: { kcal: per(r.kcal), protein: per(r.protein), carbs: per(r.carbs), fat: per(r.fat) },
    serving: { amount, unit: r.serving_unit, label: label ? `${label} (${amount} ${r.serving_unit})` : `${amount} ${r.serving_unit}` },
  };
}

// Your own foods, newest first. Empty (rather than an error) if the custom_foods table hasn't been created yet.
export async function loadCustomFoods(): Promise<Food[]> {
  const { data, error } = await db().from("custom_foods").select(CUSTOM_COLUMNS).order("created_at", { ascending: false });
  if (error) { console.warn("Couldn't load your foods", error.message); return []; }
  return data.map(customToFood);
}

const customRow = (f: NewCustomFood) => ({
  name: f.name.trim(), serving_label: f.servingLabel.trim() || null, serving_amount: f.servingAmount, serving_unit: f.servingUnit,
  kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat,
});
const rowId = (foodId: string) => foodId.replace(/^custom:/, "");

export async function saveCustomFood(f: NewCustomFood): Promise<Food> {
  const { data, error } = await db().from("custom_foods").insert(customRow(f)).select(CUSTOM_COLUMNS).single();
  if (error) throw error;
  return customToFood(data);
}

// Changes one of your foods. Entries already in the diary keep the numbers they were logged with.
export async function updateCustomFood(foodId: string, f: NewCustomFood): Promise<Food> {
  const { data, error } = await db().from("custom_foods").update(customRow(f)).eq("id", rowId(foodId)).select(CUSTOM_COLUMNS).single();
  if (error) throw error;
  return customToFood(data);
}

// Removes one of your foods from search. Entries already in the diary stay.
export async function deleteCustomFood(foodId: string) {
  const { error } = await db().from("custom_foods").delete().eq("id", rowId(foodId));
  if (error) throw error;
}

export async function removeEntry(id: string) {
  const { error } = await db().from("diary_entries").delete().eq("id", id);
  if (error) throw error;
}

// null if this user has never saved goals.
export async function loadGoals(): Promise<Macros | null> {
  const { data, error } = await db().from("goals").select("kcal, protein, carbs, fat").maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveGoals(goals: Macros) {
  const { error } = await db().from("goals").upsert({ ...goals, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function countEntries(): Promise<number> {
  const { count, error } = await db().from("diary_entries").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export type Reason = "understand" | "energy" | "strength" | "lighter" | "fuel" | "balanced" | "unsure";
export type Activity = "low" | "moderate" | "high";
// A food in the "typical day" from setup. Stored on the profile, never counted in the diary.
export type TypicalItem = NewEntry;
export type Profile = {
  setupChoice: "log" | "goals" | null; // null until the welcome screen is answered
  reasons: Reason[];
  activity: Activity | null;
  targetsOn: boolean; // false = just track, with no goal bars
  goalsOfferDismissed: boolean;
  typicalDay: TypicalItem[] | null;
  weightTracking: boolean; // optional, off unless turned on in settings
  weightUnit: "lb" | "kg";
};
export const NEW_PROFILE: Profile = {
  setupChoice: null, reasons: [], activity: null, targetsOn: false, goalsOfferDismissed: false, typicalDay: null,
  weightTracking: false, weightUnit: "lb",
};

// null if this user has no profile yet.
export async function loadProfile(): Promise<Profile | null> {
  // "*" so a profile still loads before newer columns (like weight_tracking) exist in the database.
  const { data, error } = await db().from("profiles").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    setupChoice: data.setup_choice, reasons: data.reasons ?? [], activity: data.activity, targetsOn: data.targets_on,
    goalsOfferDismissed: data.goals_offer_dismissed, typicalDay: data.typical_day,
    weightTracking: data.weight_tracking ?? false, weightUnit: data.weight_unit === "kg" ? "kg" : "lb",
  };
}

export async function saveProfile(p: Profile) {
  const { error } = await db().from("profiles").upsert({
    setup_choice: p.setupChoice, reasons: p.reasons, activity: p.activity, targets_on: p.targetsOn,
    goals_offer_dismissed: p.goalsOfferDismissed, typical_day: p.typicalDay,
    weight_tracking: p.weightTracking, weight_unit: p.weightUnit, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Permanently deletes the signed-in user and all their data (see delete_my_account in supabase/schema.sql), then signs out.
export async function deleteAccount() {
  const { error } = await db().rpc("delete_my_account");
  if (error) throw error;
  await db().auth.signOut();
}

export async function loadCustomServings(): Promise<Record<string, number>> {
  const { data, error } = await db().from("custom_servings").select("food_id, grams");
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.food_id, Number(r.grams)]));
}

export async function saveCustomServing(foodId: string, grams: number) {
  const { error } = await db().from("custom_servings").upsert({ food_id: foodId, grams });
  if (error) throw error;
}

// What older versions of the app kept in this browser's localStorage.
type LocalEntry = Macros & { name: string; grams: number; unit?: string; servings?: number; meal: string };
const IMPORT_FLAG = "importedLocalData";

// Copies diary, goals and custom serving sizes saved in this browser into the signed-in account, once per browser.
// Returns how many diary entries were imported (0 if there was nothing to import or it already happened).
export async function importLocalData(): Promise<number> {
  try {
    if (localStorage.getItem(IMPORT_FLAG)) return 0;
    const diary = JSON.parse(localStorage.getItem("diary") ?? "{}") as Record<string, LocalEntry[]>;
    const goals = JSON.parse(localStorage.getItem("goals") ?? "null") as Macros | null;
    const custom = JSON.parse(localStorage.getItem("customServings") ?? "{}") as Record<string, number>;

    const rows = Object.entries(diary).flatMap(([day, entries]) =>
      entries.map((e) => ({
        day, meal: e.meal, name: e.name, grams: e.grams, unit: e.unit ?? "g", servings: e.servings ?? null,
        kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat,
      })),
    );
    if (rows.length) {
      const { error } = await db().from("diary_entries").insert(rows);
      if (error) throw error;
    }
    // Keep the old data as a backup, but never import the diary twice, even if a step below fails.
    localStorage.setItem(IMPORT_FLAG, new Date().toISOString());
    if (goals) await saveGoals(goals);
    const servingRows = Object.entries(custom).map(([food_id, grams]) => ({ food_id, grams }));
    if (servingRows.length) {
      const { error } = await db().from("custom_servings").upsert(servingRows);
      if (error) throw error;
    }
    return rows.length;
  } catch (e) {
    console.error("Importing browser data failed", e);
    return 0;
  }
}

// Optional weight tracking. Stored in kg; shown in the person's unit.
export type WeighIn = { id: string; day: string; kg: number; note: string | null };
export const KG_PER_LB = 0.45359237;

export async function loadWeights(): Promise<WeighIn[]> {
  const { data, error } = await db().from("weights").select("id, day, kg, note").order("day");
  if (error) throw error;
  return data.map((w) => ({ ...w, kg: Number(w.kg) }));
}

// One weigh-in per day: saving again for the same day replaces it.
export async function saveWeight(day: string, kg: number, note: string | null): Promise<WeighIn> {
  const { data, error } = await db().from("weights").upsert({ day, kg, note }, { onConflict: "user_id,day" })
    .select("id, day, kg, note").single();
  if (error) throw error;
  return { ...data, kg: Number(data.kg) };
}

export async function deleteWeight(id: string) {
  const { error } = await db().from("weights").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteAllWeights() {
  const { error } = await db().from("weights").delete().not("id", "is", null); // RLS limits this to the person's own rows
  if (error) throw error;
}
