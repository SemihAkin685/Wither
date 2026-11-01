export interface Command {
  id: string;
  title: string;
  category: string;
  keys?: string;
  run: () => void;
}

function eventKeys(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key === "+" ? "=" : key);
  return parts.join("+");
}

/** Finds the command bound to a key event. Only single chords are supported. */
export function commandForEvent(commands: Command[], event: KeyboardEvent): Command | undefined {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return undefined;
  const pressed = eventKeys(event);
  return commands.find((c) => c.keys?.split(" / ").includes(pressed));
}

/**
 * Chords the workbench keeps while the terminal has focus. Everything else
 * (Ctrl+W, Ctrl+P, Ctrl+B...) belongs to the shell, readline needs those.
 */
export function isTerminalPassthrough(event: KeyboardEvent): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === "F1") return true;
  if (!ctrl) return false;
  if (event.shiftKey) return !["C", "V"].includes(event.key.toUpperCase());
  return ["`", "Tab", "PageUp", "PageDown"].includes(event.key);
}
