import { useEffect, useState } from "react";
import type { Macros } from "./api";
import { loadRange } from "./db";
import MacroChart from "./MacroChart";
import { buildReport, groupByDay, reportRange, shortDate, type WeeklyReport as Report } from "./report";

type Props = { today: string; goals: Macros; targetsOn: boolean; onClose: () => void };

// "your week": the last 7 full days, as a slide-up sheet. Opened from the Saturday notification or the weekend banner.
export default function WeeklyReport({ today, goals, targetsOn, onClose }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const { from, to } = reportRange(today);
    loadRange(from, to)
      .then((rows) => setReport(buildReport(groupByDay(rows, from), from, to, goals, targetsOn)))
      .catch((e) => { console.error(e); setFailed(true); });
  }, [today, goals, targetsOn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet report" role="dialog" aria-modal="true" aria-label="Your weekly report" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="report-kicker">your week</span>
          <button className="link" onClick={onClose}>done</button>
        </div>
        {failed && <p className="note">Couldn't load your week. Check your connection and try again.</p>}
        {!report && !failed && <p className="note">Putting your week together…</p>}
        {report && (
          <>
            <div className="report-hero">
              <Flower />
              <div>
                <h2>{report.headline}</h2>
                <p className="note">{shortDate(report.from)} – {shortDate(report.to)}</p>
              </div>
            </div>

            {/* Week at a glance: a filled dot for each day with something logged. */}
            <ol className="week-strip" aria-label={`${report.daysLogged} of 7 days logged`}>
              {report.days.map((d) => (
                <li key={d.day} className={d.logged ? "on" : ""}>
                  <span>{new Date(`${d.day}T12:00:00`).toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                  <i aria-hidden="true">{d.logged ? "✓" : ""}</i>
                  <small>{d.logged ? d.kcal : "–"}</small>
                </li>
              ))}
            </ol>

            <div className="report-stats">
              <div data-k="days"><b>{report.daysLogged}<small>/7</small></b><span>days logged</span></div>
              <div data-k="kcal"><b>{report.avg.kcal}</b><span>avg kcal</span></div>
              <div data-k="protein"><b>{report.avg.protein}<small> g</small></b><span>avg protein</span></div>
            </div>

            {report.daysLogged > 0 && (
              <section className="report-block">
                <h3>your average day</h3>
                <MacroChart total={report.avg} />
              </section>
            )}

            {report.wins.length > 0 && (
              <section className="report-block">
                <h3>what went well</h3>
                <ul className="wins">{report.wins.map((w) => <li key={w}><i aria-hidden="true">✓</i><span>{w}</span></li>)}</ul>
              </section>
            )}

            <section className="report-block try-card">
              <h3>{report.daysLogged ? "one thing to try" : "a gentle note"}</h3>
              <p>{report.tryNext}</p>
            </section>
            <p className="report-signoff">Be proud of yourself this week. 🌸</p>
          </>
        )}
      </div>
    </div>
  );
}

// The Xochiwell flower: four petals, one per nutrient color, as on the app icon.
function Flower() {
  const petal = "M50 46 C 65 32, 62 9, 50 9 C 38 9, 35 32, 50 46 Z";
  return (
    <svg className="report-flower" viewBox="0 0 100 100" aria-hidden="true">
      {["kcal", "protein", "carbs", "fat"].map((k, i) => (
        <path key={k} d={petal} fill={`var(--c-${k})`} transform={`rotate(${45 + i * 90} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="7" fill="var(--card)" />
    </svg>
  );
}
