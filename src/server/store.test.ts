import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FLOW_DIR = await mkdtemp(join(tmpdir(), "flow-test-"));
const store = await import("./store.js");
const { validateMermaid } = await import("./validate.js");

test("revisions, feedback, and id collisions", async () => {
  const a = await store.createDiagram("Checkout flow!", "flowchart TD\n a-->b", "t");
  const b = await store.createDiagram("Checkout flow", "flowchart TD\n a-->b", "t");
  assert.equal(a.id, "checkout-flow");
  assert.equal(b.id, "checkout-flow-2");
  await store.addRevision(a.id, "flowchart TD\n a-->b-->c", "t", "add c");
  const f = await store.addFeedback(a.id, { nodeId: "b", text: "rename", revision: 2 });
  const d = await store.setFeedbackStatus(a.id, f.id, "resolved", "done");
  assert.equal(d.revisions.length, 2);
  assert.deepEqual([d.feedback[0].status, d.feedback[0].resolvedIn, d.feedback[0].reply], ["resolved", 2, "done"]);
  assert.equal((await store.listDiagrams()).length, 2);
});

test("drafts stay hidden until the review is sent", async () => {
  const { pendingFeedbackReport } = await import("./feedback.js");
  const d = await store.createDiagram("Drafts", "flowchart TD\n a-->b", "t");
  await store.addFeedback(d.id, { nodeId: "a", text: "one", revision: 1 }, "draft");
  await store.addFeedback(d.id, { nodeId: "b", text: "two", revision: 1 }, "draft");
  assert.equal(await pendingFeedbackReport(d.id), null);
  const sent = await store.submitDrafts(d.id);
  assert.deepEqual(sent.feedback.map((f) => f.status), ["open", "open"]);
  assert.match((await pendingFeedbackReport(d.id))!, /one[\s\S]*two/);
});

test("waitForReview: ignores feedback already open, returns new feedback or approval", async () => {
  const { waitForReview } = await import("./feedback.js");
  const d = await store.createDiagram("Review", "flowchart TD\n a-->b", "t");
  await store.addFeedback(d.id, { nodeId: "a", text: "old", revision: 1 });
  const fb = waitForReview(d.id, 1);
  await new Promise((r) => setTimeout(r, 50));
  await store.addFeedback(d.id, { nodeId: "b", text: "new", revision: 1 });
  const r = await fb;
  assert.equal(r.kind, "feedback");
  assert.ok(r.kind === "feedback" && r.report.includes("new") && !r.report.includes("old"));

  const ok = waitForReview(d.id, 1);
  await store.approve(d.id, 1);
  assert.deepEqual(await ok, { kind: "approved", revision: 1 });
});

test("rejects path-like ids", async () => {
  await assert.rejects(store.getDiagram("../etc"), /Invalid diagram id/);
});

test("validates mermaid", async () => {
  assert.equal(await validateMermaid("flowchart TD\n a-->b"), null);
  assert.match((await validateMermaid("flowchart TD\n a-->"))!, /Parse error/);
});

test("validates html labels", async () => {
  assert.equal(await validateMermaid('flowchart LR\n a["A<br/>sub"] --> b'), null);
});

test("validation does not leak DOM globals", async () => {
  await validateMermaid('flowchart LR\n a["A<br/>sub"] --> b');
  assert.equal(typeof (globalThis as any).window, "undefined");
  assert.equal(await validateMermaid('flowchart LR\n a["A<br/>sub"] --> b'), null);
});

test("each .flow dir gets its own viewer; same dir reuses it", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtemp } = await import("node:fs/promises");
  const other = await mkdtemp(join(tmpdir(), "flow-other-"));
  process.env.FLOW_PORT = "4791";
  // Another project's viewer holds the base port.
  const child = spawn(process.execPath, [join(import.meta.dir, "http.ts")], { env: { ...process.env, FLOW_DIR: other }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise<void>((r) => child.stderr!.once("data", () => r()));
  try {
    const http = await import("./http.js");
    assert.equal(await http.startHttp(), true);
    assert.match(http.viewerUrl(), /:4792\//);
    const info = await (await fetch("http://127.0.0.1:4792/api/info")).json();
    assert.equal(info.dir, process.env.FLOW_DIR);
    http.stopHttp();
  } finally {
    child.kill();
  }
});

test("concurrent writers from several processes lose nothing", async () => {
  const { spawn } = await import("node:child_process");
  const run = (args: string[]) =>
    new Promise<string>((ok, fail) => {
      const c = spawn(process.execPath, [join(import.meta.dir, "fixtures/writer.ts"), ...args], { env: process.env });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`writer exited ${code}`))));
    });
  const d = await store.createDiagram("Shared", "flowchart TD\n a-->b", "t");
  await Promise.all([1, 2, 3, 4].map(() => run(["write", d.id, "15"])));
  const after = (await store.getDiagram(d.id))!;
  assert.equal(after.revisions.length, 1 + 4 * 15);
  assert.equal(after.feedback.length, 4 * 15);
  assert.deepEqual(after.revisions.map((r) => r.n), after.revisions.map((_, i) => i + 1));

  const ids = (await Promise.all([1, 2, 3].map(() => run(["create", "", "5"])))).join("").trim().split("\n");
  assert.equal(new Set(ids).size, 15);
}, 60_000);

test("human edits: conflict on stale base, agent update refused until it has seen the edit", async () => {
  const { tools } = await import("./tools.js");
  const run = (name: string, args: any, session = "s1") => tools.find((t) => t.name === name)!.run(args, "agent", session);

  const created = await run("create_diagram", { title: "Human edits", source: "flowchart LR\n a-->b" });
  const id = created.diagramId!;
  // Human edits r1 -> r2; a second, stale human save based on r1 conflicts.
  await store.addHumanRevision(id, "flowchart LR\n a-->b-->c", 1, "add c");
  await assert.rejects(store.addHumanRevision(id, "flowchart LR\n a-->x", 1), store.ConflictError);

  // The agent hasn't seen r2: its update is refused and gets the current source back.
  const refused = await run("update_diagram", { id, source: "flowchart LR\n a-->b-->d" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /r2 was written by you/);
  assert.match(refused.text, /b-->c/);
  // Built on top of it, the retry goes through.
  const saved = await run("update_diagram", { id, source: "flowchart LR\n a-->b-->c-->d" });
  assert.equal(saved.isError, undefined);

  // A different agent session that never read it is refused too.
  assert.equal((await run("update_diagram", { id, source: "flowchart LR\n z" }, "s2")).isError, true);

  // Feedback after a human edit routes to the last agent writer.
  const d = await store.addHumanRevision(id, "flowchart LR\n a-->b-->c-->d-->e", 3);
  assert.equal(store.lastAgentSession(d), "s1");
});
