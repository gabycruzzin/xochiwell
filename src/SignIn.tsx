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
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    setUnconfirmed(false);
    const { data, error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: CONFIRM_REDIRECT } });
    setBusy(false);
    if (error) {
      // Supabase won't sign in an account whose email hasn't been confirmed yet.
      if (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message)) {
        setUnconfirmed(true);
        return setMessage("You haven't verified your email yet. Tap the link in the email we sent you, then sign in.");
      }
      if (error.code === "invalid_credentials") return setMessage("That email and password don't match. Try again?");
      return setMessage(error.message);
    }
    // With email confirmation on (Supabase's default), sign-up returns no session until the link is clicked.
    if (mode === "up" && !data.session) setMessage("Check your email for a link to confirm your account, then sign in.");
  };

  const resend = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: CONFIRM_REDIRECT } });
    setBusy(false);
    setMessage(error ? error.message : `Sent a new link to ${email}. Check your inbox (and spam).`);
    if (!error) setUnconfirmed(false);
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
          {/* Show lets you check what you typed, especially when creating a password. */}
          <span className="password-field">
            <input type={showPassword ? "text" : "password"} autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={6}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="link show-password" onClick={() => setShowPassword((v) => !v)}
              onMouseDown={(e) => e.preventDefault()} /* keep typing focus (and the phone keyboard) in the password box */
              aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "hide" : "show"}
            </button>
          </span>
        </label>
        <button type="submit" disabled={busy}>{busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
      </form>
      {(message || notice) && <p className="note" role="status">{message || notice}</p>}
      {unconfirmed && <button type="button" className="link" disabled={busy} onClick={resend}>Resend the verification email</button>}
      <button type="button" className="link" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMessage(""); setUnconfirmed(false); setEmail(""); setPassword(""); setShowPassword(false); }}>
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </section>
  );
}
