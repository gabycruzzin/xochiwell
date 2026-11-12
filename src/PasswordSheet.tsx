import { useState, type FormEvent } from "react";
import { supabase } from "./db";
import PasswordInput from "./PasswordInput";
import Sheet from "./Sheet";

// Set a new password: after tapping a reset link (already signed in by the link), or from Settings.
export default function PasswordSheet({ reason, onClose }: { reason: "reset" | "change"; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (!error) return setDone(true);
    if (error.code === "same_password") return setMessage("That's the password you already have. Choose a different one.");
    if (error.code === "weak_password") return setMessage("That password is too easy to guess. Try a longer one.");
    if (error.code === "reauthentication_needed" || error.code === "session_expired")
      return setMessage("For your security, sign out and use \"forgot password?\" to set a new one.");
    setMessage(error.message);
  };

  return (
    <Sheet title={reason === "reset" ? "new password" : "change password"} onClose={onClose} className="password-sheet">
      {done ? (
        <>
          <p className="note" role="status">Your password is updated. Use it next time you sign in.</p>
          <button onClick={onClose}>Done</button>
        </>
      ) : (
        <form className="auth-form" onSubmit={save}>
          <p className="note">{reason === "reset" ? "You're signed in. Choose a new password for your account." : "Choose a new password for your account."}</p>
          <label>New password
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
          </label>
          <button type="submit" disabled={busy || password.length < 6}>{busy ? "Saving…" : "Save password"}</button>
          {message && <p className="note" role="status">{message}</p>}
        </form>
      )}
    </Sheet>
  );
}
