#!/usr/bin/env node
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./tools.js";
import { startHttp, viewerUrl } from "./http.js";

const AUTHOR = process.env.FLOW_AGENT_NAME ?? "agent";
const server = new McpServer({ name: "flow", version: "0.1.0" });
let opened = false;

// Like the pi extension: bring the viewer up on the first diagram so the user can start reviewing.
const openViewer = (url: string) => {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const p = spawn(cmd, [url], { stdio: "ignore", detached: true });
  p.on("error", () => {}); // headless or no opener: the URL is in the tool result anyway
  p.unref();
};

for (const t of tools) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, async (args: any) => {
    const r = await t.run(args, AUTHOR);
    if (t.name === "create_diagram" && !r.isError && r.diagramId && !opened) (opened = true), openViewer(viewerUrl(r.diagramId));
    return { content: [{ type: "text" as const, text: r.text }], ...(r.isError && { isError: true }) };
  });
}

await startHttp().catch((e) => console.error(`Flow viewer failed to start: ${e.message}`));
await server.connect(new StdioServerTransport());
console.error(`Flow MCP ready. Viewer: ${viewerUrl()}`);
