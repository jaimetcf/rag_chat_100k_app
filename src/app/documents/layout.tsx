import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documents · RAG Chat",
  description: "Upload and manage documents used for retrieval-augmented chat.",
};

export default function DocumentsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
