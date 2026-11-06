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
