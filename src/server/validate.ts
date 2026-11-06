import { parseHTML } from "linkedom";

// Mermaid sanitizes labels with DOMPurify, which needs a DOM; give it a tiny one in Node.
const { window } = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window, document: window.document, DOMParser: window.DOMParser, Element: window.Element });
const { default: mermaid } = await import("mermaid");

/** Returns null when the source parses, otherwise mermaid's error message. */
export async function validateMermaid(source: string): Promise<string | null> {
  try {
    await mermaid.parse(source);
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}
