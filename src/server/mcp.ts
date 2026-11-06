#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { addRevision, createDiagram, getDiagram, listDiagrams, setFeedbackStatus, type Diagram } from "./store.js";
import { validateMermaid } from "./validate.js";
import { startHttp, viewerUrl } from "./http.js";

const AUTHOR = process.env.FLOW_AGENT_NAME ?? "agent";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ ...text(t), isError: true });

const STYLE_HINT = `Style: one node per component with a short bold title and an optional subtitle on a second line, e.g. A["Worker<br/>rate bound, daily cap"]. The viewer highlights what changed since the previous revision automatically; do not add your own colors or classDefs.`;

const openFeedback = (d: Diagram) => d.feedback.filter((f) => f.status === "open");

const summary = (d: Diagram) => {
  const r = d.revisions.at(-1)!;
  const open = openFeedback(d).length;
  return `"${d.title}" (id: ${d.id}) is at revision ${r.n}. ${open} open feedback item${open === 1 ? "" : "s"}. Viewer: ${viewerUrl(d.id)}`;
};

const server = new McpServer({ name: "flow", version: "0.1.0" });

server.registerTool(
  "create_diagram",
  {
    description: `Create a Mermaid diagram the human can watch live in the Flow viewer. Source is validated; invalid Mermaid is rejected with the parser error. ${STYLE_HINT}`,
    inputSchema: {
      title: z.string().min(1).max(120).describe("Human-readable title"),
      source: z.string().min(1).max(200_000).describe("Mermaid source"),
      note: z.string().max(500).optional().describe("One line describing this revision"),
    },
  },
  async ({ title, source, note }) => {
    const err = await validateMermaid(source);
    if (err) return fail(`Mermaid did not parse, nothing was saved:\n${err}`);
    const d = await createDiagram(title, source, AUTHOR, note);
    return text(`Created. ${summary(d)}`);
  },
);

server.registerTool(
  "update_diagram",
  {
    description: `Save a new revision of a diagram (full source, not a patch). Call get_feedback first and address open items; then resolve_feedback for each one this revision fixes. ${STYLE_HINT}`,
    inputSchema: {
      id: z.string().describe("Diagram id"),
      source: z.string().min(1).max(200_000).describe("Complete Mermaid source for the new revision"),
      note: z.string().max(500).optional().describe("One line describing what changed"),
      title: z.string().min(1).max(120).optional().describe("Rename the diagram"),
    },
  },
  async ({ id, source, note, title }) => {
    const prev = await getDiagram(id);
    if (!prev) return fail(`No diagram with id "${id}". Call list_diagrams.`);
    if (prev.revisions.at(-1)!.source === source && !title) return fail("Source is identical to the latest revision; nothing saved.");
    const err = await validateMermaid(source);
    if (err) return fail(`Mermaid did not parse, nothing was saved:\n${err}`);
    return text(`Saved. ${summary(await addRevision(id, source, AUTHOR, note, title))}`);
  },
);

server.registerTool(
  "list_diagrams",
  { description: "List diagrams with their latest revision and open feedback count." },
  async () => {
    const all = await listDiagrams();
    return text(all.length ? all.map(summary).join("\n") : "No diagrams yet. Use create_diagram.");
  },
);

server.registerTool(
  "get_diagram",
  {
    description: "Get a diagram's Mermaid source (latest, or a given revision) plus revision history.",
    inputSchema: { id: z.string(), revision: z.number().int().positive().optional() },
  },
  async ({ id, revision }) => {
    const d = await getDiagram(id);
    if (!d) return fail(`No diagram with id "${id}".`);
    const r = revision ? d.revisions.find((x) => x.n === revision) : d.revisions.at(-1);
    if (!r) return fail(`Revision ${revision} does not exist; latest is ${d.revisions.at(-1)!.n}.`);
    const history = d.revisions.map((x) => `r${x.n}${x.note ? `: ${x.note}` : ""}`).join("\n");
    return text(`${summary(d)}\n\nRevision ${r.n} source:\n\`\`\`mermaid\n${r.source}\n\`\`\`\n\nHistory:\n${history}`);
  },
);

server.registerTool(
  "get_feedback",
  {
    description: "Read the human's feedback on a diagram. Each item is anchored to a node id (or the whole diagram).",
    inputSchema: { id: z.string(), includeResolved: z.boolean().optional() },
  },
  async ({ id, includeResolved }) => {
    const d = await getDiagram(id);
    if (!d) return fail(`No diagram with id "${id}".`);
    const items = includeResolved ? d.feedback : openFeedback(d);
    if (!items.length) return text(`No ${includeResolved ? "" : "open "}feedback on "${d.title}".`);
    return text(
      items
        .map(
          (f) =>
            `- [${f.id}] ${f.status === "open" ? "OPEN" : `resolved in r${f.resolvedIn}`} · ${
              f.nodeId ? `node "${f.nodeId}"${f.nodeLabel ? ` (${f.nodeLabel})` : ""}` : "whole diagram"
            } · on r${f.revision}\n  ${f.text.replace(/\n/g, "\n  ")}`,
        )
        .join("\n"),
    );
  },
);

server.registerTool(
  "resolve_feedback",
  {
    description: "Mark a feedback item resolved by the latest revision, with an optional short reply the human will see.",
    inputSchema: { id: z.string(), feedbackId: z.string(), reply: z.string().max(1000).optional() },
  },
  async ({ id, feedbackId, reply }) => {
    try {
      const d = await setFeedbackStatus(id, feedbackId, "resolved", reply);
      return text(`Resolved ${feedbackId}. ${summary(d)}`);
    } catch (e: any) {
      return fail(e.message);
    }
  },
);

await startHttp().catch((e) => console.error(`Flow viewer failed to start: ${e.message}`));
await server.connect(new StdioServerTransport());
console.error(`Flow MCP ready. Viewer: ${viewerUrl()}`);
