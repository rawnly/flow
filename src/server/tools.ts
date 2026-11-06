import { z } from "zod";
import { addRevision, createDiagram, getDiagram, listDiagrams, setFeedbackStatus, type Diagram } from "./store.js";
import { validateMermaid } from "./validate.js";
import { viewerUrl } from "./http.js";

export type ToolResult = { text: string; isError?: boolean; diagramId?: string };
export type FlowTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (args: any, author: string, session?: string) => Promise<ToolResult>;
};

const ok = (text: string, diagramId?: string): ToolResult => ({ text, diagramId });
const fail = (text: string): ToolResult => ({ text, isError: true });

const STYLE_HINT = `Style: one node per component with a short bold title and an optional subtitle on a second line, e.g. A["Worker<br/>rate bound, daily cap"]. The viewer highlights what changed since the previous revision automatically; do not add your own colors or classDefs.`;

const openFeedback = (d: Diagram) => d.feedback.filter((f) => f.status === "open");

export const summary = (d: Diagram) => {
  const r = d.revisions.at(-1)!;
  const open = openFeedback(d).length;
  return `"${d.title}" (id: ${d.id}) is at revision ${r.n}. ${open} open feedback item${open === 1 ? "" : "s"}. Viewer: ${viewerUrl(d.id)}`;
};

export const formatFeedback = (items: Diagram["feedback"]) =>
  items
    .map(
      (f) =>
        `- [${f.id}] ${f.status === "open" ? "OPEN" : `resolved in r${f.resolvedIn}`} · ${
          f.nodeId ? `node "${f.nodeId}"${f.nodeLabel ? ` (${f.nodeLabel})` : ""}` : "whole diagram"
        } · on r${f.revision}\n  ${f.text.replace(/\n/g, "\n  ")}`,
    )
    .join("\n");

export const tools: FlowTool[] = [
  {
    name: "create_diagram",
    description: `Create a Mermaid diagram the human can watch live in the Flow viewer. Source is validated; invalid Mermaid is rejected with the parser error. ${STYLE_HINT}`,
    shape: {
      title: z.string().min(1).max(120).describe("Human-readable title"),
      source: z.string().min(1).max(200_000).describe("Mermaid source"),
      note: z.string().max(500).optional().describe("One line describing this revision"),
    },
    async run({ title, source, note }, author, session) {
      const err = await validateMermaid(source);
      if (err) return fail(`Mermaid did not parse, nothing was saved:\n${err}`);
      const d = await createDiagram(title, source, author, note, session);
      return ok(`Created. ${summary(d)}`, d.id);
    },
  },
  {
    name: "update_diagram",
    description: `Save a new revision of a diagram (full source, not a patch). Call get_feedback first and address open items; then resolve_feedback for each one this revision fixes. ${STYLE_HINT}`,
    shape: {
      id: z.string().describe("Diagram id"),
      source: z.string().min(1).max(200_000).describe("Complete Mermaid source for the new revision"),
      note: z.string().max(500).optional().describe("One line describing what changed"),
      title: z.string().min(1).max(120).optional().describe("Rename the diagram"),
    },
    async run({ id, source, note, title }, author, session) {
      const prev = await getDiagram(id);
      if (!prev) return fail(`No diagram with id "${id}". Call list_diagrams.`);
      if (prev.revisions.at(-1)!.source === source && !title) return fail("Source is identical to the latest revision; nothing saved.");
      const err = await validateMermaid(source);
      if (err) return fail(`Mermaid did not parse, nothing was saved:\n${err}`);
      return ok(`Saved. ${summary(await addRevision(id, source, author, note, title, session))}`, id);
    },
  },
  {
    name: "list_diagrams",
    description: "List diagrams with their latest revision and open feedback count.",
    shape: {},
    async run() {
      const all = await listDiagrams();
      return ok(all.length ? all.map(summary).join("\n") : "No diagrams yet. Use create_diagram.");
    },
  },
  {
    name: "get_diagram",
    description: "Get a diagram's Mermaid source (latest, or a given revision) plus revision history.",
    shape: { id: z.string(), revision: z.number().int().positive().optional() },
    async run({ id, revision }) {
      const d = await getDiagram(id);
      if (!d) return fail(`No diagram with id "${id}".`);
      const r = revision ? d.revisions.find((x) => x.n === revision) : d.revisions.at(-1);
      if (!r) return fail(`Revision ${revision} does not exist; latest is ${d.revisions.at(-1)!.n}.`);
      const history = d.revisions.map((x) => `r${x.n}${x.note ? `: ${x.note}` : ""}`).join("\n");
      return ok(`${summary(d)}\n\nRevision ${r.n} source:\n\`\`\`mermaid\n${r.source}\n\`\`\`\n\nHistory:\n${history}`, id);
    },
  },
  {
    name: "get_feedback",
    description: "Read the human's feedback on a diagram. Each item is anchored to a node id (or the whole diagram).",
    shape: { id: z.string(), includeResolved: z.boolean().optional() },
    async run({ id, includeResolved }) {
      const d = await getDiagram(id);
      if (!d) return fail(`No diagram with id "${id}".`);
      const items = includeResolved ? d.feedback : openFeedback(d);
      if (!items.length) return ok(`No ${includeResolved ? "" : "open "}feedback on "${d.title}".`, id);
      return ok(formatFeedback(items), id);
    },
  },
  {
    name: "resolve_feedback",
    description: "Mark a feedback item resolved by the latest revision, with an optional short reply the human will see.",
    shape: { id: z.string(), feedbackId: z.string(), reply: z.string().max(1000).optional() },
    async run({ id, feedbackId, reply }) {
      try {
        return ok(`Resolved ${feedbackId}. ${summary(await setFeedbackStatus(id, feedbackId, "resolved", reply))}`, id);
      } catch (e: any) {
        return fail(e.message);
      }
    },
  },
];
