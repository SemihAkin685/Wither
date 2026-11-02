import { isUiDefinitionFile } from "./jsonui/catalog";

export type PreviewKind = "jsonui" | "markdown";

/** Which side by side preview a file supports, if any. Ctrl+Shift+V toggles it. */
export function previewKind(path: string): PreviewKind | null {
  if (isUiDefinitionFile(path)) return "jsonui";
  if (/\.md$/i.test(path)) return "markdown";
  return null;
}
