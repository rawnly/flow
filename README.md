# Flow

A canvas for agents. Agents create and revise Mermaid diagrams over MCP; you watch every revision render live, comment on nodes, and export.

## Setup

```sh
bun install
bun run build
claude mcp add flow -- node "$PWD/dist/server/mcp.js"   # or any MCP client, stdio
```

The first MCP process also serves the viewer at http://127.0.0.1:4729. Diagrams live in `./.flow/diagrams/*.json` (set `FLOW_DIR` to change, `FLOW_PORT` for the port, `FLOW_AGENT_NAME` for the author shown in history).

## Tools

| Tool | What it does |
|---|---|
| `create_diagram` | New diagram. Invalid Mermaid is rejected with the parser error. |
| `update_diagram` | New revision (full source). |
| `list_diagrams` / `get_diagram` | Read diagrams, any revision, history. |
| `get_feedback` | Human comments, each anchored to a node id. |
| `resolve_feedback` | Mark a comment fixed, with a reply. |

Label nodes as `id["Title<br/>subtitle"]` for the two-line style. The viewer highlights what's new since the previous revision on its own.

## Viewer

- **Diagram**: pan (drag / scroll), zoom (pinch / ⌘-scroll), click a node to leave feedback, `[` `]` step through revisions.
- **Source** and **Changes** (line diff against any earlier revision).
- **Export**: SVG, PNG 2×, SVG markup, or copy as a Markdown code block.

Users only need Node 20+: `dist/` is plain JavaScript. Bun is for working on Flow.

## Develop

```sh
bun run seed         # synthetic demo diagrams
bun run dev:server   # API on :4729
bun run dev          # Vite viewer with /api proxied
bun test
```
