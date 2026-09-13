"use client";

import { useEffect, useRef, type ReactNode } from "react";

const ChevronIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M6 9l6 6 6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type HeaderMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible text in the trigger (e.g. current model or email) */
  triggerText: string;
  /** `title` on the trigger button */
  title: string;
  children: ReactNode;
  disabled?: boolean;
};

export function HeaderMenu({ open, onOpenChange, title, triggerText, children, disabled = false }: HeaderMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="header-menu" ref={ref}>
      <button
        type="button"
        className="header-menu-trigger"
        onClick={() => {
          if (!disabled) {
            onOpenChange(!open);
          }
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
      >
        <span className="header-menu-label">{triggerText}</span>
        <span className={`header-menu-chevron ${open ? "open" : ""}`} aria-hidden>
          <ChevronIcon />
        </span>
      </button>
      {open ? (
        <div className="header-menu-panel" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}
