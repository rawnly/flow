#!/usr/bin/env node
// Claude Code hook: surfaces open Flow feedback so the human's viewer comments reach the agent.
//   UserPromptSubmit -> adds open feedback to the prompt's context
//   Stop             -> keeps the agent going while feedback is open
// Usage: flow-hook            (reads the hook event JSON on stdin)
//        flow-hook --print    (prints the settings.json snippet to install it)
import { pendingFeedbackReport } from "./feedback.js";

if (process.argv.includes("--print")) {
  const hook = { hooks: [{ type: "command", command: "npx -y -p @rawnly/flow flow-hook" }] };
  console.log(JSON.stringify({ hooks: { UserPromptSubmit: [hook], Stop: [hook] } }, null, 2));
  process.exit(0);
}

const raw = await new Promise<string>((resolve) => {
  let s = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => resolve(s));
  if (process.stdin.isTTY) resolve("");
});

let input: { hook_event_name?: string; cwd?: string; stop_hook_active?: boolean } = {};
try {
  input = JSON.parse(raw || "{}");
} catch {}

// Same default as the MCP server: <cwd>/.flow unless FLOW_DIR is set.
if (input.cwd && !process.env.FLOW_DIR) process.chdir(input.cwd);

try {
  const report = await pendingFeedbackReport();
  if (!report) process.exit(0);
  const todo =
    "Open Flow feedback from the user. Revise the diagram with update_diagram, then call resolve_feedback for each item you addressed.\n\n" +
    report;

  if (input.hook_event_name === "Stop") {
    // stop_hook_active: we already forced one continuation; never loop on feedback the agent chose not to resolve.
    if (input.stop_hook_active) process.exit(0);
    console.log(JSON.stringify({ decision: "block", reason: todo }));
  } else if (input.hook_event_name === "UserPromptSubmit") {
    console.log(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: todo } }),
    );
  }
} catch (e: any) {
  console.error(`flow-hook: ${e.message}`); // never block the agent over a hook failure
}
