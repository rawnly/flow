export type Revision = { n: number; source: string; note?: string; author: string; createdAt: string };
export type Feedback = {
  id: string;
  nodeId: string | null;
  nodeLabel?: string;
  text: string;
  revision: number;
  status: "open" | "resolved";
  createdAt: string;
  resolvedIn?: number;
  reply?: string;
};
export type Diagram = { id: string; title: string; createdAt: string; updatedAt: string; revisions: Revision[]; feedback: Feedback[] };
export type DiagramSummary = { id: string; title: string; updatedAt: string; revision: number; openFeedback: number };
