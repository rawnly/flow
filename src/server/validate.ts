import { parseHTML } from "linkedom";

let mermaid: Promise<typeof import("mermaid").default> | undefined;

// Loaded on first use: mermaid is heavy, and DOMPurify inside it needs a DOM in Node.
function load() {
  return (mermaid ??= (async () => {
    // DOMPurify captures the window at import time, so the DOM globals only exist during the import
    // and never leak into a host process (e.g. pi) that sniffs `typeof window`.
    const g = globalThis as any;
    const keys = ["window", "document", "DOMParser", "Element"] as const;
    const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
    const { window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(g, { window, document: window.document, DOMParser: window.DOMParser, Element: window.Element });
    try {
      return (await import("mermaid")).default;
    } finally {
      for (const [k, d] of saved) d ? Object.defineProperty(g, k, d) : delete g[k];
    }
  })());
}

/** Returns null when the source parses, otherwise mermaid's error message. */
export async function validateMermaid(source: string): Promise<string | null> {
  try {
    await (await load()).parse(source);
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}
