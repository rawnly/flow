import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { inventoryOf, labelOf, markChanges, nodeIdOf, renderSvg, splitLabels } from "./render";
import type { Feedback } from "./types";
import { Icon } from "./icons";

type Box = { x: number; y: number; w: number; h: number };
type T = { x: number; y: number; k: number };
export type Changes = { added: number; changed: number; edges: number } | null;

type Props = {
  fitKey: string;
  source: string;
  baseSource: string | null;
  head: (changes: Changes) => ReactNode;
  feedback: Feedback[];
  focusNode: string | null;
  onFocusPin: (fid: string) => void;
  onComment: (nodeId: string, label: string, text: string) => Promise<void>;
  onSvg: (svg: SVGSVGElement | null) => void;
  /** false: a preview. No pins, no comments, nodes aren't buttons. */
  interactive?: boolean;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function Canvas({ fitKey, source, baseSource, head, feedback, focusNode, onFocusPin, onComment, onSvg, interactive = true }: Props) {
  const vp = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState<T>({ x: 0, y: 0, k: 1 });
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [changes, setChanges] = useState<Changes>(null);
  const [composer, setComposer] = useState<{ nodeId: string; label: string; box: Box } | null>(null);
  const moved = useRef(false);
  // Callers pass inline callbacks; keep them out of effect deps so a re-render never re-injects the SVG.
  const onSvgRef = useRef(onSvg);
  onSvgRef.current = onSvg;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    moved.current = false;
    setSvg(null);
    setComposer(null);
  }, [fitKey]);

  useEffect(() => {
    let live = true;
    renderSvg(source).then(
      (s) => live && (setSvg(s), setError(null)),
      (e) => live && setError(String(e?.message ?? e)),
    );
    return () => void (live = false);
  }, [source]);

  const fit = useCallback(() => {
    const el = host.current?.querySelector("svg");
    const v = vp.current;
    if (!el || !v) return;
    const { width: w, height: h } = el.viewBox.baseVal;
    const top = 104, bottom = 72, side = 56;
    const k = clamp(Math.min((v.clientWidth - side * 2) / w, (v.clientHeight - top - bottom) / h), 0.2, 1);
    setT({ k, x: (v.clientWidth - w * k) / 2, y: top + (v.clientHeight - top - bottom - h * k) / 2 });
  }, []);

  useLayoutEffect(() => {
    const h = host.current;
    if (!h || !svg) return;
    h.innerHTML = svg;
    const el = h.querySelector("svg")!;
    const vb = el.viewBox.baseVal;
    Object.assign(el.style, { width: `${vb.width}px`, height: `${vb.height}px`, maxWidth: "none" });
    splitLabels(h);
    h.classList.toggle("is-preview", !interactive);
    if (interactive) h.querySelectorAll("g.node").forEach((g) => {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `Comment on ${labelOf(g)}`);
    });
    const scale = h.getBoundingClientRect().width / h.offsetWidth || 1;
    const hr = h.getBoundingClientRect();
    const m = new Map<string, Box>();
    h.querySelectorAll("g.node").forEach((g) => {
      const r = g.getBoundingClientRect();
      m.set(nodeIdOf(g), { x: (r.left - hr.left) / scale, y: (r.top - hr.top) / scale, w: r.width / scale, h: r.height / scale });
    });
    setBoxes(m);
    onSvgRef.current(el);
    if (!moved.current) fit();
    return () => onSvgRef.current(null);
  }, [svg, fit, interactive]);

  useEffect(() => {
    const h = host.current;
    if (!h || !svg) return;
    if (!baseSource) {
      markChanges(h, null);
      return setChanges(null);
    }
    let live = true;
    inventoryOf(baseSource).then(
      (inv) => live && setChanges(markChanges(h, inv)),
      () => live && (markChanges(h, null), setChanges(null)),
    );
    return () => void (live = false);
  }, [svg, baseSource]);

  useEffect(() => {
    const h = host.current;
    if (!h) return;
    h.querySelectorAll(".is-focus").forEach((g) => g.classList.remove("is-focus"));
    h.classList.toggle("is-focusing", !!focusNode);
    if (focusNode) h.querySelectorAll("g.node").forEach((g) => nodeIdOf(g) === focusNode && g.classList.add("is-focus"));
  }, [focusNode, svg]);

  // Wheel: pinch / ⌘ zooms around the cursor, plain wheel pans.
  useEffect(() => {
    const v = vp.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      const { x, y, k } = tRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = v.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const nk = clamp(k * Math.exp(-e.deltaY * 0.01), 0.15, 4);
        setT({ k: nk, x: px - ((px - x) * nk) / k, y: py - ((py - y) * nk) / k });
      } else setT({ k, x: x - e.deltaX, y: y - e.deltaY });
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const v = vp.current!;
    moved.current = true;
    const { x, y, k } = t;
    const nk = clamp(k * f, 0.15, 4), cx = v.clientWidth / 2, cy = v.clientHeight / 2;
    setT({ k: nk, x: cx - ((cx - x) * nk) / k, y: cy - ((cy - y) * nk) / k });
  };

  const openComposer = (g: Element) => {
    const id = nodeIdOf(g);
    const box = boxes.get(id);
    if (box) setComposer({ nodeId: id, label: labelOf(g), box });
  };

  const drag = useRef<{ sx: number; sy: number; x: number; y: number; dragging: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest(".no-pan")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, x: t.x, y: t.y, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.dragging && Math.hypot(dx, dy) > 4) {
      d.dragging = true;
      moved.current = true;
      vp.current!.setPointerCapture(e.pointerId);
    }
    if (d.dragging) setT((p) => ({ ...p, x: d.x + dx, y: d.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.dragging) return;
    const g = interactive && (e.target as Element).closest("g.node");
    if (g) openComposer(g);
    else setComposer(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const g = interactive && (e.target as Element).closest?.("g.node");
    if (g && (e.key === "Enter" || e.key === " ")) (e.preventDefault(), openComposer(g));
    if (e.key === "Escape") setComposer(null);
  };

  const open = interactive ? feedback.filter((f) => f.status !== "resolved") : [];
  const pins = new Map<string, number[]>();
  open.forEach((f, i) => f.nodeId && boxes.has(f.nodeId) && pins.set(f.nodeId, [...(pins.get(f.nodeId) ?? []), i]));

  return (
    <div className="canvas" ref={vp} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onKeyDown={onKeyDown}>
      <div className="figure-head no-pan">{head(changes)}</div>

      <div className="layer" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
        <div className="svg-host" ref={host} />
        {[...pins].map(([nodeId, idx]) => {
          const b = boxes.get(nodeId)!;
          const f = open[idx[0]];
          return (
            <button
              key={nodeId}
              className={`pin no-pan${focusNode === nodeId ? " is-active" : ""}`}
              style={{ left: b.x + b.w, top: b.y, transform: `translate(-50%, -50%) scale(${1 / t.k})` }}
              onClick={() => onFocusPin(f.id)}
              aria-label={`${idx.length} feedback on ${f.nodeLabel ?? nodeId}`}
            >
              {idx.map((i) => i + 1).join("·")}
            </button>
          );
        })}
      </div>

      {composer && (
        <Composer
          key={composer.nodeId}
          label={composer.label}
          style={{
            left: clamp(t.x + (composer.box.x + composer.box.w / 2) * t.k - 170, 12, (vp.current?.clientWidth ?? 800) - 352),
            top: t.y + (composer.box.y + composer.box.h) * t.k + 12,
          }}
          onCancel={() => setComposer(null)}
          onSubmit={async (text) => {
            await onComment(composer.nodeId, composer.label, text);
            setComposer(null);
          }}
        />
      )}

      {error && (
        <div className={`render-error no-pan${svg ? "" : " is-blocking"}`} role="alert">
          <Icon.alert />
          <div>
            <strong>{svg ? "This revision didn’t render. Showing the last good render." : "This diagram didn’t render."}</strong>
            <pre>{error}</pre>
          </div>
        </div>
      )}
      {!svg && !error && <div className="canvas-loading">Rendering…</div>}

      <div className="zoom no-pan" role="group" aria-label="Zoom">
        <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Icon.minus /></button>
        <button className="zoom-level" onClick={() => (moved.current = false, fit())} title="Fit to screen">{Math.round(t.k * 100)}%</button>
        <button onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Icon.plus /></button>
        <span className="zoom-sep" />
        <button onClick={() => (moved.current = false, fit())} aria-label="Fit to screen"><Icon.fit /></button>
      </div>
    </div>
  );
}

function Composer({ label, style, onCancel, onSubmit }: { label: string; style: React.CSSProperties; onCancel: () => void; onSubmit: (t: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(text.trim());
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <form className="composer no-pan" style={style} onSubmit={(e) => (e.preventDefault(), send())}>
      <div className="composer-head">
        <span className="composer-node">{label}</span>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon.close /></button>
      </div>
      <textarea
        autoFocus
        value={text}
        placeholder="What should the agent change here?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), send());
          if (e.key === "Escape") onCancel();
        }}
        rows={3}
        aria-label={`Feedback on ${label}`}
      />
      {err && <p className="composer-err">{err}</p>}
      <div className="composer-foot">
        <span className="hint"><kbd>⌘</kbd><kbd>↵</kbd> to add</span>
        <button className="btn btn-coral" disabled={!text.trim() || busy}>{busy ? "Adding…" : "Add comment"}</button>
      </div>
    </form>
  );
}
