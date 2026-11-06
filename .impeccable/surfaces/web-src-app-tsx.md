---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: []
---

# Viewer (web/)

Scope: the Flow viewer, the localhost app where a human watches agent-authored Mermaid diagrams, comments on nodes, browses revisions, and exports. Mode: Operate.

Audience/job: a developer beside their terminal, watching an agent iterate on one diagram over 5–30 revisions. Task: see what changed, point at what is wrong, take the result away.

Constraints: the diagram is the hero; render errors keep the last good render on screen; feedback is node-anchored and readable by the agent over MCP.

## Direction contract

THESIS: A diagram as a quiet technical figure in a dark document. Refuses the split code-editor/preview playground; source is a tab, not a pane.

OWN-WORLD: Near-black ground (#0B0B0C), panels one step up with 1px hairline seams, 10px radii. Nodes are hairline rounded rects with a bold title and a muted subtitle line. One blue (#4C7DFF) means "new in this revision" and nothing else; coral (#FF7A59) means human feedback and nothing else. Geist + Geist Mono, Source Serif 4 only for the figure title.

STORY: The visitor sees the latest figure, instantly reads what the agent changed, clicks a node to leave feedback, watches the agent resolve it in the next revision, exports.

FIRST VIEWPORT: Left 240px rail of diagrams with live dots. Center: header (title, revision chip, Diagram/Source/Changes tabs, Copy/Export), canvas with serif figure title + caption "Highlighted parts are new in r12", diagram centered at fit. Right 340px panel: Feedback/History tabs.

FORM: brief-pinned (user reference screenshot) after two re-rolls; seed:4d60e636b8cdde01. Signature move: automatic change highlighting, new nodes and edges in blue with an auto caption, toggleable, against any earlier revision.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
