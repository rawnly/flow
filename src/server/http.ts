import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, watch, type FSWatcher } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMermaid } from "./validate.js";
import {
  ConflictError,
  addHumanRevision,
  flowDir,
  addFeedback,
  deleteFeedback,
  diagramsDir,
  getDiagram,
  isId,
  listDiagrams,
  setFeedbackStatus,
  submitDrafts,
  approve,
} from "./store.js";

const BASE_PORT = Number(process.env.FLOW_PORT ?? 4729);
const PORT_TRIES = 20;
export const HOST = "127.0.0.1";
// Resolved by startHttp(): our own port, or the port of a viewer already serving the same .flow dir.
let port = BASE_PORT;
export const viewerUrl = (id?: string) => `http://${HOST}:${port}/${id ? `#/d/${id}` : ""}`;

const here = dirname(fileURLToPath(import.meta.url));
// dist/server/*.js (Node) and src/server/*.ts (bun dev) both serve dist/web
const webRoot = resolve(here, here.endsWith(join("src", "server")) ? "../../dist/web" : "../web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage, limit = 64_000): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "Body too large");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

class HttpError extends Error {
  constructor(public code: number, msg: string) {
    super(msg);
  }
}

const clients = new Set<ServerResponse>();
const broadcast = (data: unknown) => {
  for (const c of clients) c.write(`data: ${JSON.stringify(data)}\n\n`);
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let p = join(webRoot, rel);
  if (!p.startsWith(webRoot)) return json(res, 403, { error: "Forbidden" });
  try {
    if ((await stat(p)).isDirectory()) p = join(p, "index.html");
  } catch {
    p = join(webRoot, "index.html");
  }
  try {
    await stat(p);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Viewer not built. Run `npm run build`, or `npm run dev` for development.");
  }
  res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
  createReadStream(p).pipe(res);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean); // ["api","diagrams",id,"feedback",fid]
  if (parts[0] !== "api") return serveStatic(req, res);

  if (parts[1] === "events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (parts[1] === "info") return json(res, 200, { app: "flow", dir: flowDir(), mcpPath: resolve(webRoot, "../server/mcp.js") });

  if (parts[1] !== "diagrams") throw new HttpError(404, "Not found");
  const [, , id, sub, fid] = parts;

  if (!id && req.method === "GET") {
    const list = await listDiagrams();
    return json(
      res,
      200,
      list.map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
        revision: d.revisions.at(-1)?.n ?? 0,
        openFeedback: d.feedback.filter((f) => f.status === "open").length,
      })),
    );
  }
  if (!id || !isId(id)) throw new HttpError(400, "Invalid diagram id");

  if (!sub && req.method === "GET") {
    const d = await getDiagram(id);
    return d ? json(res, 200, d) : json(res, 404, { error: "Not found" });
  }

  if (sub === "revisions" && req.method === "POST") {
    const b = await readJson(req, 400_000);
    if (typeof b.source !== "string" || !b.source.trim() || b.source.length > 200_000) throw new HttpError(400, "source must be 1–200000 characters");
    if (!Number.isInteger(b.base)) throw new HttpError(400, "base must be the revision number you edited");
    const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : undefined;
    const ask = typeof b.askAgent === "string" ? b.askAgent.trim().slice(0, 4000) : b.askAgent === true ? "" : null;
    const err = await validateMermaid(b.source);
    if (err) return json(res, 422, { error: "Mermaid did not parse", detail: err });
    let d;
    try {
      d = await addHumanRevision(id, b.source, b.base, note, b.force === true);
    } catch (e) {
      if (e instanceof ConflictError) return json(res, 409, { error: e.message, latest: e.latest });
      throw e;
    }
    const n = d.revisions.at(-1)!.n;
    if (ask !== null)
      await addFeedback(id, {
        kind: "edit",
        nodeId: null,
        nodeLabel: `Your edit in r${n}`,
        revision: n,
        text: ask || "Review my edit and adjust the rest of the diagram around it: keep my changes, make naming, connections and layout consistent with them, and fix anything my edit broke.",
      });
    return json(res, 201, await getDiagram(id));
  }

  if (sub === "feedback" && !fid && req.method === "POST") {
    const b = await readJson(req);
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text || text.length > 4000) throw new HttpError(400, "Feedback text must be 1–4000 characters");
    if (!Number.isInteger(b.revision)) throw new HttpError(400, "revision must be an integer");
    const nodeId = typeof b.nodeId === "string" && b.nodeId.length <= 200 ? b.nodeId : null;
    const nodeLabel = typeof b.nodeLabel === "string" ? b.nodeLabel.slice(0, 200) : undefined;
    return json(res, 201, await addFeedback(id, { text, revision: b.revision, nodeId, nodeLabel }, b.draft === true ? "draft" : "open"));
  }

  if (sub === "submit" && req.method === "POST") return json(res, 200, await submitDrafts(id));

  if (sub === "approve" && req.method === "POST") {
    const b = await readJson(req);
    if (!Number.isInteger(b.revision)) throw new HttpError(400, "revision must be an integer");
    return json(res, 200, await approve(id, b.revision));
  }

  if (sub === "feedback" && fid && req.method === "PATCH") {
    const b = await readJson(req);
    if (b.status !== "open" && b.status !== "resolved") throw new HttpError(400, "status must be open or resolved");
    return json(res, 200, await setFeedbackStatus(id, fid, b.status));
  }

  if (sub === "feedback" && fid && req.method === "DELETE") {
    return json(res, 200, await deleteFeedback(id, fid));
  }

  throw new HttpError(404, "Not found");
}

