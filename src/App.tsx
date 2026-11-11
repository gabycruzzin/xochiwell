import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Macros } from "./api";
import {
  supabase, DEFAULT_GOALS, NEW_PROFILE, type Entry, type NewEntry, type Profile,
  loadDay, addEntry, addEntries, removeEntry, countEntries, loadGoals, saveGoals, loadProfile, saveProfile,
  loadCustomServings, saveCustomServing, importLocalData, deleteAccount,
} from "./db";
import AddSheet from "./AddSheet";
import { MEALS, MacroText, servingLabel, sumMacros } from "./FoodSearch";
import Setup, { type SetupStep } from "./Setup";
import SignIn from "./SignIn";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
// Dates are handled at local noon so adding days never trips over daylight-saving changes.
const atNoon = (day: string) => new Date(`${day}T12:00:00`);
const shiftDay = (day: string, by: number) => {
  const d = atNoon(day);
  d.setDate(d.getDate() + by);
  return d.toLocaleDateString("en-CA");
};
// "Today", "Yesterday", "Tomorrow", or a short date like "Mon, Nov 9" (with the year if it isn't this year).
function dayName(day: string) {
  const diff = Math.round((atNoon(day).getTime() - atNoon(today()).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  const d = atNoon(day);
  return d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
}

// Previous / next day arrows around the day's name; tapping the name opens the calendar.
function DateBar({ date, onChange }: { date: string; onChange: (day: string) => void }) {
  return (
    <div className="date-nav">
      <div className="date-bar">
        <button className="ghost day-step" onClick={() => onChange(shiftDay(date, -1))} aria-label="Previous day">‹</button>
        <label className="day-name">
          {dayName(date)}
          {/* Invisible but covering the label, so a tap opens the native calendar; showPicker covers desktop browsers. */}
          <input type="date" value={date} aria-label="Pick a date" onChange={(e) => onChange(e.target.value || today())}
            onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* not supported; the native tap still works */ } }} />
        </label>
        <button className="ghost day-step" onClick={() => onChange(shiftDay(date, 1))} aria-label="Next day">›</button>
      </div>
      {/* Space is kept even when hidden, so the page doesn't shift when switching days. */}
      <button className="link back-today" onClick={() => onChange(today())} style={{ visibility: date === today() ? "hidden" : "visible" }}>
        back to today
      </button>
    </div>
  );
}
// The "want help setting goals?" offer appears once, after this many foods have been logged.
const GOALS_OFFER_AFTER = 3;

const Title = () => <h1><em>xochi</em>well</h1>;

// A short, friendly line for today. Never mentions missed days, and being above a target is framed as normal.
function greeting(entries: Entry[], total: Macros, goals: Macros, targetsOn: boolean) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Morning!" : hour < 18 ? "Hi there!" : "Evening!";
  if (!entries.length) return `${hello} Log something whenever it suits you.`;
  if (!targetsOn) return `Nice, ${entries.length} ${entries.length === 1 ? "thing" : "things"} logged today.`;
  if (total.kcal > goals.kcal) return "You're a bit above today's target. Totally normal, it's the week that matters.";
  if (goals.protein > 0) return `Nice going. You're at ${Math.round((total.protein / goals.protein) * 100)}% of your protein so far.`;
  return "Nice going, keep it up.";
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecked(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return (
      <main>
        <header><Title /></header>
        <section className="auth">
          <h2>Connect a database</h2>
          <p className="note">
            Diary entries are saved in Supabase. Copy <code>.env.example</code> to <code>.env.local</code>, fill in your
            project's URL and anon key, then restart the dev server. Setup steps are in the README.
          </p>
        </section>
      </main>
    );
  }
  if (!checked) return <main><header><Title /></header><p className="note">Loading…</p></main>;
  if (!session) return <main><header><Title /></header><SignIn /></main>;
  return <Tracker session={session} />;
}

