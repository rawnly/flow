#!/usr/bin/env node
// Claude Code hook: surfaces open Flow feedback so the human's viewer comments reach the agent.
//   PostToolUse      -> after the agent draws, waits (no time limit) for the user's review in the viewer,
//                       like a plan review: "Send to agent" returns the comments, "Looks good" lets it continue
//   UserPromptSubmit -> adds open feedback to the prompt's context
//   Stop             -> keeps the agent going while feedback is open
// Usage: flow-hook            (reads the hook event JSON on stdin)
//        flow-hook --print    (prints the settings.json snippet to install it)
import { pendingFeedbackReport, openFeedback, waitForReview } from "./feedback.js";
import { getDiagram } from "./store.js";

const CMD = "npx -y -p @rawnly/flow flow-hook";
// Plugin MCP tools are named mcp__plugin_flow_flow__*, manual installs mcp__flow__*.
const REVIEW_MATCHER = "mcp__.*flow.*__(create_diagram|update_diagram|resolve_feedback)";
const REVIEW_TIMEOUT = 345_600; // 4 days, like Plannotator: the user reviews when they're ready

if (process.argv.includes("--print")) {
  const hook = { hooks: [{ type: "command", command: CMD }] };
  const review = { matcher: REVIEW_MATCHER, hooks: [{ type: "command", command: CMD, timeout: REVIEW_TIMEOUT }] };
  console.log(JSON.stringify({ hooks: { PostToolUse: [review], UserPromptSubmit: [hook], Stop: [hook] } }, null, 2));
  process.exit(0);
}

const raw = await new Promise<string>((resolve) => {
  let s = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => resolve(s));
  if (process.stdin.isTTY) resolve("");
});

let input: { hook_event_name?: string; cwd?: string; stop_hook_active?: boolean; tool_name?: string; tool_response?: unknown } = {};
try {
  input = JSON.parse(raw || "{}");
} catch {}

// Same default as the MCP server: <cwd>/.flow unless FLOW_DIR is set.
if (input.cwd && !process.env.FLOW_DIR) process.chdir(input.cwd);

const out = (o: unknown) => console.log(JSON.stringify(o));

async function review() {
  // Every successful Flow tool result carries `(id: <diagram>)`; errors don't, so they never block.
  const id = JSON.stringify(input.tool_response ?? "").match(/\(id: ([a-z0-9-]+)\)/)?.[1];
  const d = id ? await getDiagram(id) : null;
  // Open items mean the agent is still mid-revision (it resolves after updating): wait once they're all handled.
  if (!d || openFeedback(d).length) return;
  const rev = d.revisions.at(-1)!.n;
  console.error(`Waiting for your review of "${d.title}" in the Flow viewer…`);
  const r = await waitForReview(d.id, rev);
  if (r.kind === "feedback")
    out({
      decision: "block",
      reason: `${r.report}\n\nAddress it with update_diagram, then call resolve_feedback for each item you fixed. Don't call wait_for_feedback: the next review arrives on its own.`,
    });
  else if (r.kind === "approved")
    out({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `The user approved "${d.title}" r${r.revision} in the Flow viewer ("Looks good"). Don't call wait_for_feedback; carry on.`,
      },
    });
}

try {
  if (input.hook_event_name === "PostToolUse") await review();
  else {
    const report = await pendingFeedbackReport();
    if (!report) process.exit(0);
    const todo =
      "Open Flow feedback from the user. Revise the diagram with update_diagram, then call resolve_feedback for each item you addressed.\n\n" +
      report;

    if (input.hook_event_name === "Stop") {
      // stop_hook_active: we already forced one continuation; never loop on feedback the agent chose not to resolve.
      if (input.stop_hook_active) process.exit(0);
      out({ decision: "block", reason: todo });
    } else if (input.hook_event_name === "UserPromptSubmit") {
      out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: todo } });
    }
  }
} catch (e: any) {
  console.error(`flow-hook: ${e.message}`); // never block the agent over a hook failure
}
