import type { Diagram, DiagramSummary, Feedback } from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  list: () => req<DiagramSummary[]>("/diagrams"),
  get: (id: string) => req<Diagram>(`/diagrams/${id}`),
  addDraft: (id: string, f: Pick<Feedback, "nodeId" | "nodeLabel" | "text" | "revision">) =>
    req<Feedback>(`/diagrams/${id}/feedback`, { method: "POST", body: JSON.stringify({ ...f, draft: true }) }),
  approve: (id: string, revision: number) => req<Diagram>(`/diagrams/${id}/approve`, { method: "POST", body: JSON.stringify({ revision }) }),
  submit: (id: string) => req<Diagram>(`/diagrams/${id}/submit`, { method: "POST" }),
  setFeedback: (id: string, fid: string, status: Feedback["status"]) =>
    req<Diagram>(`/diagrams/${id}/feedback/${fid}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteFeedback: (id: string, fid: string) => req<Diagram>(`/diagrams/${id}/feedback/${fid}`, { method: "DELETE" }),
};

export const ago = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
