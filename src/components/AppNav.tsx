"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { HeaderMenu } from "@/components/HeaderMenu";

type AppNavProps = {
  userEmail?: string;
  onLogout?: () => void;
  children?: ReactNode;
};

function pageTitleForPath(pathname: string): string {
  if (pathname.startsWith("/documents")) {
    return "Documents";
  }
  return "Chat with AI";
}

export function AppNav({ userEmail = "", onLogout, children }: AppNavProps) {
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const loggedIn = Boolean(userEmail);
  const isChat = pathname === "/";
  const isDocuments = pathname.startsWith("/documents");

  return (
    <header className="app-nav">
      <h1 className="app-nav-title">{pageTitleForPath(pathname)}</h1>
      {loggedIn ? (
        <div className="app-nav-right">
          <nav className="app-nav-links" aria-label="Main">
            <Link
              href="/"
              className={`header-nav-link ${isChat ? "header-nav-link--active" : ""}`}
              aria-current={isChat ? "page" : undefined}
            >
              Chat
            </Link>
            <Link
              href="/documents"
              className={`header-nav-link ${isDocuments ? "header-nav-link--active" : ""}`}
              aria-current={isDocuments ? "page" : undefined}
            >
              Documents
            </Link>
          </nav>
          {children}
          <HeaderMenu
            open={userMenuOpen}
            onOpenChange={setUserMenuOpen}
            title="Account"
            triggerText={userEmail}
          >
            <div className="header-menu-header" role="none">
              {userEmail}
            </div>
            <button
              type="button"
              className="header-menu-item"
              role="menuitem"
              onClick={() => {
                setUserMenuOpen(false);
                onLogout?.();
              }}
            >
              <svg
                className="header-menu-item-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Sign out
            </button>
          </HeaderMenu>
        </div>
      ) : null}
    </header>
  );
}
