// Synthetic demo data for the viewer. Not real usage.
import { addFeedback, addRevision, createDiagram, setFeedbackStatus } from "../src/server/store.js";

const r1 = `flowchart LR
  app["DeskRaid app<br/>5-minute batches"] --> worker["Worker<br/>rate bound, daily cap"]
  worker --> totals["Player totals<br/>day, week, all-time"]
  totals --> global["Global board<br/>every player"]`;
const r2 = r1 + `
  totals --> group["Group board<br/>members only"]
  members["Group members<br/>joined by invite code"] -- filters --> group`;
const r3 = r2.replace('worker["Worker<br/>rate bound, daily cap"]', 'worker["Worker<br/>rate bound, daily cap"]') + `
  worker --> audit["Anti-cheat<br/>flags outliers"]`;

const d = await createDiagram("Group leaderboards", r1, "claude", "Global board only");
await addRevision(d.id, r2, "claude", "Add group boards that reuse player totals");
const f1 = await addFeedback(d.id, { nodeId: "worker", nodeLabel: "Worker", text: "Where does anti-cheat sit? It should run before totals are written.", revision: 2 });
await addRevision(d.id, r3, "claude", "Show anti-cheat beside the worker");
await setFeedbackStatus(d.id, f1.id, "resolved", "Added Anti-cheat off the Worker; it flags before totals update.");
await addFeedback(d.id, { nodeId: "members", nodeLabel: "Group members", text: "Invite codes expire after 7 days. Worth noting on the node.", revision: 3 });
await addFeedback(d.id, { nodeId: null, text: "Can we lay this out top-down? It gets wide on my laptop.", revision: 3 });

await createDiagram(
  "Checkout architecture",
  `flowchart TD
  web["Web client<br/>Next.js"] --> gw["API gateway<br/>auth, rate limits"]
  gw --> auth["Auth service<br/>sessions, JWT"]
  gw --> cart["Cart service<br/>Postgres"]
  gw --> pay["Payments<br/>Stripe"]
  cart --> q[["Order queue<br/>SQS"]]
  pay --> q
  q --> ful(["Fulfillment worker"])
  auth --> cache[("Session cache<br/>Redis")]`,
  "codex",
  "Initial architecture",
);

await createDiagram(
  "Login sequence",
  `sequenceDiagram
  autonumber
  participant U as User
  participant W as Web
  participant A as Auth
  participant R as Redis
  U->>W: Submit email + password
  W->>A: POST /session
  A->>R: Store session
  R-->>A: OK
  A-->>W: Set-Cookie
  W-->>U: Redirect to dashboard`,
  "claude",
  "Happy path",
);
console.log("Seeded .flow with demo diagrams");
