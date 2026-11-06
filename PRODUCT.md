# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript for the viewer. A Node MCP server (stdio) exposes diagram tools to agents and serves the viewer on localhost. Mermaid renders client-side.

## Users

- **Agents** (Claude, Codex, pi, etc.) that need to produce or iterate on diagrams: architecture, sequence, state, flowcharts, ER. They speak MCP.
- **The human pairing with the agent**, usually a developer with the viewer open beside their editor or terminal. Their job: watch the diagram take shape, point at what is wrong, and take the result away.

## Product Purpose

Flow gives an agent a canvas. The agent creates and revises Mermaid diagrams through MCP tools; the human watches every revision render live in a local viewer, leaves feedback pinned to specific nodes, and exports the final result. Success: the diagram converges in a few rounds without the human ever pasting Mermaid source back and forth.

## Positioning

A closed loop between agent and human around one diagram: revisions are versioned and diffable, and human comments are structured data the agent reads back through MCP (`get_feedback`), not chat messages.

## Operating Context

- Viewer runs on localhost in a browser tab or split pane beside a terminal/IDE.
- Agent sessions are long; a single diagram may go through 5–30 revisions.
- Diagrams can be large (50+ nodes); syntax errors from agents are common and must be shown, not swallowed.

## Capabilities and Constraints

- MCP tools: `create_diagram`, `update_diagram`, `list_diagrams`, `get_diagram`, `get_feedback`, `resolve_feedback`.
- Viewer: live updates (WebSocket/SSE), revision history with source diff and visual comparison, node-anchored comments, export SVG / PNG / Markdown code block.
- Storage: local files under the project (undecided: `.flow/` directory vs. single JSON store).
- Undecided: multi-diagram projects UI depth, auth (assumed none; localhost only).

## Evidence on Hand

None. No users, testimonials, or benchmarks exist; do not invent any. Demo diagrams in the UI are synthetic.

## Product Principles

1. The diagram is the hero; chrome stays out of its way.
2. Every agent revision is visible, attributable, and reversible.
3. Feedback is anchored to the thing it is about.
4. Errors are shown plainly, with the last good render kept on screen.
