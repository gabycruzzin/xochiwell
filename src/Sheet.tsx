import { useEffect, type ReactNode } from "react";

// A panel that slides up over the page. "done", the backdrop or Escape closes it, and the page behind doesn't scroll.
export default function Sheet({ title, onClose, className = "", children }: {
  title: ReactNode; onClose: () => void; className?: string; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose}>done</button>
        </div>
        {children}
      </div>
    </div>
  );
}
