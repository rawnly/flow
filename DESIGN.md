# Design

Flow's viewer is a dark technical document: the diagram is a quiet figure, and the chrome stays one step behind it. The world comes from a user-supplied reference: hairline rounded nodes with a bold title and a muted subtitle, blue reserved for what changed.

## Color
| Token | Value | Job |
|---|---|---|
| `--bg` | #0B0B0C | canvas ground, dotted 24px grid `#1D1D22` |
| `--panel` | #101012 | rail and side panel |
| `--raised` | #16161A | buttons, selected rows, chips |
| `--line` / `--line-2` | #222227 / #2E2E34 | seams / control borders |
| `--text` / `-2` / `-3` | #EDEDEF / #A8A8B0 / #85858E | primary / secondary / meta |
| `--blue` | #4C7DFF (bg #111A33) | **only** "new in this revision", plus focus rings and switches |
| `--coral` | #FF7A59 (bg #2A1610) | **only** human feedback: pins, counts, composer |
| `--green` / `--red` / `--amber` | #45B883 / #F0645A / #E5A443 | resolved & additions / deletions & danger / render errors, disconnected |

Diagram nodes: fill #141416, stroke #34343A 1px, radius 10. Edges #5C5C64 1px. New nodes: blue stroke 1.5px on #111A33. Relabelled: dashed blue. Focused by feedback: coral, everything else dims to 28%.

## Type
- Geist Variable: UI and diagram labels. 13.5px body, 15px titles, 12–12.5px meta. Node title 600, subtitle 400 12px muted.
- Geist Mono Variable: revision numbers, source, diffs, zoom level.
- Source Serif 4 Variable: the figure title on the canvas (22px) and onboarding heading only.

## Shape and depth
Radii 6 / 10 / 14. Panels separate by 1px seams, not shadows. Only floating things (menus, composer, zoom pill, toast) get a soft offset shadow.

## Layout
Three columns: 248px rail, fluid canvas, 344px panel. 56px bars everywhere. At ≤900px the rail becomes a horizontal strip and the panel stacks below.

## Motion
One ease, `cubic-bezier(.16,1,.3,1)`. Popovers scale in from 97%, focus dimming fades in 250ms. Reduced motion disables all of it.

## Signature
Automatic change highlighting: each render diffs node ids, labels and edges against the previous revision, paints what is new in blue and writes the caption ("Highlighted parts are new since r2 (1 node, 1 connection)").
