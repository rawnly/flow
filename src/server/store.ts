import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type Revision = {
  n: number;
  source: string;
  note?: string;
  author: string;
  createdAt: string;
};

export type Feedback = {
  id: string;
  nodeId: string | null;
  nodeLabel?: string;
  text: string;
  revision: number;
  status: "open" | "resolved";
  createdAt: string;
  resolvedIn?: number;
  reply?: string;
};

export type Diagram = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revisions: Revision[];
  feedback: Feedback[];
};

export const flowDir = () => resolve(process.env.FLOW_DIR ?? join(process.cwd(), ".flow"));
export const diagramsDir = () => join(flowDir(), "diagrams");

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isId = (id: string) => ID_RE.test(id);

const file = (id: string) => {
  if (!isId(id)) throw new Error(`Invalid diagram id: ${id}`);
  return join(diagramsDir(), `${id}.json`);
};

export function slugify(title: string) {
  const s = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return s || "diagram";
}

async function save(d: Diagram) {
  await mkdir(diagramsDir(), { recursive: true });
  const tmp = `${file(d.id)}.${randomUUID()}.tmp`;
  // write-then-rename so readers never see a half-written file
  await writeFile(tmp, JSON.stringify(d, null, 2));
  await rename(tmp, file(d.id));
}

export async function getDiagram(id: string): Promise<Diagram | null> {
  try {
    return JSON.parse(await readFile(file(id), "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function listDiagrams(): Promise<Diagram[]> {
  let names: string[] = [];
  try {
    names = (await readdir(diagramsDir())).filter((f) => f.endsWith(".json"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const all = await Promise.all(names.map((f) => getDiagram(f.slice(0, -5)).catch(() => null)));
  return all.filter((d): d is Diagram => !!d).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// shortcut: read-modify-write is not locked across processes; fine for one agent + one viewer, add a lockfile if many agents write the same diagram.
async function mutate(id: string, fn: (d: Diagram) => void) {
  const d = await getDiagram(id);
  if (!d) throw new Error(`No diagram with id "${id}". Call list_diagrams to see ids.`);
  fn(d);
  d.updatedAt = new Date().toISOString();
  await save(d);
  return d;
}

export async function createDiagram(title: string, source: string, author: string, note?: string) {
  const base = slugify(title);
  let id = base;
  for (let i = 2; await getDiagram(id); i++) id = `${base}-${i}`;
  const now = new Date().toISOString();
  const d: Diagram = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    revisions: [{ n: 1, source, note, author, createdAt: now }],
    feedback: [],
  };
  await save(d);
  return d;
}

export const addRevision = (id: string, source: string, author: string, note?: string, title?: string) =>
  mutate(id, (d) => {
    const n = (d.revisions.at(-1)?.n ?? 0) + 1;
    d.revisions.push({ n, source, note, author, createdAt: new Date().toISOString() });
    if (title) d.title = title;
  });

export const addFeedback = (id: string, f: Pick<Feedback, "nodeId" | "nodeLabel" | "text" | "revision">) => {
  let created!: Feedback;
  return mutate(id, (d) => {
    created = { ...f, id: randomUUID().slice(0, 8), status: "open", createdAt: new Date().toISOString() };
    d.feedback.push(created);
  }).then(() => created);
};

export const setFeedbackStatus = (id: string, fid: string, status: Feedback["status"], reply?: string) =>
  mutate(id, (d) => {
    const f = d.feedback.find((x) => x.id === fid);
    if (!f) throw new Error(`No feedback "${fid}" on diagram "${id}".`);
    f.status = status;
    if (status === "resolved") {
      f.resolvedIn = d.revisions.at(-1)!.n;
      if (reply) f.reply = reply;
    } else {
      delete f.resolvedIn;
    }
  });

export const deleteFeedback = (id: string, fid: string) =>
  mutate(id, (d) => {
    d.feedback = d.feedback.filter((x) => x.id !== fid);
  });
