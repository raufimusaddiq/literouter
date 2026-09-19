"use client";

import { MarkdownRenderer } from "@/utils/markdown";

export default function DocsContent({ content }) {
  return (
    <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <MarkdownRenderer content={content} />
      </article>
    </main>
  );
}
