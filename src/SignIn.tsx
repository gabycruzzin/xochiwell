import { useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "./db";

// Where the "confirm your email" link lands: the iOS app itself, or this site in a browser. Both must be listed
// under Supabase → Authentication → URL Configuration → Redirect URLs.
export const CONFIRM_REDIRECT = Capacitor.isNativePlatform() ? "xochiwell://auth" : window.location.origin;

export default function SignIn({ notice = "" }: { notice?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { data, error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: CONFIRM_REDIRECT } });
    setBusy(false);
    if (error) return setMessage(error.message);
    // With email confirmation on (Supabase's default), sign-up returns no session until the link is clicked.
    if (mode === "up" && !data.session) setMessage("Check your email for a link to confirm your account, then sign in.");
  };

  return (
    <section className="auth">
      <h2>{mode === "in" ? "Sign in" : "Create your account"}</h2>
      <p className="note">Your food diary is saved to your account, so it's there on any device.</p>
      <form onSubmit={submit}>
        <label>Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={6}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>{busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
      </form>
      {(message || notice) && <p className="note">{message || notice}</p>}
      <button type="button" className="link" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMessage(""); setEmail(""); setPassword(""); }}>
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </section>
  );
}
