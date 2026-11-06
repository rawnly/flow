---
name: flow
description: Draw and iterate on Mermaid diagrams the user watches live in the Flow viewer, and handle their node comments. Use when the user asks for a diagram, flowchart, architecture sketch, sequence, state machine, ER diagram, or says "flow", or when Flow feedback arrives.
---

# Flow

Flow is a live canvas: you write Mermaid through the Flow tools, the user watches each revision render at <http://127.0.0.1:4729>, clicks nodes to comment, and can edit the source themselves. Comments are drafts until the user presses **Send to agent**, so feedback arrives as one complete review, never half-written.

## Tools

| Tool | Use it to |
|---|---|
| `create_diagram {title, source, note?}` | Start a diagram. Returns its `id` and viewer URL. |
| `update_diagram {id, source, note?, title?}` | Save a new revision. Always the **full** source, never a patch. |
| `list_diagrams` | Find existing diagrams (check before creating a duplicate). |
| `get_diagram {id, revision?}` | Read the current (or an old) source and history. |
| `get_feedback {id, includeResolved?}` | Read open comments, each anchored to a node id. |
| `wait_for_feedback {id?, timeoutSec?}` | Block until the user sends a review (default 50s, max 600s). |
| `resolve_feedback {id, feedbackId, reply?}` | Close a comment after a revision fixes it. |

## Workflow

1. **Reuse first.** If the user refers to an existing diagram, `list_diagrams` then `get_diagram`. Otherwise `create_diagram`.
2. **Show, don't paste.** Put Mermaid in the tool, not the chat. In chat, give the viewer URL and a one-line summary.
3. **Revise with intent.** Every `update_diagram` gets a short `note` saying what changed ("split API into gateway + worker"). The viewer highlights the diff on its own.
4. **Close the loop on feedback.** For each open item: change the diagram, `update_diagram`, then `resolve_feedback` with a short reply. Resolve only what the revision actually fixed; reply to explain if you chose not to change something.
5. **Hand off to the viewer and wait.** In Claude Code with the Flow plugin, a hook does this for you: after you draw, it holds until the user sends a review (it comes back as hook feedback) or presses **Looks good** (you're told to carry on). Then don't call `wait_for_feedback`. In other clients (not pi), wait yourself: after `create_diagram` or `update_diagram`, call `wait_for_feedback {id, timeoutSec: 600}` so the user can comment right away without prompting you. When it returns feedback, address it (step 4) and wait again. When it times out with no feedback, stop waiting and end your turn, saying the user can comment in the viewer anytime. Skip waiting only if the user said they don't want to review ("just draw it"). With the Claude Code plugin's hooks, comments left later still reach you on the next prompt or before you stop.

In pi, feedback arrives on its own as a `flow-feedback` message; just address it (step 4). `/flow [id]` opens the viewer.

## Never clobber the user

The user can edit in the viewer. If `update_diagram` is refused with "Not saved: revision rN was written by …", it returns the current source: **apply your change on top of that source and retry**. Never re-send your old version. Feedback of kind `edit` also ships the current source; treat their edit as the new baseline and only tidy around it.

## Style

- One node per component: short bold title, optional subtitle on a second line: `api["API Gateway<br/>auth, rate limit"]`.
- Stable, meaningful node ids (`api`, `queue`, `db`), not `A`, `B`, `C`. Comments are anchored to ids, so keep ids stable across revisions.
- No colors, `classDef`, or `style` lines; the viewer themes and highlights changes itself.
- Pick the right diagram type: `flowchart` for architecture/process, `sequenceDiagram` for interactions over time, `stateDiagram-v2` for lifecycles, `erDiagram` for data models.
- Keep it readable: roughly 5–20 nodes. Use `subgraph` to group; split into a second diagram rather than cramming.
- Quote labels containing punctuation: `n["Retry (3x)"]`.

## Errors

- "Mermaid did not parse": nothing was saved. Fix the syntax from the parser error and call again.
- "Source is identical": you sent no change; nothing to do.
- "No diagram with id": call `list_diagrams`.
