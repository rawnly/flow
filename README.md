# Flow

A canvas for agents. Agents create and revise Mermaid diagrams over MCP; you watch every revision render live, comment on nodes, and export.

Requires Node 20+.

## Install

### Pi

```sh
pi install npm:@rawnly/flow
```

### Any MCP client

```sh
claude mcp add flow -- npx -y -p @rawnly/flow flow-mcp
```

Or in your client's config (`.mcp.json`, `mcp.json`, ...):

```json
{
  "mcpServers": {
    "flow": {
      "command": "npx",
      "args": ["-y", "-p", "@rawnly/flow", "flow-mcp"],
      "env": {
        "FLOW_DIR": ".flow",
        "FLOW_AGENT_NAME": "claude"
      }
    }
  }
}
```

The first MCP process also serves the viewer at <http://127.0.0.1:4729>.

## Configuration

All optional, set as environment variables.

| Variable | Default | Purpose |
|---|---|---|
| `FLOW_DIR` | `./.flow` | Where diagrams are stored (`<FLOW_DIR>/diagrams/*.json`) |
| `FLOW_PORT` | `4729` | Viewer port |
| `FLOW_AGENT_NAME` | | Author name shown in history |

## Tools

| Tool | What it does |
|---|---|
| `create_diagram` | New diagram. Invalid Mermaid is rejected with the parser error. |
| `update_diagram` | New revision (full source). |
| `list_diagrams` / `get_diagram` | Read diagrams, any revision, history. |
| `get_feedback` | Human comments, each anchored to a node id. |
| `resolve_feedback` | Mark a comment fixed, with a reply. |

Tip: label nodes as `id["Title<br/>subtitle"]` for the two-line style. The viewer highlights what changed since the previous revision on its own.

## Viewer

| Tab | What you can do |
|---|---|
| **Diagram** | Pan (drag / scroll), zoom (pinch / ⌘-scroll), click a node to leave feedback, `[` `]` to step through revisions. |
| **Edit** | Change the Mermaid source with a live preview (your changes in blue). `⌘S` saves a revision by *you*. Tick **Ask the agent to adjust after my edit** to have the agent tidy up around it. Editing an old revision restores it as a new one. |
| **Changes** | Line diff against any earlier revision. |

**Export:** SVG, PNG 2×, SVG markup, or copy as a Markdown code block.

**No overwrites:** if the agent saves while you edit, you're warned before replacing it. If you edited since the agent last looked, its `update_diagram` is refused with your current source, so it builds on your edit.

## Pi extension extras

On top of the tools, the pi extension:

- **Returns feedback automatically.** *Send to agent* in the viewer delivers the comment into the conversation; the agent revises the diagram and resolves it. Only diagrams the current session created or edited are delivered.
- **Opens the viewer** on the first diagram created. `/flow [id]` opens it any time.
- **Shows open feedback count** in the footer.
- **Supports several agents per project.** Writes are locked per diagram, so agents, MCP servers and the viewer never clobber each other. Feedback goes to the session that wrote the latest revision. If the session hosting the viewer exits, another takes over within seconds.

## Develop

```sh
bun install
bun run build        # required once: builds the viewer into dist/
bun run seed         # synthetic demo diagrams
bun run dev:server   # API on :4729
bun run dev          # Vite viewer with /api proxied
bun test
```

Use your local build instead of the package:

```sh
claude mcp add flow -- node "$PWD/dist/server/mcp.js"
pi install /path/to/flow     # or: pi -e /path/to/flow/pi/extension.ts
```
