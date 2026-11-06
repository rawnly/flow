import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Canvas } from "./Canvas";
import { Icon } from "./icons";
import { renderSvg } from "./render";
import type { Diagram, Revision } from "./types";

type Props = {
  d: Diagram;
  viewed: Revision; // revision the draft starts from (an older one = restore)
  draft: string;
  setDraft: (s: string) => void;
  onSaved: (d: Diagram) => void;
  say: (t: string) => void;
};

type SaveError = { kind: "conflict"; latest: Revision } | { kind: "error"; text: string };

async function postRevision(id: string, body: object) {
  const res = await fetch(`/api/diagrams/${id}/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const useDebounced = <T,>(v: T, ms: number) => {
  const [x, setX] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setX(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return x;
};

export function Editor({ d, viewed, draft, setDraft, onSaved, say }: Props) {
  const latest = d.revisions.at(-1)!;
  const [base, setBase] = useState(latest.n); // revision the user is editing on top of
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState(() => localStorage.getItem("flow.askAgent") === "on");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<SaveError | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const preview = useDebounced(draft, 250);

  const dirty = draft !== latest.source;
  const restoring = viewed.n !== latest.n;
  const newer = latest.n > base ? latest : null; // someone saved since this draft started
  const lines = draft.split("\n").length;

  // Not editing: follow whatever the agent saves.
  useEffect(() => {
    if (!dirty) setBase(latest.n);
  }, [latest.n, dirty]);

  useEffect(() => {
    let live = true;
    renderSvg(preview).then(
      () => live && setParseErr(null),
      (e) => live && setParseErr(String(e?.message ?? e)),
    );
    return () => void (live = false);
  }, [preview]);

  // Leaving with an unsaved draft would lose it.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const discard = () => {
    setDraft(latest.source);
    setBase(latest.n);
    setErr(null);
    setNote("");
  };

  const save = async (force = false) => {
    if (!dirty || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await postRevision(d.id, { source: draft, base, note, force, askAgent: ask ? instruction : undefined });
      if (status === 409) return setErr({ kind: "conflict", latest: data.latest });
      if (status === 422) return setErr({ kind: "error", text: `Mermaid didn’t parse, nothing was saved.\n${data.detail ?? ""}` });
      if (status >= 400) return setErr({ kind: "error", text: data.error ?? `Save failed (${status})` });
      const n = data.revisions.at(-1).n;
      setNote("");
      setInstruction("");
      setBase(n);
      onSaved(data);
      say(ask ? `Saved r${n}. The agent will adjust the diagram around your edit.` : `Saved r${n}`);
    } catch (e: any) {
      setErr({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") return e.preventDefault(), void save();
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      setDraft(draft.slice(0, a) + "  " + draft.slice(b));
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };

  const saveLabel = busy ? "Saving…" : newer ? `Save over r${newer.n}` : restoring && draft === viewed.source ? `Restore r${viewed.n} as r${latest.n + 1}` : `Save as r${latest.n + 1}`;

  return (
    <div className="editor">
      <div className="editor-panes">
        <div className="editor-code">
          <div className="code-head">
            <span>
              {restoring ? <>Editing from <strong>r{viewed.n}</strong> · latest is r{latest.n}</> : <>Mermaid · {lines} lines</>}
            </span>
            <span className={`parse ${parseErr ? "is-bad" : "is-ok"}`}>{parseErr ? "Doesn’t parse" : "Valid"}</span>
          </div>
          <div className="editor-body">
            <div className="editor-gutter" ref={gutter} aria-hidden="true">
              {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea
              ref={ta}
              className="editor-input"
              value={draft}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Mermaid source"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
            />
          </div>
        </div>
        <div className="editor-preview">
          <Canvas
            fitKey={`${d.id}:preview`}
            source={preview}
            baseSource={dirty ? latest.source : null}
            feedback={[]}
            focusNode={null}
            interactive={false}
            onFocusPin={() => {}}
            onComment={async () => {}}
            onSvg={() => {}}
            head={(c) => (
              <>
                <h2 className="preview-title">Preview</h2>
                <p>
                  {!dirty
                    ? "Edit the source to see changes here."
                    : c && (c.added || c.changed || c.edges)
                      ? "Highlighted parts are your changes."
                      : "Your changes don’t add or rename parts."}
                </p>
              </>
            )}
          />
        </div>
      </div>

      {dirty && (
        <form className="savebar" onSubmit={(e) => (e.preventDefault(), save())}>
          {err?.kind === "conflict" || newer ? (
            <div className="savebar-alert" role="alert">
              <Icon.alert />
              <span>
                {(() => {
                  const r = (err?.kind === "conflict" ? err.latest : newer)!;
                  return r.author === "you" ? <>r{r.n} was saved from another tab while you were editing.</> : <><strong>{r.author}</strong> saved r{r.n} while you were editing.</>;
                })()}{" "}
                Saving replaces it with your version; it stays in History.
              </span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={discard}>Discard mine, load r{latest.n}</button>
            </div>
          ) : err ? (
            <div className="savebar-alert is-error" role="alert"><Icon.alert /><pre>{err.text}</pre></div>
          ) : null}
          <div className="savebar-row">
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe your change (optional)" aria-label="Change description" maxLength={500} />
            <label className="check">
              <input
                type="checkbox"
                checked={ask}
                onChange={(e) => (setAsk(e.target.checked), localStorage.setItem("flow.askAgent", e.target.checked ? "on" : "off"))}
              />
              <span className="check-box" aria-hidden="true"><Icon.check /></span>
              Ask the agent to adjust after my edit
            </label>
            <span className="sp" />
            <button type="button" className="btn btn-quiet" onClick={discard}>Discard</button>
            <button className="btn btn-primary" disabled={busy || !!parseErr} title={parseErr ? "Fix the syntax error first" : "⌘S"} onClick={(e) => (e.preventDefault(), save(!!newer || err?.kind === "conflict"))}>
              {saveLabel}
            </button>
          </div>
          {ask && (
            <input
              className="field"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="What should the agent do? Default: keep your changes and make the rest consistent with them"
              aria-label="Instruction for the agent"
              maxLength={4000}
            />
          )}
        </form>
      )}
    </div>
  );
}
