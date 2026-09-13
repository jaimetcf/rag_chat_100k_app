"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AppNav } from "@/components/AppNav";
import { HeaderMenu } from "@/components/HeaderMenu";
import { LLM_MODEL_CHOICES } from "@/lib/models";
import type { SessionItem, ThreadMessage } from "@/types/chat";

type AuthPanel = "login" | "register";

const CHAT_SCROLL_ID = "chat-scroll";

async function readJsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Request failed.");
  }
  return data;
}

export default function Home() {
  const [authPanel, setAuthPanel] = useState<AuthPanel>("login");
  const [authError, setAuthError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerTermsAccepted, setRegisterTermsAccepted] = useState(true);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [sessionsSidebarCollapsed, setSessionsSidebarCollapsed] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [llmModel, setLlmModel] = useState<string>(LLM_MODEL_CHOICES[0]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const threadMessagesRef = useRef<ThreadMessage[]>(threadMessages);
  useEffect(() => {
    threadMessagesRef.current = threadMessages;
  }, [threadMessages]);

  const hasThreadMessages = threadMessages.length > 0;
  const askDisabled = isLoading || !question.trim();
  const chatInputDisabled = isLoading;
  const showTypingIndicator = useMemo(() => {
    if (!isLoading) {
      return false;
    }
    if (!threadMessages.length) {
      return true;
    }
    const last = threadMessages[threadMessages.length - 1];
    if (last.role !== "assistant") {
      return true;
    }
    return !last.content.trim();
  }, [isLoading, threadMessages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = document.getElementById(CHAT_SCROLL_ID);
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  };

  const loadMessages = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    const data = await readJsonOrThrow(res);
    setCurrentSessionId(sessionId);
    setThreadMessages((data.messages ?? []) as ThreadMessage[]);
  };

  const refreshSessions = async () => {
    const res = await fetch("/api/sessions");
    const data = await readJsonOrThrow(res);
    setSessions((data.sessions ?? []) as SessionItem[]);
    return (data.sessions ?? []) as SessionItem[];
  };

  const syncMe = async () => {
    const res = await fetch("/api/me");
    const data = await readJsonOrThrow(res);
    if (!data.loggedIn) {
      setLoggedIn(false);
      setCurrentUserEmail("");
      setSessions([]);
      setCurrentSessionId("");
      setThreadMessages([]);
      return;
    }
    setLoggedIn(true);
    setCurrentUserEmail(String(data.email ?? ""));
    const nextSessions = await refreshSessions();
    if (nextSessions.length > 0) {
      await loadMessages(nextSessions[0].id);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const res = await fetch("/api/me");
      const data = await readJsonOrThrow(res);
      if (cancelled) {
        return;
      }
      if (!data.loggedIn) {
        setLoggedIn(false);
        setCurrentUserEmail("");
        setSessions([]);
        setCurrentSessionId("");
        setThreadMessages([]);
        return;
      }
      setLoggedIn(true);
      setCurrentUserEmail(String(data.email ?? ""));
      const sessionsRes = await fetch("/api/sessions");
      const sessionsData = await readJsonOrThrow(sessionsRes);
      if (cancelled) {
        return;
      }
      const nextSessions = (sessionsData.sessions ?? []) as SessionItem[];
      setSessions(nextSessions);
      if (nextSessions.length > 0) {
        const messagesRes = await fetch(`/api/sessions/${nextSessions[0].id}`);
        const messagesData = await readJsonOrThrow(messagesRes);
        if (cancelled) {
          return;
        }
        setCurrentSessionId(nextSessions[0].id);
        setThreadMessages((messagesData.messages ?? []) as ThreadMessage[]);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [threadMessages, showTypingIndicator]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 47.99rem)");
    const syncSidebar = () => setSessionsSidebarCollapsed(mq.matches);
    syncSidebar();
    mq.addEventListener("change", syncSidebar);
    return () => mq.removeEventListener("change", syncSidebar);
  }, []);

  const handleLogin = async () => {
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });
      await readJsonOrThrow(res);
      setLoginPassword("");
      await syncMe();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRegister = async () => {
    setAuthError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerEmail,
          password: registerPassword,
          displayName: registerDisplayName,
          termsAccepted: registerTermsAccepted,
        }),
      });
      await readJsonOrThrow(res);
      setRegisterPassword("");
      await syncMe();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  const logout = async () => {
    setModelMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthPanel("login");
    setAuthError("");
    setRegisterTermsAccepted(true);
    setSessionsSidebarCollapsed(false);
    await syncMe();
  };

  const createEmptySession = async () => {
    setAuthError("");
    if (!loggedIn) {
      setAuthError("You must be signed in.");
      return;
    }
    setIsCreatingSession(true);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await readJsonOrThrow(res);
      const newSessionId = String(data.sessionId ?? "");
      await refreshSessions();
      if (newSessionId) {
        setCurrentSessionId(newSessionId);
      }
      setThreadMessages([]);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingSession(false);
    }
  };

  const confirmDeleteSession = async () => {
    const sid = pendingDeleteSessionId.trim();
    if (!sid) {
      return;
    }
    setIsDeletingSession(true);
    setAuthError("");
    try {
      const res = await fetch(`/api/sessions/${sid}`, { method: "DELETE" });
      await readJsonOrThrow(res);
      const wasCurrent = sid === currentSessionId;
      setPendingDeleteSessionId("");
      const nextSessions = await refreshSessions();
      if (wasCurrent) {
        setCurrentSessionId("");
        setThreadMessages([]);
        if (nextSessions.length > 0) {
          await loadMessages(nextSessions[0].id);
        }
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeletingSession(false);
    }
  };

  const answer = async () => {
    const nextQuestion = question.trim();
    if (!nextQuestion || isLoading) {
      return;
    }
    setIsLoading(true);
    try {
      setQuestion("");
      const localUserMessage: ThreadMessage = {
        id: `local-${crypto.randomUUID()}`,
        role: "user",
        content: nextQuestion,
        created_at: new Date().toISOString(),
        time_display: new Date().toLocaleTimeString("pt-BR", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      setThreadMessages((prev) => [...prev, localUserMessage]);
      scrollToBottom();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: nextQuestion,
          model: llmModel,
          sessionId: currentSessionId,
        }),
      });
      const data = await readJsonOrThrow(res);
      setCurrentSessionId(String(data.sessionId ?? currentSessionId));
      setThreadMessages((data.messages ?? threadMessagesRef.current) as ThreadMessage[]);
      await refreshSessions();
    } catch (error) {
      const content = `Unexpected error while getting response: ${
        error instanceof Error ? error.message : String(error)
      }`;
      setThreadMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${crypto.randomUUID()}`,
          role: "assistant",
          content,
          created_at: new Date().toISOString(),
          time_display: new Date().toLocaleTimeString("pt-BR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        },
      ]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  };

  const onSubmitInput = (event: FormEvent) => {
    event.preventDefault();
    void answer();
  };

  const onEnterSubmit =
    (handler: () => void) =>
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Enter") {
        event.preventDefault();
        handler();
      }
    };

  return (
    <div className="page-shell">
      <AppNav userEmail={loggedIn ? currentUserEmail : ""} onLogout={() => void logout()}>
        <HeaderMenu
          open={modelMenuOpen}
          onOpenChange={setModelMenuOpen}
          title="Model"
          triggerText={llmModel}
          disabled={isLoading}
        >
          <div className="header-menu-header" role="none">
            Model
          </div>
          {LLM_MODEL_CHOICES.map((model) => (
            <button
              key={model}
              type="button"
              className={`header-menu-item ${llmModel === model ? "header-menu-item--active" : ""}`}
              role="menuitem"
              onClick={() => {
                setLlmModel(model);
                setModelMenuOpen(false);
              }}
            >
              {model}
            </button>
          ))}
        </HeaderMenu>
      </AppNav>
      <div className="layout-row">
        {!loggedIn ? (
          <aside className="left-sidebar expanded auth-banner">
            <div className="brand-orb" aria-hidden />
            <h2 className="brand">RAG Chat</h2>
            <p className="muted">Sign in to save chats and manage sessions.</p>
          </aside>
        ) : sessionsSidebarCollapsed ? (
          <aside className="left-sidebar collapsed">
            <button
              type="button"
              className="ghost-btn sidebar-toggle-btn"
              aria-label="Show chat history"
              onClick={() => setSessionsSidebarCollapsed(false)}
            >
              <span className="sidebar-toggle-icon" aria-hidden>
                ›
              </span>
              <span className="sidebar-toggle-text">Chats</span>
            </button>
            <button
              type="button"
              className="ghost-btn"
              aria-label="New chat"
              onClick={() => void createEmptySession()}
              disabled={isCreatingSession}
            >
              +
            </button>
            <div className="spacer" />
            <button type="button" className="ghost-btn collapsed-logout" aria-label="Sign out" onClick={() => void logout()}>
              ⎋
            </button>
          </aside>
        ) : (
          <aside className="left-sidebar expanded">
            <div className="sidebar-header">
              <h3>Chat History</h3>
              <button
                type="button"
                className="ghost-btn sidebar-toggle-btn"
                aria-label="Hide chat history"
                onClick={() => setSessionsSidebarCollapsed(true)}
              >
                <span className="sidebar-toggle-icon" aria-hidden>
                  ‹
                </span>
                <span className="sidebar-toggle-text">Hide</span>
              </button>
            </div>
            <button
              type="button"
              className="primary-btn full primary-label-fg"
              onClick={() => void createEmptySession()}
              disabled={isCreatingSession}
            >
              {isCreatingSession ? "Creating..." : "New Chat"}
            </button>
            <div className="sessions-list">
              {sessions.length === 0 ? (
                <div className="empty-list">
                  <p className="muted">No conversations yet</p>
                  <small className="muted">Start a new chat to begin</small>
                </div>
              ) : (
                sessions.map((s) => (
                  <div key={s.id} className={`session-row ${currentSessionId === s.id ? "active" : ""}`}>
                    <button type="button" className="session-main" onClick={() => void loadMessages(s.id)}>
                      <span className="session-title">{s.title_short}</span>
                      <small className="muted">{s.updated_display}</small>
                    </button>
                    <button
                      type="button"
                      className="ghost-btn tiny"
                      aria-label={`Delete ${s.title_short}`}
                      onClick={() => setPendingDeleteSessionId(s.id)}
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        <main className="main-area">
          {!loggedIn ? (
            <section className="auth-wrap">
              <div className="card">
                {authPanel === "register" ? (
                  <>
                    <h2>Create an account</h2>
                    <label>Email address</label>
                    <input
                      placeholder="you@example.com"
                      type="email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      onKeyDown={onEnterSubmit(() => void handleRegister())}
                    />
                    <label>Password</label>
                    <input
                      placeholder="At least 8 characters"
                      type="password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      onKeyDown={onEnterSubmit(() => void handleRegister())}
                    />
                    <label>Display name (optional)</label>
                    <input
                      placeholder="How we greet you"
                      value={registerDisplayName}
                      onChange={(e) => setRegisterDisplayName(e.target.value)}
                      onKeyDown={onEnterSubmit(() => void handleRegister())}
                    />
                    <label className="terms">
                      <input
                        type="checkbox"
                        checked={registerTermsAccepted}
                        onChange={(e) => setRegisterTermsAccepted(e.target.checked)}
                      />
                      Agree to Terms and Conditions
                    </label>
                    <button type="button" className="primary-btn full" onClick={() => void handleRegister()}>
                      Register
                    </button>
                    {authError ? <div className="auth-error">{authError}</div> : null}
                    <p className="switch-auth">
                      Already registered?{" "}
                      <button className="link-btn" onClick={() => setAuthPanel("login")}>
                        Sign in
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    <h2>Sign in to your account</h2>
                    <label>Email address</label>
                    <input
                      placeholder="you@example.com"
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      onKeyDown={onEnterSubmit(() => void handleLogin())}
                    />
                    <label>Password</label>
                    <input
                      placeholder="Enter your password"
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={onEnterSubmit(() => void handleLogin())}
                    />
                    <button type="button" className="primary-btn full" onClick={() => void handleLogin()}>
                      Sign in
                    </button>
                    {authError ? <div className="auth-error">{authError}</div> : null}
                    <p className="switch-auth">
                      New here?{" "}
                      <button className="link-btn" onClick={() => setAuthPanel("register")}>
                        Sign up
                      </button>
                    </p>
                  </>
                )}
              </div>
            </section>
          ) : (
            <section className="chat-column-wrap">
              <div id={CHAT_SCROLL_ID} className="messages-scroll">
                {!hasThreadMessages ? (
                  <div className="empty-thread">
                    <div className="bot-icon">🤖</div>
                    <p className="muted">Start a conversation with your AI assistant</p>
                  </div>
                ) : (
                  threadMessages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="row user">
                        <div className="bubble question">
                          <div className="bubble-content">{m.content}</div>
                          <small className="muted">{m.time_display}</small>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="row assistant">
                        <div className="bubble answer">
                          <div className="bubble-content markdown">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                          <small className="muted">{m.time_display}</small>
                        </div>
                      </div>
                    )
                  )
                )}
                {showTypingIndicator ? (
                  <div className="row assistant">
                    <div className="bubble typing" aria-live="polite">
                      Thinking
                      <span className="typing-dots" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
              <form className="action-bar" onSubmit={onSubmitInput}>
                <input
                  value={question}
                  placeholder="Type your message..."
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={chatInputDisabled}
                />
                <button className="primary-btn send-btn primary-label-fg" type="submit" disabled={askDisabled}>
                  Send
                </button>
              </form>
            </section>
          )}
        </main>
      </div>

      {pendingDeleteSessionId ? (
        <div className="modal-overlay">
          <div className="modal-panel">
            <h3>Delete Session</h3>
            <p>Are you sure you want to delete this session? This action cannot be undone.</p>
            <div className="modal-actions">
              <button type="button" className="ghost-outline-btn" onClick={() => setPendingDeleteSessionId("")}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => void confirmDeleteSession()}
                disabled={isDeletingSession}
              >
                {isDeletingSession ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
