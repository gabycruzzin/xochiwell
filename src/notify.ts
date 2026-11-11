import { Capacitor } from "@capacitor/core";
import { LocalNotifications, Weekday } from "@capacitor/local-notifications";

// The Saturday-morning weekly report reminder. It's scheduled on the phone itself (no server), repeats every week,
// and opens the in-app report when tapped. The choice is remembered per device, since the schedule lives on the device.

export const canNotify = Capacitor.isNativePlatform();
const WEEKLY_ID = 1;
const PREF_KEY = "weeklyReportReminder";

export const weeklyReminderOn = () => {
  try { return localStorage.getItem(PREF_KEY) === "on"; } catch { return false; }
};

// Returns false if the person declined notification permission.
export async function setWeeklyReminder(on: boolean): Promise<boolean> {
  if (on) {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return false;
    await LocalNotifications.schedule({
      notifications: [{
        id: WEEKLY_ID,
        title: "Your week with Xochiwell 🌸",
        body: "Your weekly report is ready. Take a peek at what went well.",
        schedule: { on: { weekday: Weekday.Saturday, hour: 9, minute: 0 }, allowWhileIdle: true },
      }],
    });
  } else {
    await LocalNotifications.cancel({ notifications: [{ id: WEEKLY_ID }] });
  }
  try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* storage blocked; the schedule itself still stands */ }
  return true;
}

// Calls `open` when the person taps the weekly report notification.
export function onWeeklyReminderTap(open: () => void) {
  if (!canNotify) return () => {};
  const handle = LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
    if (a.notification.id === WEEKLY_ID) open();
  });
  return () => { handle.then((h) => h.remove()); };
}
