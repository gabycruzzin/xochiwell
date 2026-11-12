import { useState } from "react";
import type { Macros } from "./api";
import type { Profile } from "./db";
import Sheet from "./Sheet";

type Props = {
  email: string | undefined;
  profile: Profile;
  goals: Macros;
  onChangeGoal: (k: keyof Macros, value: number) => void;
  onUpdateProfile: (p: Profile) => void;
  onGuidedSetup: (start: "reasons" | "typical") => void;
  canNotify: boolean;
  weeklyOn: boolean;
  onToggleWeekly: (on: boolean) => void;
  onOpenReport: () => void;
  onOpenWeight: () => void;
  onDeleteWeights: () => Promise<void>;
  onChangePassword: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  onClose: () => void;
};

const GOALS: [keyof Macros, string, string][] = [["kcal", "Calories", "kcal"], ["protein", "Protein", "g"], ["carbs", "Carbs", "g"], ["fat", "Fat", "g"]];

// Everything that isn't the day's diary: goals, the weekly report, optional weight tracking and the account.
export default function Settings(p: Props) {
  const [confirm, setConfirm] = useState<"account" | "weights" | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action().then(() => setConfirm(null)).catch(() => {}).finally(() => setBusy(false));
  };

  return (
    <Sheet title="settings" onClose={p.onClose} className="settings">
      <section className="settings-group">
        <h3>your goals</h3>
        {p.profile.targetsOn ? (
          <>
            <div className="goals">
              {GOALS.map(([k, label, unit]) => (
                <label key={k}>{label} ({unit})
                  <input type="number" min={0} value={p.goals[k]} onChange={(e) => p.onChangeGoal(k, Number(e.target.value))} />
                </label>
              ))}
            </div>
            <div className="settings-links">
              <button className="link" onClick={() => p.onGuidedSetup("reasons")}>redo guided setup</button>
              <button className="link" onClick={() => p.onGuidedSetup("typical")}>update my typical day</button>
              <button className="link" onClick={() => p.onUpdateProfile({ ...p.profile, targetsOn: false })}>turn off targets</button>
            </div>
          </>
        ) : (
          <>
            <p className="note">Targets are off, so you're just tracking. That's a perfectly good way to use Xochiwell.</p>
            <div className="settings-links"><button className="link" onClick={() => p.onGuidedSetup("reasons")}>set goals</button></div>
          </>
        )}
      </section>

      <section className="settings-group">
        <h3>weekly report</h3>
        {p.canNotify && (
          <label className="toggle-row">
            <input type="checkbox" checked={p.weeklyOn} onChange={(e) => p.onToggleWeekly(e.target.checked)} />
            <span>Remind me every Saturday morning</span>
          </label>
        )}
        <div className="settings-links"><button className="link" onClick={p.onOpenReport}>view this week's report</button></div>
      </section>

      <section className="settings-group">
        <h3>weight <span className="optional">optional</span></h3>
        <label className="toggle-row">
          <input type="checkbox" checked={p.profile.weightTracking}
            onChange={(e) => p.onUpdateProfile({ ...p.profile, weightTracking: e.target.checked })} />
          <span>Track my weight</span>
        </label>
        {p.profile.weightTracking ? (
          <>
            <div className="unit-switch" role="radiogroup" aria-label="Weight unit">
              {(["lb", "kg"] as const).map((u) => (
                <button key={u} role="radio" aria-checked={p.profile.weightUnit === u} className={p.profile.weightUnit === u ? "on" : ""}
                  onClick={() => p.onUpdateProfile({ ...p.profile, weightUnit: u })}>{u}</button>
              ))}
            </div>
            <button className="open-weight" onClick={p.onOpenWeight}>Open weight log</button>
            {confirm === "weights" ? (
              <div className="confirm-delete" role="alert">
                <p>This permanently deletes every weigh-in you've logged. It can't be undone.</p>
                <div className="controls">
                  <button className="danger" disabled={busy} onClick={() => run(p.onDeleteWeights)}>{busy ? "Deleting…" : "Delete history"}</button>
                  <button className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Keep it</button>
                </div>
              </div>
            ) : (
              <div className="settings-links"><button className="link" onClick={() => setConfirm("weights")}>delete my weight history</button></div>
            )}
          </>
        ) : (
          <p className="note">Completely optional. Your weight stays private, never changes your goals, and turning this off hides it everywhere.</p>
        )}
      </section>

      <section className="settings-group">
        <h3>account</h3>
        <p className="note">Signed in as {p.email}</p>
        {confirm === "account" ? (
          <div className="confirm-delete" role="alert">
            <p>This permanently deletes your account, diary, goals, setup and weigh-ins. It can't be undone.</p>
            <div className="controls">
              <button className="danger" disabled={busy} onClick={() => run(p.onDeleteAccount)}>{busy ? "Deleting…" : "Delete forever"}</button>
              <button className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Keep my account</button>
            </div>
          </div>
        ) : (
          <div className="settings-links">
            <button className="link" onClick={p.onChangePassword}>change password</button>
            <button className="link" onClick={p.onSignOut}>sign out</button>
            <button className="link" onClick={() => setConfirm("account")}>delete account</button>
          </div>
        )}
      </section>
    </Sheet>
  );
}
