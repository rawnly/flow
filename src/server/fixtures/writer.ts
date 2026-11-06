// Test helper: hammers one diagram from a separate process.
import { addFeedback, addRevision, createDiagram } from "../store.js";
const [mode, id, n] = process.argv.slice(2);
if (mode === "create") {
  for (let i = 0; i < Number(n); i++) console.log((await createDiagram("Race", "flowchart TD\n a-->b", "t")).id);
} else {
  for (let i = 0; i < Number(n); i++) {
    await addRevision(id, `flowchart TD\n a-->b${process.pid}x${i}`, "t");
    await addFeedback(id, { nodeId: null, text: `${process.pid}-${i}`, revision: 1 });
  }
}
