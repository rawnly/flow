#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./tools.js";
import { startHttp, viewerUrl } from "./http.js";

const AUTHOR = process.env.FLOW_AGENT_NAME ?? "agent";
const server = new McpServer({ name: "flow", version: "0.1.0" });

for (const t of tools) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, async (args: any) => {
    const r = await t.run(args, AUTHOR);
    return { content: [{ type: "text" as const, text: r.text }], ...(r.isError && { isError: true }) };
  });
}

await startHttp().catch((e) => console.error(`Flow viewer failed to start: ${e.message}`));
await server.connect(new StdioServerTransport());
console.error(`Flow MCP ready. Viewer: ${viewerUrl()}`);
