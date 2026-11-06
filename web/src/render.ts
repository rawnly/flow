import mermaid from "mermaid";

const C = {
  bg: "#0B0B0C",
  node: "#141416",
  border: "#34343A",
  text: "#EDEDEF",
  muted: "#9A9AA2",
  line: "#5C5C64",
  blue: "#4C7DFF",
  blueBg: "#111A33",
};

// Lives inside the SVG so on-screen and exported SVGs look identical.
const themeCSS = `
  .node rect, .node polygon, .node circle, .node ellipse, .node path { stroke-width: 1px; }
  .node rect { rx: 10px; ry: 10px; }
  .node .label, .nodeLabel { font-weight: 600; color: ${C.text}; line-height: 1.4; }
  .nodeLabel .sub { display: block; font-weight: 400; font-size: 12px; color: ${C.muted}; margin-top: 2px; }
  rect.actor { rx: 10px; ry: 10px; stroke-width: 1px; }
  text.actor > tspan { font-weight: 600; }
  .cluster rect { rx: 14px; ry: 14px; stroke-dasharray: 3 3; }
  .cluster-label .nodeLabel { font-weight: 500; color: ${C.muted}; font-size: 12px; }
  .edgeLabel, .edgeLabel p { color: ${C.muted}; font-size: 12px; background: ${C.bg} !important; }
  .labelBkg { background: ${C.bg} !important; }
  .flowchart-link { stroke-width: 1px; }
  .marker, marker path { fill: ${C.line}; stroke: ${C.line}; }
  .node.is-new rect, .node.is-new polygon, .node.is-new circle, .node.is-new path { stroke: ${C.blue}; fill: ${C.blueBg}; stroke-width: 1.5px; }
  .node.is-changed rect, .node.is-changed polygon, .node.is-changed circle, .node.is-changed path { stroke: ${C.blue}; stroke-dasharray: 4 3; }
  .flowchart-link.is-new { stroke: ${C.blue}; stroke-width: 1.5px; }
`;

mermaid.initialize({
  startOnLoad: false,
  look: "classic",
  securityLevel: "strict",
  theme: "base",
  darkMode: true,
  fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  themeCSS,
  themeVariables: {
    darkMode: true,
    background: C.bg,
    fontSize: "14px",
    primaryColor: C.node,
    primaryBorderColor: C.border,
    primaryTextColor: C.text,
    secondaryColor: "#18181B",
    secondaryBorderColor: C.border,
    secondaryTextColor: C.text,
    tertiaryColor: "#101012",
    tertiaryBorderColor: "#26262B",
    tertiaryTextColor: C.text,
    lineColor: C.line,
    textColor: C.text,
    mainBkg: C.node,
    nodeBorder: C.border,
    clusterBkg: "#0F0F11",
    clusterBorder: "#2A2A2F",
    titleColor: C.text,
    edgeLabelBackground: C.bg,
    noteBkgColor: "#1A1A1E",
    noteBorderColor: C.border,
    noteTextColor: C.text,
    actorBkg: C.node,
    actorBorder: C.border,
    actorTextColor: C.text,
    actorLineColor: "#3A3A40",
    signalColor: C.muted,
    signalTextColor: C.text,
    labelBoxBkgColor: C.node,
    labelBoxBorderColor: C.border,
    labelTextColor: C.text,
    loopTextColor: C.muted,
    activationBkgColor: "#1E1E22",
    activationBorderColor: C.border,
    sequenceNumberColor: C.bg,
  },
  flowchart: { curve: "linear", padding: 10, nodeSpacing: 40, rankSpacing: 56, htmlLabels: true, useMaxWidth: false },
  sequence: { useMaxWidth: false, actorMargin: 64, boxMargin: 12, messageFontWeight: 400 },
  er: { useMaxWidth: false },
  state: { useMaxWidth: false },
  class: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
});

/** Flowchart labels "Title<br/>subtitle" become a title plus a styled subtitle before Mermaid measures them. */
export function withSubtitles(source: string) {
  if (!/^\s*(flowchart|graph)\b/.test(source)) return source;
  return source.replace(/"([^"\n]*?)<br\s*\/?>([^"\n]*)"/g, (_m, title, sub) => `"${title}<span class='sub'>${sub.replace(/<br\s*\/?>/g, " ")}</span>"`);
}

