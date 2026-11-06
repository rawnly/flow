/**
 * Flow for pi: the agent draws Mermaid diagrams you watch live in the Flow viewer,
 * and feedback you leave on nodes comes straight back into the conversation.
 */
import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatFeedback, markSeen, sourceBlock, tools } from "../src/server/tools.js";
import { startHttp, stopHttp, viewerUrl } from "../src/server/http.js";
import { diagramsDir, getDiagram, lastAgentSession, listDiagrams, type Feedback } from "../src/server/store.js";

const AUTHOR = "pi";
const ENTRY = "flow-diagram"; // session entry remembering which diagrams this session owns
const MSG = "flow-feedback";

type FeedbackDetails = { id: string; title: string; items: Feedback[] };

const label = (name: string) => "Flow: " + name.replace(/_/g, " ");

export default function (pi: ExtensionAPI) {
  const userDir = process.env.FLOW_DIR;
  const owned = new Set<string>(); // diagrams created or edited in this session
  const seen = new Set<string>(); // feedback ids already delivered or pre-existing
  let watcher: FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let openedViewer = false;
  let ctxRef: ExtensionContext | undefined;
  let session: string | undefined; // pi session id, stamped on revisions so feedback finds its writer
  let keepAlive: NodeJS.Timeout | undefined;

  // Once this session uses Flow, keep a viewer up: if the session hosting it exits, take over.
  const ensureViewer = async () => {
    const r = await startHttp();
    keepAlive ??= setInterval(() => void startHttp().catch(() => {}), 5_000);
    keepAlive.unref();
    return r;
  };

  const openUrl = (url: string) =>
    pi.exec(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [url]).catch(() => {});

  const own = (id: string) => {
    if (owned.has(id)) return;
    owned.add(id);
    pi.appendEntry(ENTRY, { id });
  };

  async function refresh() {
    const ctx = ctxRef;
    if (!ctx) return;
    let open = 0;
    for (const id of owned) {
      const d = await getDiagram(id).catch(() => null);
      if (!d) continue;
      const fresh = d.feedback.filter((f) => f.status === "open" && !seen.has(f.id));
      fresh.forEach((f) => seen.add(f.id));
      // Several sessions may have touched this diagram; only the latest agent writer handles feedback.
      const writer = lastAgentSession(d);
      if (writer && writer !== session) continue;
      open += d.feedback.filter((f) => f.status === "open").length;
      if (!fresh.length) continue;
      const latest = d.revisions.at(-1)!;
      const edited = fresh.some((f) => f.kind === "edit");
      if (edited) markSeen(session, d.id, latest.n);
      pi.sendMessage<FeedbackDetails>(
        {
          customType: MSG,
          display: true,
          details: { id: d.id, title: d.title, items: fresh },
          content:
            `The user left feedback in the Flow viewer on "${d.title}" (id: ${d.id}, latest r${latest.n} by ${latest.author}):\n` +
            `${formatFeedback(fresh)}\n\n` +
            (edited ? `Current source (keep the user's edits):\n${sourceBlock(latest.source)}\n\n` : "") +
            `Address it with update_diagram, then call resolve_feedback for each item you fixed (with a short reply).`,
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
    }
    if (ctx.hasUI) ctx.ui.setStatus("flow", open ? ctx.ui.theme.fg("warning", `◆ flow ${open} open`) : undefined);
  }

  async function startWatching() {
    await mkdir(diagramsDir(), { recursive: true });
    // Drafts aren't sent yet; leave them unseen so they're delivered once the user sends the review.
    for (const d of await listDiagrams()) d.feedback.forEach((f) => f.status !== "draft" && seen.add(f.id));
    watcher = watch(diagramsDir(), (_e, name) => {
      if (!name?.endsWith(".json")) return;
      clearTimeout(debounce);
      // Batch bursts: one message per few comments typed in a row.
      debounce = setTimeout(() => void refresh().catch(() => {}), 800);
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    session = ctx.sessionManager.getSessionId();
    process.env.FLOW_DIR = userDir ?? join(ctx.cwd, ".flow");
    owned.clear();
    for (const e of ctx.sessionManager.getEntries()) {
      if (e.type === "custom" && e.customType === ENTRY) owned.add((e.data as { id: string }).id);
    }
    await startWatching().catch((e) => ctx.hasUI && ctx.ui.notify(`Flow could not watch ${diagramsDir()}: ${e.message}`, "warning"));
    if (owned.size) void refresh();
  });

  pi.on("session_shutdown", async () => {
    clearTimeout(debounce);
    clearInterval(keepAlive);
    keepAlive = undefined;
    watcher?.close();
    watcher = undefined;
    ctxRef = undefined;
    stopHttp();
  });

  for (const t of tools) {
    const isCreate = t.name === "create_diagram";
    pi.registerTool({
      name: t.name,
      label: label(t.name),
      description: t.description,
      // Pi validates plain JSON Schema; the zod shape stays the single source shared with the MCP server.
      parameters: z.toJSONSchema(z.object(t.shape)) as any,
      ...(isCreate && {
        promptSnippet: "Draw Mermaid diagrams the user watches live (and comments on) in the Flow viewer",
        promptGuidelines: [
          "Use create_diagram when the user asks for a diagram, flowchart, architecture sketch, or sequence; revise it with update_diagram instead of pasting Mermaid into chat.",
          "When a flow-feedback message arrives, address every item with update_diagram, then call resolve_feedback for each one.",
        ],
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        await ensureViewer().catch(() => false);
        const r = await t.run(params, AUTHOR, session);
        if (!r.isError && r.diagramId && (isCreate || t.name === "update_diagram")) {
          own(r.diagramId);
          const d = await getDiagram(r.diagramId);
          d?.feedback.forEach((f) => f.status === "resolved" && seen.add(f.id));
          if (isCreate && !openedViewer && ctx.hasUI) {
            openedViewer = true;
            await openUrl(viewerUrl(r.diagramId));
          }
        }
        return { content: [{ type: "text", text: r.text }], details: { diagramId: r.diagramId }, ...(r.isError && { isError: true }) };
      },
    });
  }

  pi.registerMessageRenderer<FeedbackDetails>(MSG, (message, options, theme) => {
    const d = message.details;
    if (!d) return new Text(String(message.content), options.outputPad, 0);
    const head = theme.fg("warning", "◆ ") + theme.bold(`Feedback on ${d.title}`) + theme.fg("dim", ` · ${d.items.length} from the Flow viewer`);
    const lines = d.items.map((f) => `  ${theme.fg("accent", f.nodeLabel ?? f.nodeId ?? "Whole diagram")}  ${f.kind === "edit" ? theme.fg("dim", f.text) : f.text}`);
    return new Text([head, ...lines].join("\n"), options.outputPad, 0);
  });

  pi.registerCommand("flow", {
    description: "Open the Flow diagram viewer (optionally a diagram id)",
    getArgumentCompletions: async (prefix) => {
      const items = (await listDiagrams().catch(() => []))
        .filter((d) => d.id.startsWith(prefix))
        .map((d) => ({ value: d.id, label: d.id, description: d.title }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const id = args.trim() || undefined;
      if (id && !(await getDiagram(id).catch(() => null))) return ctx.ui.notify(`No Flow diagram "${id}"`, "error");
      const mine = await ensureViewer().catch((e) => (ctx.ui.notify(`Flow viewer failed: ${e.message}`, "error"), null));
      if (mine === null) return;
      const url = viewerUrl(id);
      await openUrl(url);
      ctx.ui.notify(`Flow viewer${mine ? "" : " (shared with another session)"}: ${url}`, "info");
    },
  });
}
