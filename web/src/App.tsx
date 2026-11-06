import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import { ago, api } from "./api";
import { Canvas, type Changes } from "./Canvas";
import { Icon } from "./icons";
import { exportSvg, svgToPng } from "./render";
import type { Diagram, DiagramSummary, Feedback, Revision } from "./types";

const idFromHash = () => location.hash.match(/^#\/d\/([a-z0-9-]+)/)?.[1] ?? null;
type Tab = "diagram" | "source" | "changes";

export function App() {
  const [list, setList] = useState<DiagramSummary[] | null>(null);
  const [id, setId] = useState<string | null>(idFromHash);
  const [d, setD] = useState<Diagram | null>(null);
  const [viewN, setViewN] = useState<number | null>(null); // null = follow latest
  const [tab, setTab] = useState<Tab>("diagram");
  const [side, setSide] = useState<"feedback" | "history">("feedback");
  const [highlight, setHighlight] = useState(() => localStorage.getItem("flow.highlight") !== "off");
  const [focusFid, setFocusFid] = useState<string | null>(null);
  const [conn, setConn] = useState<"live" | "down">("live");
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const svgEl = useRef<SVGSVGElement | null>(null);
  const onSvg = useCallback((s: SVGSVGElement | null) => void (svgEl.current = s), []);
  const idRef = useRef(id);
  idRef.current = id;
  const viewRef = useRef(viewN);
  viewRef.current = viewN;

  const say = useCallback((text: string, action?: { label: string; run: () => void }) => setToast({ text, action }), []);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), toast.action ? 8000 : 2600);
    return () => clearTimeout(h);
  }, [toast]);

  const loadList = useCallback(() => api.list().then(setList).catch(() => setList((l) => l ?? [])), []);
  const loadDiagram = useCallback(
    async (which: string, live = false) => {
      try {
        const next = await api.get(which);
        if (which !== idRef.current) return;
        setD((prev) => {
          const before = prev?.id === which ? prev.revisions.at(-1)!.n : null;
          const now = next.revisions.at(-1)!.n;
          if (live && before && now > before && viewRef.current !== null)
            say(`Revision ${now} arrived`, { label: "View latest", run: () => setViewN(null) });
          return next;
        });
      } catch {
        if (which === idRef.current) setD(null);
      }
    },
    [say],
  );

  useEffect(() => {
    const on = () => setId(idFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  useEffect(() => void loadList(), [loadList]);

  // Default to the most recently updated diagram.
  useEffect(() => {
    if (!id && list?.length) location.replace(`#/d/${list[0].id}`);
  }, [id, list]);

  useEffect(() => {
    setD(null);
    setViewN(null);
    setFocusFid(null);
    setTab("diagram");
    if (id) loadDiagram(id);
  }, [id, loadDiagram]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConn("live");
    es.onerror = () => setConn("down");
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type !== "changed") return;
      loadList();
      if (msg.id === idRef.current) loadDiagram(msg.id, true);
    };
    return () => es.close();
  }, [loadList, loadDiagram]);

  const latest = d?.revisions.at(-1) ?? null;
  const rev = (viewN !== null && d?.revisions.find((r) => r.n === viewN)) || latest;
  const prev = d && rev ? d.revisions.find((r) => r.n === rev.n - 1) ?? null : null;
  const focusNode = d?.feedback.find((f) => f.id === focusFid)?.nodeId ?? null;

  const step = useCallback(
    (dir: -1 | 1) => {
      if (!d || !rev) return;
      const n = clampN(rev.n + dir, d.revisions[0].n, latest!.n);
      setViewN(n === latest!.n ? null : n);
    },
    [d, rev, latest],
  );

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "[") step(-1);
      if (e.key === "]") step(1);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [step]);

  const toggleHighlight = () => {
    setHighlight((h) => (localStorage.setItem("flow.highlight", h ? "off" : "on"), !h));
  };

  const copyMarkdown = async () => {
    if (!rev) return;
    await navigator.clipboard.writeText("```mermaid\n" + rev.source.trimEnd() + "\n```\n");
    say("Copied as a Markdown code block");
  };

  const download = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const exportAs = async (kind: "svg" | "png" | "svg-copy") => {
    const s = svgEl.current;
    if (!s || !d || !rev) return say("Switch to the Diagram tab to export");
    const name = `${d.id}-r${rev.n}`;
    try {
      if (kind === "svg") download(new Blob([exportSvg(s).text], { type: "image/svg+xml" }), `${name}.svg`);
      if (kind === "png") download(await svgToPng(s), `${name}.png`);
      if (kind === "svg-copy") (await navigator.clipboard.writeText(exportSvg(s).text), say("SVG markup copied"));
    } catch (e: any) {
      say(`Export failed: ${e.message}`);
    }
  };

  const mutateFeedback = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      if (msg) say(msg);
      if (id) await loadDiagram(id);
      loadList();
    } catch (e: any) {
      say(e.message);
      throw e;
    }
  };

  const comment = (nodeId: string | null, nodeLabel: string | undefined, text: string) =>
    mutateFeedback(() => api.addFeedback(d!.id, { nodeId, nodeLabel, text, revision: rev!.n }), "Sent. The agent sees it on its next get_feedback.");

  return (
    <div className="app">
      <Rail list={list} current={id} conn={conn} />

      <main className="main">
        {!list ? null : !list.length ? (
          <Onboarding />
        ) : !d || !rev ? (
          <div className="canvas-loading">Loading…</div>
        ) : (
          <>
            <header className="bar">
              <div className="bar-title">
                <h1>{d.title}</h1>
                {viewN !== null ? (
                  <span className="chip chip-old">
                    Viewing r{rev.n} of {latest!.n}
                    <button onClick={() => setViewN(null)}>Back to latest</button>
                  </span>
                ) : (
                  <span className="chip">r{rev.n}</span>
                )}
              </div>
              <nav className="seg" aria-label="View">
                {(["diagram", "source", "changes"] as Tab[]).map((t) => (
                  <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} disabled={t === "changes" && !prev}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </nav>
              <div className="bar-actions">
                <button className="btn" onClick={copyMarkdown}>
                  <Icon.copy /> Copy Markdown
                </button>
                <ExportMenu onPick={exportAs} disabled={tab !== "diagram"} />
              </div>
            </header>

            {tab === "diagram" && (
              <Canvas
                fitKey={d.id}
                source={rev.source}
                baseSource={highlight && prev ? prev.source : null}
                feedback={d.feedback}
                focusNode={focusNode}
                onFocusPin={(fid) => (setSide("feedback"), setFocusFid((f) => (f === fid ? null : fid)))}
                onComment={(nodeId, label, text) => comment(nodeId, label, text)}
                onSvg={onSvg}
                head={(c) => <FigureHead title={d.title} rev={rev} prev={prev} changes={c} highlight={highlight} onToggle={toggleHighlight} note={rev.note} />}
              />
            )}
            {tab === "source" && <SourceView source={rev.source} onCopy={copyMarkdown} />}
            {tab === "changes" && prev && <ChangesView revisions={d.revisions} rev={rev} />}
          </>
        )}
      </main>

      {d && rev && (
        <aside className="panel" aria-label="Diagram details">
          <div className="panel-tabs" role="tablist">
            <button role="tab" aria-selected={side === "feedback"} onClick={() => setSide("feedback")}>
              Feedback {d.feedback.some((f) => f.status === "open") && <span className="count">{d.feedback.filter((f) => f.status === "open").length}</span>}
            </button>
            <button role="tab" aria-selected={side === "history"} onClick={() => setSide("history")}>
              History <span className="count count-quiet">{d.revisions.length}</span>
            </button>
          </div>
          {side === "feedback" ? (
            <FeedbackPanel
              items={d.feedback}
              focusFid={focusFid}
              onFocus={(fid) => {
                setFocusFid(fid);
                if (fid) setTab("diagram");
              }}
              onResolve={(f) => mutateFeedback(() => api.setFeedback(d.id, f.id, f.status === "open" ? "resolved" : "open"), f.status === "open" ? "Marked resolved" : "Reopened")}
              onDelete={(f) => mutateFeedback(() => api.deleteFeedback(d.id, f.id), "Feedback deleted")}
              onComment={(text) => comment(null, undefined, text)}
            />
          ) : (
            <HistoryPanel revisions={d.revisions} current={rev.n} latest={latest!.n} onPick={(n) => setViewN(n === latest!.n ? null : n)} />
          )}
        </aside>
      )}

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.text}>
            {toast.text}
            {toast.action && (
              <button onClick={() => (toast.action!.run(), setToast(null))}>{toast.action.label}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Trailing-newline differences would otherwise show the last line as changed.
const nl = (s: string) => (s.endsWith("\n") ? s : s + "\n");
const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function Rail({ list, current, conn }: { list: DiagramSummary[] | null; current: string | null; conn: "live" | "down" }) {
  return (
    <nav className="rail" aria-label="Diagrams">
      <div className="brand">
        <span className="brand-mark"><Icon.logo /></span>Flow
      </div>
      <div className="rail-label">Diagrams</div>
      <ul className="rail-list">
        {list?.map((x) => (
          <li key={x.id}>
            <a href={`#/d/${x.id}`} aria-current={x.id === current ? "page" : undefined}>
              <span className="rail-name">{x.title}</span>
              {x.openFeedback > 0 && <span className="rail-fb" title={`${x.openFeedback} open feedback`}>{x.openFeedback}</span>}
              <span className="rail-rev">r{x.revision}</span>
              <span className="rail-sub">{ago(x.updatedAt)}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className={`conn conn-${conn}`}>
        <span className="conn-dot" />
        {conn === "live" ? "Live · watching for agent changes" : "Disconnected · retrying"}
      </div>
    </nav>
  );
}

function FigureHead({ title, rev, prev, changes, highlight, onToggle, note }: { title: string; rev: Revision; prev: Revision | null; changes: Changes; highlight: boolean; onToggle: () => void; note?: string }) {
  const parts: string[] = [];
  if (changes) {
    if (changes.added) parts.push(`${changes.added} node${changes.added > 1 ? "s" : ""}`);
    if (changes.edges) parts.push(`${changes.edges} connection${changes.edges > 1 ? "s" : ""}`);
    if (changes.changed) parts.push(`${changes.changed} relabelled`);
  }
  const caption = !prev
    ? "First revision."
    : !highlight
      ? `Revision ${rev.n}. Change highlighting is off.`
      : changes && !parts.length
        ? `No new parts since r${prev.n}; layout or styling only.`
        : `Highlighted parts are new since r${prev.n}${parts.length ? ` (${parts.join(", ")})` : ""}.`;
  return (
    <>
      <h2>{title}</h2>
      <p>
        {note && <><span className="figure-note">{note}</span><span className="sep" aria-hidden="true">·</span></>}
        {caption}
      </p>
      {prev && (
        <label className="switch">
          <input type="checkbox" checked={highlight} onChange={onToggle} />
          <span className="switch-track" aria-hidden="true" />
          Highlight changes
        </label>
      )}
    </>
  );
}

function ExportMenu({ onPick, disabled }: { onPick: (k: "svg" | "png" | "svg-copy") => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", close);
    addEventListener("keydown", esc);
    return () => (removeEventListener("pointerdown", close), removeEventListener("keydown", esc));
  }, [open]);
  const pick = (k: "svg" | "png" | "svg-copy") => (setOpen(false), onPick(k));
  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={disabled} title={disabled ? "Switch to the Diagram tab to export" : undefined}>
        <Icon.download /> Export <Icon.chevron />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button role="menuitem" onClick={() => pick("svg")}>Download SVG<span>Vector, keeps text</span></button>
          <button role="menuitem" onClick={() => pick("png")}>Download PNG<span>2× resolution</span></button>
          <button role="menuitem" onClick={() => pick("svg-copy")}>Copy SVG markup<span>Paste into Figma or docs</span></button>
        </div>
      )}
    </div>
  );
}

function SourceView({ source, onCopy }: { source: string; onCopy: () => void }) {
  const lines = source.replace(/\n$/, "").split("\n");
  return (
    <div className="code-view">
      <div className="code-head">
        <span>{lines.length} lines · Mermaid</span>
        <button className="btn btn-quiet" onClick={onCopy}><Icon.copy /> Copy Markdown</button>
      </div>
      <pre className="code">
        {lines.map((l, i) => (
          <div className="code-line" key={i}>
            <span className="ln">{i + 1}</span>
            <span>{l || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function ChangesView({ revisions, rev }: { revisions: Revision[]; rev: Revision }) {
  const earlier = revisions.filter((r) => r.n < rev.n);
  const [baseN, setBaseN] = useState(earlier.at(-1)!.n);
  useEffect(() => setBaseN(revisions.filter((r) => r.n < rev.n).at(-1)!.n), [rev.n, revisions]);
  const base = revisions.find((r) => r.n === baseN) ?? earlier.at(-1)!;
  const parts = useMemo(() => diffLines(nl(base.source), nl(rev.source)), [base.source, rev.source]);
  const added = parts.filter((p) => p.added).reduce((s, p) => s + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((s, p) => s + (p.count ?? 0), 0);
  let a = 0, b = 0;
  return (
    <div className="code-view">
      <div className="code-head">
        <label className="compare">
          Compare
          <select value={base.n} onChange={(e) => setBaseN(Number(e.target.value))}>
            {earlier.map((r) => <option key={r.n} value={r.n}>r{r.n}</option>)}
          </select>
          → r{rev.n}
        </label>
        <span><span className="add">+{added}</span> <span className="del">−{removed}</span></span>
      </div>
      <pre className="code">
        {parts.flatMap((p, pi) =>
          p.value.replace(/\n$/, "").split("\n").map((l, i) => {
            const kind = p.added ? "add" : p.removed ? "del" : "same";
            const la = p.added ? "" : ++a, lb = p.removed ? "" : ++b;
            return (
              <div className={`code-line diff-${kind}`} key={`${pi}-${i}`}>
                <span className="ln">{la}</span>
                <span className="ln">{lb}</span>
                <span className="sign">{p.added ? "+" : p.removed ? "−" : ""}</span>
                <span>{l || " "}</span>
              </div>
            );
          }),
        )}
      </pre>
    </div>
  );
}

function FeedbackPanel({ items, focusFid, onFocus, onResolve, onDelete, onComment }: { items: Feedback[]; focusFid: string | null; onFocus: (fid: string | null) => void; onResolve: (f: Feedback) => Promise<void>; onDelete: (f: Feedback) => Promise<void>; onComment: (text: string) => Promise<void> }) {
  const open = items.filter((f) => f.status === "open");
  const done = items.filter((f) => f.status === "resolved").reverse();
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onComment(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel-body">
      <div className="panel-scroll">
        {!open.length && (
          <div className="empty">
            <Icon.comment />
            <p><strong>No open feedback.</strong> Click any node in the diagram to tell the agent what to change there.</p>
          </div>
        )}
        <ol className="fb-list">
          {open.map((f, i) => (
            <FeedbackItem key={f.id} f={f} n={i + 1} active={focusFid === f.id} onFocus={onFocus} onResolve={onResolve} onDelete={onDelete} />
          ))}
        </ol>
        {done.length > 0 && (
          <>
            <button className="fb-toggle" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
              <Icon.chevron style={{ transform: showDone ? "none" : "rotate(-90deg)" }} /> Resolved <span className="count count-quiet">{done.length}</span>
            </button>
            {showDone && (
              <ol className="fb-list">
                {done.map((f) => <FeedbackItem key={f.id} f={f} active={focusFid === f.id} onFocus={onFocus} onResolve={onResolve} onDelete={onDelete} />)}
              </ol>
            )}
          </>
        )}
      </div>
      <form className="general" onSubmit={(e) => (e.preventDefault(), send())}>
        <textarea
          value={text}
          rows={2}
          placeholder="Feedback on the whole diagram…"
          aria-label="Feedback on the whole diagram"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), send())}
        />
        <button className="icon-btn icon-btn-solid" disabled={!text.trim() || busy} aria-label="Send to agent"><Icon.send /></button>
      </form>
    </div>
  );
}

function FeedbackItem({ f, n, active, onFocus, onResolve, onDelete }: { f: Feedback; n?: number; active: boolean; onFocus: (fid: string | null) => void; onResolve: (f: Feedback) => Promise<void>; onDelete: (f: Feedback) => Promise<void> }) {
  const resolved = f.status === "resolved";
  return (
    <li
      className={`fb${active ? " is-active" : ""}${resolved ? " is-resolved" : ""}`}
      onMouseEnter={() => f.nodeId && onFocus(f.id)}
      onMouseLeave={() => !active && onFocus(null)}
    >
      <button className="fb-main" onClick={() => onFocus(active ? null : f.id)} aria-pressed={active}>
        <span className="fb-head">
          <span className={`fb-pin${resolved ? " is-done" : ""}`}>{resolved ? <Icon.check /> : n}</span>
          <span className="fb-node">{f.nodeLabel ?? (f.nodeId ? f.nodeId : "Whole diagram")}</span>
          <span className="fb-time">{ago(f.createdAt)} · r{f.revision}</span>
        </span>
        <span className="fb-text">{f.text}</span>
        {resolved && (
          <span className="fb-reply">
            <span className="fb-resolved">Resolved in r{f.resolvedIn}</span>
            {f.reply && <span>{f.reply}</span>}
          </span>
        )}
      </button>
      <span className="fb-actions">
        <button className="btn btn-quiet btn-sm" onClick={() => onResolve(f).catch(() => {})}>
          {resolved ? <><Icon.undo /> Reopen</> : <><Icon.check /> Resolve</>}
        </button>
        <button className="icon-btn icon-btn-danger" onClick={() => onDelete(f).catch(() => {})} aria-label="Delete feedback"><Icon.trash /></button>
      </span>
    </li>
  );
}

function HistoryPanel({ revisions, current, latest, onPick }: { revisions: Revision[]; current: number; latest: number; onPick: (n: number) => void }) {
  const rows = useMemo(
    () =>
      revisions
        .map((r, i) => {
          const p = revisions[i - 1];
          let add = 0, del = 0;
          if (p) for (const c of diffLines(nl(p.source), nl(r.source))) c.added ? (add += c.count ?? 0) : c.removed && (del += c.count ?? 0);
          return { r, add, del, first: !p };
        })
        .reverse(),
    [revisions],
  );
  return (
    <div className="panel-body">
      <ol className="panel-scroll hist" aria-label="Revisions">
        {rows.map(({ r, add, del, first }) => (
          <li key={r.n}>
            <button className="hist-row" aria-current={r.n === current ? "true" : undefined} onClick={() => onPick(r.n)}>
              <span className="hist-n">r{r.n}</span>
              <span className="hist-body">
                <span className="hist-note">{r.note || (first ? "Created" : "No description")}</span>
                <span className="hist-meta">
                  {r.author} · {ago(r.createdAt)}
                  {r.n === latest && <span className="tag">Latest</span>}
                </span>
              </span>
              <span className="hist-delta">
                {first ? <span className="muted">new</span> : <><span className="add">+{add}</span> <span className="del">−{del}</span></>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="panel-hint"><kbd>[</kbd> <kbd>]</kbd> step through revisions</p>
    </div>
  );
}

function Onboarding() {
  const [path, setPath] = useState("<path-to-flow>/dist/server/mcp.js");
  useEffect(() => void fetch("/api/info").then((r) => r.json()).then((i) => i.mcpPath && setPath(i.mcpPath)).catch(() => {}), []);
  const cmd = `claude mcp add flow -- node ${path}`;
  return (
    <div className="onboarding">
      <h2>Give your agent a canvas</h2>
      <p>Flow shows Mermaid diagrams your agent creates over MCP, live, with every revision kept. Connect an agent, then ask it to draw something.</p>
      <ol>
        <li>
          <strong>Add the MCP server</strong>
          <code>{cmd}</code>
          <span>Any MCP client works: it is a stdio server. The first one started also serves this viewer.</span>
        </li>
        <li>
          <strong>Ask for a diagram</strong>
          <span>“Draw our checkout architecture as a Flow diagram.”</span>
        </li>
        <li>
          <strong>Watch it here</strong>
          <span>Click nodes to leave feedback; the agent reads it with <code className="inline">get_feedback</code>.</span>
        </li>
      </ol>
    </div>
  );
}