function Tracker({ session }: { session: Session }) {
  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [goals, setGoals] = useState<Macros>(DEFAULT_GOALS);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [setupStart, setSetupStart] = useState<SetupStep | null>(null);
  const [customServings, setCustomServings] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null); // meal whose add sheet is open
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const closeSheet = useCallback(() => setAddingTo(null), []);
  // Which way the day just changed, so its content slides in from that side.
  const [slide, setSlide] = useState<"prev" | "next" | null>(null);
  const changeDay = (day: string) => {
    if (day === date) return;
    setSlide(day > date ? "next" : "prev"); // YYYY-MM-DD strings sort by date
    setEntries([]); // cleared in the same render, so the old day's foods never show under the new day's name
    setDate(day);
  };
  // A quick, clearly sideways swipe changes the day; anything more vertical is left to scrolling.
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const fromControl = (e.target as HTMLElement).closest(".sheet-backdrop, input, select, textarea");
    touchStart.current = fromControl ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && Date.now() - start.at < 700) changeDay(shiftDay(date, dx < 0 ? 1 : -1));
  };
  const goalsTimer = useRef<ReturnType<typeof setTimeout>>();

  const fail = (what: string) => (e: unknown) => {
    console.error(e);
    setNotice(`Couldn't ${what}. Check your connection and try again.`);
  };

  // On sign-in: bring over anything saved in this browser before accounts existed, then load the account.
  useEffect(() => {
    (async () => {
      const imported = await importLocalData();
      if (imported) setNotice(`Imported ${imported} diary ${imported === 1 ? "entry" : "entries"} saved in this browser.`);
      const [g, c, n] = await Promise.all([loadGoals(), loadCustomServings(), countEntries()]);
      let p: Profile | null;
      try {
        p = await loadProfile();
      } catch (e) {
        // Most likely a migration in supabase/migrations hasn't been run yet; keep the app usable with goals as before.
        console.error(e);
        setNotice("Goal setup needs a database update. Run the newest files in supabase/migrations in the Supabase SQL editor.");
        p = { ...NEW_PROFILE, setupChoice: "goals", targetsOn: true };
      }
      // People who used the app before setup existed already have goals, so skip the welcome screen for them.
      if (!p && g) {
        p = { ...NEW_PROFILE, setupChoice: "goals", targetsOn: true };
        saveProfile(p).catch(console.error);
      }
      setGoals(g ?? DEFAULT_GOALS);
      setCustomServings(c);
      setEntryCount(n);
      setProfile(p ?? NEW_PROFILE);
      setReady(true);
    })().catch(fail("load your account"));
  }, [session.user.id]);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    loadDay(date).then((rows) => current && setEntries(rows)).catch(fail("load this day's diary"));
    return () => { current = false; };
  }, [date, ready]);

  const total = sumMacros(entries);

  const add = (entry: NewEntry) => {
    const day = date;
    addEntry(day, entry)
      .then((saved) => {
        if (day === date) setEntries((list) => [...list, saved]);
        setEntryCount((n) => n + 1);
      })
      .catch(fail(`add ${entry.name}`));
  };
  // Copies an earlier meal's foods into the day being viewed, under the meal they're being added to.
  const copyMeal = (list: NewEntry[], meal: string) => {
    const day = date;
    return addEntries(day, list.map((e) => ({ ...e, meal })))
      .then((saved) => {
        if (day === date) setEntries((current) => [...current, ...saved]);
        setEntryCount((n) => n + saved.length);
      })
      .catch((e) => { fail("copy that meal")(e); throw e; });
  };
  const remove = (id: string) => {
    const before = entries;
    setEntries(entries.filter((e) => e.id !== id));
    setEntryCount((n) => n - 1);
    removeEntry(id).catch((e) => { setEntries(before); setEntryCount((n) => n + 1); fail("remove that entry")(e); });
  };
  const changeCustomServing = (foodId: string, grams: number, save: boolean) => {
    setCustomServings((c) => ({ ...c, [foodId]: grams }));
    if (save) saveCustomServing(foodId, grams).catch(fail("save that serving size"));
  };
  // Goals save shortly after you stop typing, so each keystroke isn't a write.
  const changeGoal = (k: keyof Macros, value: number) => {
    const next = { ...goals, [k]: value };
    setGoals(next);
    clearTimeout(goalsTimer.current);
    goalsTimer.current = setTimeout(() => saveGoals(next).catch(fail("save your goals")), 600);
  };
  const updateProfile = (next: Profile) => {
    setProfile(next);
    saveProfile(next).catch(fail("save your settings"));
  };
  const finishSetup = (next: Profile, newGoals?: Macros) => {
    updateProfile(next);
    if (newGoals) {
      setGoals(newGoals);
      saveGoals(newGoals).catch(fail("save your goals"));
    }
    setSetupStart(null);
  };

  if (!profile) return <main><header><Title /></header><p className="note">Loading…</p></main>;

  if (profile.setupChoice === null || setupStart) {
    return (
      <main>
        <header><Title /></header>
        <Setup start={setupStart ?? "welcome"} profile={profile} customServings={customServings}
          onCustomServing={changeCustomServing} onFinish={finishSetup} />
      </main>
    );
  }

  const targetsOn = profile.targetsOn;
  const showGoalsOffer = !targetsOn && !profile.goalsOfferDismissed && entryCount >= GOALS_OFFER_AFTER;
  const bars: [string, keyof Macros, string][] = [
    ["Calories", "kcal", "kcal"], ["Protein", "protein", "g"], ["Carbs", "carbs", "g"], ["Fat", "fat", "g"],
  ];

  return (
    <main onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header>
        <Title />
        <DateBar date={date} onChange={changeDay} />
      </header>
      {notice && <p className="note notice" role="status">{notice} <button className="link" onClick={() => setNotice("")}>Dismiss</button></p>}
      <div key={date} className={`day-content${slide ? ` from-${slide}` : ""}`}>
      {date === today() && <p className="greeting">{greeting(entries, total, goals, targetsOn)}</p>}

      <section className="totals">
        {bars.map(([label, k, unit]) => {
          if (!targetsOn) {
            return (
              <div key={k} className="stat" data-k={k}>
                <div className="row"><b>{label}</b><span>{Math.round(total[k])} {unit}</span></div>
              </div>
            );
          }
          const above = total[k] > goals[k];
          return (
            <div key={k} className="stat" data-k={k}>
              <div className="row"><b>{label}</b><span>{above && <em className="above">above target · </em>}{Math.round(total[k])} / {goals[k]} {unit}</span></div>
              <div className="bar"><i style={{ width: `${Math.min(100, (total[k] / goals[k]) * 100)}%` }} /></div>
            </div>
          );
        })}
        {targetsOn ? (
          <details>
            <summary>Edit daily goals</summary>
            <div className="goals">
              {bars.map(([label, k]) => (
                <label key={k}>{label}
                  <input type="number" min={0} value={goals[k]} onChange={(e) => changeGoal(k, Number(e.target.value))} />
                </label>
              ))}
            </div>
            <div className="goal-links">
              <button className="link" onClick={() => setSetupStart("reasons")}>redo guided setup</button>
              <button className="link" onClick={() => setSetupStart("typical")}>update my typical day</button>
              <button className="link" onClick={() => updateProfile({ ...profile, targetsOn: false })}>turn off targets</button>
            </div>
          </details>
        ) : (
          <div className="goal-links"><button className="link" onClick={() => setSetupStart("reasons")}>set goals</button></div>
        )}
      </section>
      {showGoalsOffer && (
        <p className="note notice offer">
          Want help setting goals? It takes about 2 minutes.{" "}
          <button className="link" onClick={() => setSetupStart("reasons")}>let's do it</button>{" "}
          <button className="link" onClick={() => updateProfile({ ...profile, goalsOfferDismissed: true })}>no thanks</button>
        </p>
      )}

      <section>
        <h2>Diary</h2>
        {MEALS.map((m) => {
          const items = entries.filter((e) => e.meal === m);
          const mealKcal = Math.round(sumMacros(items).kcal);
          return (
            <div key={m} className="meal-group">
              <div className="meal-head">
                <h3 className={`meal meal-${m.toLowerCase()}`}>{m}{items.length > 0 && <span className="meal-kcal"> · {mealKcal} kcal</span>}</h3>
                <button className="ghost add-btn" onClick={() => setAddingTo(m)} disabled={!ready} aria-label={`Add food to ${m}`}>+ add</button>
              </div>
              {items.length > 0 && (
                <ul className="list">
                  {items.map((e) => (
                    <li key={e.id}>
                      <div><b>{e.name}</b><small>{e.servings ? `${servingLabel(e.servings)} (${e.grams} ${e.unit})` : `${e.grams} ${e.unit}`}, <MacroText m={e} /></small></div>
                      <button className="ghost" onClick={() => remove(e.id)} aria-label={`Remove ${e.name}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>
      </div>
      <footer className="account">
        <p className="note">Signed in as {session.user.email}</p>
        {confirmDelete ? (
          <div className="confirm-delete" role="alert">
            <p>This permanently deletes your account, diary, goals and setup. It can't be undone.</p>
            <div className="controls">
              <button className="danger" disabled={deleting} onClick={() => {
                setDeleting(true);
                deleteAccount().catch((e) => { setDeleting(false); setConfirmDelete(false); fail("delete your account")(e); });
              }}>{deleting ? "Deleting…" : "Delete forever"}</button>
              <button className="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Keep my account</button>
            </div>
          </div>
        ) : (
          <div className="account-links">
            <button className="link" onClick={() => supabase!.auth.signOut()}>sign out</button>
            <button className="link" onClick={() => setConfirmDelete(true)}>delete account</button>
          </div>
        )}
      </footer>
      {addingTo && (
        <AddSheet meal={addingTo} date={date} customServings={customServings} onCustomServing={changeCustomServing}
          onAdd={add} onCopy={(list) => copyMeal(list, addingTo)} onClose={closeSheet} disabled={!ready} />
      )}
    </main>
  );
}
