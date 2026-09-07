import { Readability } from "@mozilla/readability";
import type { ExtractedArticle } from "core";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

/**
 * Readable-text extraction for the Node host (docs/05 stage 3).
 *
 * Readability strips navigation, banners and boilerplate; turndown converts
 * what is left to markdown. Headings survive both, which matters because they
 * are what the chunker splits on.
 *
 * Shared by both hosts in shape but not in code: the extension does the same
 * with the browser's own `DOMParser`. That is the point of it being a
 * capability (docs/01).
 */
export function extractArticle(
  html: string,
  url: string,
): ExtractedArticle | undefined {
  let document: unknown;
  try {
    ({ document } = parseHTML(html) as { document: unknown });
  } catch {
    return undefined;
  }

  // Readability's result type is what it is; let it be inferred rather than
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

  return { title: article?.title ?? "", markdown: toMarkdown(content, url) };
}

export function toMarkdown(html: string, url: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // A policy's tables carry substance — data categories, retention periods —
  // and turndown drops them by default.
  turndown.keep(["table"]);
  void url;

  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
