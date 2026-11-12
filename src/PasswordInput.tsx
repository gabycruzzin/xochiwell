import { useState } from "react";

// A password box with a "show" toggle, so you can check what you typed (especially a new password).
export default function PasswordInput({ value, onChange, autoComplete }: {
  value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password";
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="password-field">
      <input type={show ? "text" : "password"} autoComplete={autoComplete} required minLength={6}
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="link show-password" onClick={() => setShow((v) => !v)}
        onMouseDown={(e) => e.preventDefault()} /* keep typing focus (and the phone keyboard) in the password box */
        aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}>
        {show ? "hide" : "show"}
      </button>
    </span>
  );
}