let watcher: FSWatcher | undefined;
async function watchStore() {
  await mkdir(diagramsDir(), { recursive: true });
  const pending = new Map<string, NodeJS.Timeout>();
  watcher = watch(diagramsDir(), (_e, name) => {
    if (!name?.endsWith(".json")) return;
    const id = name.slice(0, -5);
    clearTimeout(pending.get(id));
    pending.set(id, setTimeout(() => broadcast({ type: "changed", id }), 40));
  });
}

let running: Promise<boolean> | undefined;
let server: ReturnType<typeof createServer> | undefined;
let pinger: NodeJS.Timeout | undefined;
let reused: number | undefined; // port of another process's viewer for the same dir

/** Which .flow dir a Flow viewer on `p` serves; null if nothing (or not Flow) answers. */
async function probe(p: number): Promise<string | null> {
  try {
    const r = await fetch(`http://${HOST}:${p}/api/info`, { signal: AbortSignal.timeout(800) });
    const info: any = await r.json();
    return info?.app === "flow" && typeof info.dir === "string" ? info.dir : null;
  } catch {
    return null;
  }
}

function listen(p: number): Promise<boolean> {
  const s = createServer((req, res) => {
    handle(req, res).catch((e) => {
      const code = e instanceof HttpError ? e.code : /No (diagram|feedback)/.test(e.message) ? 404 : 500;
      json(res, code, { error: e.message });
    });
  });
  return new Promise((ok, fail) => {
    s.once("error", (e: any) => (e.code === "EADDRINUSE" ? ok(false) : fail(e)));
    s.listen(p, HOST, async () => {
      server = s;
      await watchStore();
      pinger = setInterval(() => broadcast({ type: "ping" }), 25_000);
      pinger.unref();
      ok(true);
    });
  });
}

/**
 * Makes sure a viewer serves this process's .flow dir. Reuses one another process already runs for
 * the same dir; otherwise starts our own on the first free port from FLOW_PORT (default 4729).
 * Resolves true when this process owns the viewer.
 */
export async function startHttp(): Promise<boolean> {
  // The process we were reusing may have exited; then take over.
  if (reused !== undefined && (await probe(reused)) !== flowDir()) {
    reused = undefined;
    running = undefined;
  }
  return (running ??= (async () => {
    const dir = flowDir();
    for (let p = BASE_PORT; p < BASE_PORT + PORT_TRIES; p++) {
      if (await listen(p)) return (port = p), true;
      if ((await probe(p)) === dir) return (port = reused = p), false;
    }
    throw new Error(`No free port in ${BASE_PORT}-${BASE_PORT + PORT_TRIES - 1}`);
  })().catch((e) => {
    running = undefined;
    throw e;
  }));
}

export function stopHttp() {
  watcher?.close();
  clearInterval(pinger);
  for (const c of clients) c.end();
  clients.clear();
  server?.close();
  watcher = server = pinger = running = reused = undefined;
  port = BASE_PORT;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttp().then((ok) => console.error(`${ok ? "Flow viewer on" : "Already served by"} ${viewerUrl()} (${flowDir()})`));
}
