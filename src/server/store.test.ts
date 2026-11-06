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
