import { diagramsDir, listDiagrams, type Diagram } from "./store.js";
import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";

export const sourceBlock = (source: string) => "```mermaid\n" + source.trimEnd() + "\n```";

export const openFeedback = (d: Diagram) => d.feedback.filter((f) => f.status === "open");

export const formatFeedback = (items: Diagram["feedback"]) =>
  items
    .map(
      (f) =>
        `- [${f.id}] ${f.status === "open" ? "OPEN" : `resolved in r${f.resolvedIn}`} · ${
          f.kind === "edit"
            ? `the user edited the diagram themselves in r${f.revision} and asks you to adjust around it`
            : f.nodeId
              ? `node "${f.nodeId}"${f.nodeLabel ? ` (${f.nodeLabel})` : ""}`
              : "whole diagram"
        } · on r${f.revision}\n  ${f.text.replace(/\n/g, "\n  ")}`,
    )
    .join("\n");

/** Open feedback across diagrams (or one), formatted for an agent. Null when there is none. */
export async function pendingFeedbackReport(onlyId?: string): Promise<string | null> {
  const diagrams = (await listDiagrams()).filter((d) => (onlyId ? d.id === onlyId : true));
  const parts: string[] = [];
  for (const d of diagrams) {
    const open = openFeedback(d);
    if (!open.length) continue;
    const latest = d.revisions.at(-1)!;
    let block = `Diagram "${d.title}" (id: ${d.id}), latest r${latest.n}:\n${formatFeedback(open)}`;
    if (open.some((f) => f.kind === "edit"))
      block += `\n\nCurrent source (r${latest.n}, by ${latest.author}; keep the user's edits):\n${sourceBlock(latest.source)}`;
    parts.push(block);
  }
  return parts.length ? parts.join("\n\n") : null;
}

/** Cheap change detector: newest mtime of any diagram file. Viewer and other MCP processes write the same files. */
async function stamp(): Promise<number> {
  try {
    const names = (await readdir(diagramsDir())).filter((n) => n.endsWith(".json"));
    const times = await Promise.all(names.map((n) => stat(join(diagramsDir(), n)).then((s) => s.mtimeMs, () => 0)));
    return Math.max(0, ...times);
  } catch {
    return 0;
  }
}

/** Resolves with the report as soon as open feedback exists, or null after `timeoutMs`. */
export async function waitForFeedback(timeoutMs: number, onlyId?: string, signal?: AbortSignal): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (!signal?.aborted) {
    const s = await stamp();
    if (s !== last) {
      last = s;
      const report = await pendingFeedbackReport(onlyId);
      if (report) return report;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
