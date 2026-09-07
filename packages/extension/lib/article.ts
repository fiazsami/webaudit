import { Readability } from "@mozilla/readability";
import type { ExtractedArticle } from "core";
import TurndownService from "turndown";

/**
 * Readable-text extraction for the browser host (docs/05 stage 3).
 *
 * The same job the CLI does with linkedom, done with the browser's own
 * `DOMParser`. Readability strips navigation and boilerplate; turndown converts
 * what remains to markdown with its headings intact, because headings are what
 * the chunker splits on.
 *
 * Parsing happens in a detached document, so nothing here executes scripts or
 * loads subresources from the policy page — it is markup being read, not a page
 * being rendered.
 */
export function extractArticle(
  html: string,
  url: string,
): ExtractedArticle | undefined {
  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return undefined;
  }

  // Readability resolves relative links against the document's base URL, which
  // a parsed string does not have.
  try {
    const base = document.createElement("base");
    base.href = url;
    document.head.append(base);
  } catch {
    // A document with no head is one Readability will reject anyway.
  }

  // Readability's own result type is what it is; let it be inferred rather than
  // restating it here and drifting from it.
  let article;
  try {
    // It mutates the document it is given, which is why it gets a freshly
    // parsed one rather than a shared handle.
    article = new Readability(document).parse();
  } catch {
    return undefined;
  }

  const content = article?.content;
  if (content == null || content.trim() === "") return undefined;

  return { title: article?.title ?? "", markdown: toMarkdown(content) };
}

export function toMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // A policy's tables carry substance — data categories, retention periods —
  // and turndown drops them by default.
  turndown.keep(["table"]);

  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