let seq = 0;
const cache = new Map<string, Promise<string>>();

/** Renders Mermaid source to an SVG string. Cached by source; rejects with Mermaid's error. */
export function renderSvg(source: string): Promise<string> {
  let p = cache.get(source);
  if (!p) {
    p = mermaid.render(`flow-m${++seq}`, withSubtitles(source)).then((r) => r.svg);
    p.catch(() => cache.delete(source));
    cache.set(source, p);
    // Live preview renders on every pause in typing; keep the cache bounded.
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Turns `Title<br>subtitle` labels into a bold title and a muted subtitle. */
export function splitLabels(root: ParentNode) {
  root.querySelectorAll(".node .nodeLabel").forEach((label) => {
    const host = label.querySelector("p") ?? label;
    const br = host.querySelector("br");
    if (!br || host.querySelector(".sub")) return;
    const sub = document.createElement("span");
    sub.className = "sub";
    while (br.nextSibling) sub.appendChild(br.nextSibling);
    br.replaceWith(sub);
  });
}

// Node ids look like "flow-m3-flowchart-app-0"; the Mermaid node id is "app".
export const nodeIdOf = (g: Element) =>
  g.getAttribute("data-id") ??
  g.id.replace(/^flow-m\d+-/, "").replace(/^(flowchart|state|classId|entity)-/, "").replace(/-\d+$/, "");

/** The node's title line, without the subtitle. */
export function labelOf(g: Element) {
  const label = g.querySelector(".nodeLabel");
  if (!label) return (g.textContent ?? "").trim();
  const c = label.cloneNode(true) as Element;
  c.querySelector(".sub")?.remove();
  return (c.textContent ?? "").trim();
}

export type Inventory = { nodes: Map<string, string>; edges: Set<string> };

export function inventory(root: ParentNode): Inventory {
  const nodes = new Map<string, string>();
  root.querySelectorAll("g.node").forEach((g) => nodes.set(nodeIdOf(g), (g.textContent ?? "").trim()));
  const edges = new Set<string>();
  root.querySelectorAll(".flowchart-link").forEach((p) => edges.add((p.getAttribute("data-id") ?? p.id).replace(/_\d+$/, "")));
  return { nodes, edges };
}

export async function inventoryOf(source: string): Promise<Inventory> {
  const svg = await renderSvg(source);
  // HTML parsing: Mermaid's foreignObject labels contain <br>, which is invalid XML.
  return inventory(new DOMParser().parseFromString(svg, "text/html"));
}

/** Marks nodes and edges that are new (or relabelled) compared to `base`. Returns counts. */
export function markChanges(root: ParentNode, base: Inventory | null) {
  root.querySelectorAll(".is-new, .is-changed").forEach((el) => el.classList.remove("is-new", "is-changed"));
  if (!base) return { added: 0, changed: 0, edges: 0 };
  let added = 0, changed = 0, edges = 0;
  root.querySelectorAll("g.node").forEach((g) => {
    const id = nodeIdOf(g);
    if (!base.nodes.has(id)) (g.classList.add("is-new"), added++);
    else if (base.nodes.get(id) !== (g.textContent ?? "").trim()) (g.classList.add("is-changed"), changed++);
  });
  root.querySelectorAll(".flowchart-link").forEach((p) => {
    if (!base.edges.has((p.getAttribute("data-id") ?? p.id).replace(/_\d+$/, ""))) (p.classList.add("is-new"), edges++);
  });
  return { added, changed, edges };
}

/** Standalone SVG for export: change highlights removed, dark background baked in. */
export function exportSvg(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".is-new, .is-changed, .is-focus").forEach((el) => el.classList.remove("is-new", "is-changed", "is-focus"));
  const vb = svg.viewBox.baseVal;
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  Object.entries({ x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: C.bg }).forEach(([k, v]) => bg.setAttribute(k, String(v)));
  clone.insertBefore(bg, clone.firstChild);
  clone.setAttribute("width", String(vb.width));
  clone.setAttribute("height", String(vb.height));
  clone.removeAttribute("style");
  return { text: new XMLSerializer().serializeToString(clone), width: vb.width, height: vb.height };
}

// shortcut: PNG uses system fonts because SVG-as-image cannot load web fonts; embed the font as a data URI if exact type matters.
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const { text, width, height } = exportSvg(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("PNG encoding failed"))), "image/png"));
}
