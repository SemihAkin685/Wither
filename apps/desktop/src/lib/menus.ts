import type { Command } from "./commands";

export interface MenuItem {
  id: string;
  title: string;
  keys?: string;
  /** Tooltip, e.g. the full path behind a recent project. */
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** Opens to the side on hover, like File > Open Recent. */
export interface SubMenu {
  id: string;
  title: string;
  disabled?: boolean;
  entries: MenuEntry[];
}

export type MenuEntry = MenuItem | SubMenu | "separator";

export const isSubMenu = (entry: MenuItem | SubMenu): entry is SubMenu => "entries" in entry;

export interface Menu {
  id: string;
  title: string;
  entries: MenuEntry[];
}

/** Builds a menu entry from a palette command so labels and shortcuts stay in one place. */
export function commandEntry(commands: Command[], id: string, title?: string): MenuItem {
  const command = commands.find((c) => c.id === id);
  if (!command) throw new Error(`unknown command ${id}`);
  return { id, title: title ?? command.title, keys: command.keys?.split(" / ")[0], run: command.run };
}

/**
 * Clipboard and undo for whatever text field had focus before the menu opened.
 * The menu never takes focus (see MenuBar), so execCommand still hits the editor.
 */
export function editEntry(id: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll", title: string, keys: string): MenuItem {
  const run = () => {
    if (id !== "paste") {
      document.execCommand(id);
      return;
    }
    // webkit refuses execCommand("paste") from script, the async clipboard api is the only way in
    navigator.clipboard
      .readText()
      .then((text) => document.execCommand("insertText", false, text))
      .catch(() => {});
  };
  return { id: `edit.${id}`, title, keys, run };
}
