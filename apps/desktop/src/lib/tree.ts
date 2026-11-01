import type { FileNode, Language } from "./types";

export function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.kind === "file") out.push(node);
    else if (node.children) flattenFiles(node.children, out);
  }
  return out;
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentDirs(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export const languageLabel: Record<Language, string> = {
  json: "JSON",
  javascript: "JavaScript",
  typescript: "TypeScript",
  lang: "Lang",
  markdown: "Markdown",
  image: "Image",
  plaintext: "Plain Text",
};

/** Subsequence match. Consecutive hits and hits inside the file name rank higher. */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const nameStart = t.lastIndexOf("/") + 1;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (found >= nameStart ? 2 : 0);
    ti = found + 1;
  }
  return score - t.length * 0.01;
}
