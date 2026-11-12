import { useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "./db";
import PasswordInput from "./PasswordInput";

// Where the "confirm your email" and "reset your password" links land: the iOS app itself, or this site in a browser. Both must be listed
// under Supabase → Authentication → URL Configuration → Redirect URLs.
export const CONFIRM_REDIRECT = Capacitor.isNativePlatform() ? "xochiwell://auth" : window.location.origin;

export default function SignIn({ notice = "" }: { notice?: string }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    setUnconfirmed(false);
    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: CONFIRM_REDIRECT });
      setBusy(false);
      // Same answer whether or not the email has an account, so the form can't be used to look up who's signed up.
      return setMessage(error ? error.message
        : "If there's an account for that email, we sent a link to reset your password. Check your inbox (and spam).");
    }
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

  // Each form starts empty, except "forgot password", which keeps the email you'd already typed.
  const switchTo = (next: typeof mode, keepEmail = false) => {
    setMode(next); setMessage(""); setUnconfirmed(false); setPassword("");
    if (!keepEmail) setEmail("");
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
      <h2>{mode === "in" ? "Sign in" : mode === "up" ? "Create your account" : "Reset your password"}</h2>
      <p className="note">{mode === "reset"
        ? "Enter the email you signed up with and we'll send you a link to choose a new password."
        : "Your food diary is saved to your account, so it's there on any device."}</p>
      <form onSubmit={submit}>
        <label>Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== "reset" && (
          <label>Password
            <PasswordInput key={mode} value={password} onChange={setPassword} autoComplete={mode === "in" ? "current-password" : "new-password"} />
          </label>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "One moment…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
        </button>
      </form>
      {(message || notice) && <p className="note" role="status">{message || notice}</p>}
      {unconfirmed && <button type="button" className="link" disabled={busy} onClick={resend}>Resend the verification email</button>}
      <div className="auth-links">
        {mode === "in" && <button type="button" className="link" onClick={() => switchTo("reset", true)}>Forgot password?</button>}
        <button type="button" className="link" onClick={() => switchTo(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New here? Create an account" : mode === "up" ? "Already have an account? Sign in" : "Back to sign in"}
        </button>
      </div>
    </section>
  );
}
