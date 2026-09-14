"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/components/AuthProvider";
import { formatFileSize } from "@/lib/formatting";
import { MAX_USER_DOCUMENTS } from "@/lib/documents-config";
import type { DocumentItem } from "@/types/documents";

async function readJsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Request failed.");
  }
  return data;
}

const ACCEPT = ".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm";

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M4 7h16M10 11v6M14 11v6M9 7l1-3h4l1 3M6 7l1 14h10l1-14"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const FileIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 3v5h5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function DocumentsPage() {
  const router = useRouter();
  const { isReady, loggedIn, email: currentUserEmail, logout: authLogout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [maxDocuments, setMaxDocuments] = useState(MAX_USER_DOCUMENTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DocumentItem | null>(null);

  const remaining = Math.max(0, maxDocuments - documents.length);
  const uploadDisabled = isUploading || isLoading || remaining <= 0;

  const loadDocuments = async () => {
    const res = await fetch("/api/documents");
    const data = await readJsonOrThrow(res);
    setDocuments((data.documents ?? []) as DocumentItem[]);
    if (typeof data.maxDocuments === "number") {
      setMaxDocuments(data.maxDocuments);
    }
  };

  useEffect(() => {
    if (!isReady) {
      return;
    }
    if (!loggedIn) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      try {
        await loadDocuments();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [isReady, loggedIn, router]);

  const onPickFiles = () => {
    fileInputRef.current?.click();
  };

  const onFilesSelected = async (fileList: FileList | null) => {
    if (!fileList?.length || uploadDisabled) {
      return;
    }
    setError("");
    setIsUploading(true);
    try {
      const selected = Array.from(fileList).slice(0, remaining);
      const form = new FormData();
      for (const file of selected) {
        form.append("files", file);
      }
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && typeof data?.error === "string") {
        throw new Error(data.error);
      }
      if (!res.ok) {
        throw new Error("Upload failed.");
      }
      setDocuments((data.documents ?? []) as DocumentItem[]);
      const uploadErrors = Array.isArray(data.errors) ? data.errors : [];
      if (uploadErrors.length) {
        setError(
          uploadErrors
            .map((item: { name?: string; error?: string }) => `${item.name ?? "File"}: ${item.error ?? "failed"}`)
            .join(" ")
        );
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }
    setIsDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/documents/${pendingDelete.id}`, { method: "DELETE" });
      const data = await readJsonOrThrow(res);
      setDocuments((data.documents ?? documents.filter((doc) => doc.id !== pendingDelete.id)) as DocumentItem[]);
      setPendingDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  const logout = async () => {
    await authLogout();
    router.replace("/");
  };

  if (!isReady || !loggedIn) {
    return (
      <div className="page-shell">
        <AppNav />
        <div className="page-loading muted">Loading documents…</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <AppNav userEmail={currentUserEmail} onLogout={() => void logout()} />
      <div className="layout-row">
        <main className="main-area">
          <section className="docs-column-wrap">
            <div className="docs-toolbar">
              <p className="docs-count">
                {documents.length} / {maxDocuments} documents
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(event) => void onFilesSelected(event.target.files)}
                aria-label="Choose documents to upload"
              />
              <button
                type="button"
                className="primary-btn primary-label-fg"
                onClick={onPickFiles}
                disabled={uploadDisabled}
              >
                {isUploading ? "Uploading..." : remaining <= 0 ? "Limit reached" : "Upload documents"}
              </button>
            </div>
            {error ? <div className="auth-error docs-error">{error}</div> : null}
            <div className="docs-list">
              {isLoading ? (
                <p className="muted">Loading documents…</p>
              ) : documents.length === 0 ? (
                <div className="empty-thread docs-empty">
                  <div className="bot-icon" aria-hidden>
                    📄
                  </div>
                  <p className="muted">No documents yet. Upload up to {maxDocuments} files to ground chat in your content.</p>
                </div>
              ) : (
                documents.map((doc) => (
                  <article key={doc.id} className="doc-card">
                    <div className="doc-card-icon" aria-hidden>
                      <FileIcon />
                    </div>
                    <div className="doc-card-main">
                      <h2 className="doc-card-name">{doc.name}</h2>
                      <p className="muted doc-card-meta">
                        {formatFileSize(doc.sizeBytes)}
                        {doc.createdDisplay ? ` · ${doc.createdDisplay}` : ""}
                        {doc.chunkCount ? ` · ${doc.chunkCount} chunks` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn tiny doc-trash"
                      aria-label={`Delete ${doc.name}`}
                      onClick={() => setPendingDelete(doc)}
                      disabled={isDeleting}
                    >
                      <TrashIcon />
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        </main>
      </div>

      {pendingDelete ? (
        <div className="modal-overlay">
          <div className="modal-panel">
            <h3>Delete document</h3>
            <p>
              Delete <strong>{pendingDelete.name}</strong> from storage and the search index? This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="ghost-outline-btn" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="danger-btn" onClick={() => void confirmDelete()} disabled={isDeleting}>
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
