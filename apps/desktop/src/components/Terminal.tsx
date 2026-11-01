import { useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { api, errorMessage } from "../lib/api";
import { isTerminalPassthrough } from "../lib/commands";
import type { Theme } from "../lib/types";

interface TerminalProps {
  visible: boolean;
  focusToken: number;
  theme: Theme;
  fontSize: number;
  onError: (message: string) => void;
}

const ansi: Record<Theme, Omit<ITheme, "background" | "foreground" | "cursor" | "selectionBackground">> = {
  dark: {
    black: "#1a191f",
    red: "#f87171",
    green: "#86d993",
    yellow: "#f6c177",
    blue: "#8fb4ff",
    magenta: "#c4b5fd",
    cyan: "#7dd3d8",
    white: "#d4d2dc",
    brightBlack: "#6c6978",
    brightRed: "#fca5a5",
    brightGreen: "#a7f3b5",
    brightYellow: "#fcd9a0",
    brightBlue: "#b4ccff",
    brightMagenta: "#ddd6fe",
    brightCyan: "#a5f0f3",
    brightWhite: "#f4f3f8",
  },
  light: {
    black: "#1d1b23",
    red: "#c42b2b",
    green: "#2f7d32",
    yellow: "#9a6700",
    blue: "#1d4ed8",
    magenta: "#7c3aed",
    cyan: "#0e7490",
    white: "#8a8796",
    brightBlack: "#5f5c6b",
    brightRed: "#dc2626",
    brightGreen: "#16a34a",
    brightYellow: "#b45309",
    brightBlue: "#2563eb",
    brightMagenta: "#6d28d9",
    brightCyan: "#0891b2",
    brightWhite: "#1d1b23",
  },
};

function xtermTheme(theme: Theme): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    ...ansi[theme],
    background: v("--bg-sidebar"),
    foreground: v("--text"),
    cursor: v("--accent"),
    cursorAccent: v("--bg-sidebar"),
    selectionBackground: v("--bg-text-selection"),
  };
}

async function copySelection(term: XTerm) {
  const text = term.getSelection();
  if (text) await navigator.clipboard?.writeText(text).catch(() => {});
}

async function pasteClipboard(term: XTerm) {
  const text = await navigator.clipboard?.readText().catch(() => "");
  if (text) term.paste(text);
}

/** The user's real shell running in a pty on the Rust side, rendered with xterm.js. */
export function Terminal({ visible, focusToken, theme, fontSize, onError }: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<number | null>(null);
  const exitedRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fit = () => {
    const host = hostRef.current;
    // fitting while the panel is hidden gives 0 columns and wrecks the shell's line wrapping
    if (host && host.clientWidth > 0 && host.clientHeight > 0) fitRef.current?.fit();
  };

  const start = async (term: XTerm) => {
    exitedRef.current = false;
    const onOutput = new Channel<ArrayBuffer>();
    onOutput.onmessage = (data) => term.write(new Uint8Array(data));
    const onExit = new Channel<number | null>();
    onExit.onmessage = (code) => {
      sessionRef.current = null;
      exitedRef.current = true;
      const status = code === null ? "terminated" : `exited with code ${code}`;
      term.write(`\r\n\x1b[2m[process ${status}, press Enter to restart]\x1b[0m\r\n`);
    };
    try {
      const session = await api.terminalSpawn({ cols: term.cols, rows: term.rows }, onOutput, onExit);
      if (termRef.current !== term) {
        api.terminalKill(session.id).catch(() => {});
        return;
      }
      sessionRef.current = session.id;
    } catch (error) {
      exitedRef.current = true;
      term.write(`\x1b[31mCould not start shell: ${errorMessage(error)}\x1b[0m\r\n`);
      onErrorRef.current(`Could not start terminal: ${errorMessage(error)}`);
    }
  };

  const observerRef = useRef<ResizeObserver | null>(null);

  // ok so the terminal is created the first time the panel shows it and then lives until unmount,
  // hiding the panel must not kill the shell
  useEffect(() => {
    if (!visible || termRef.current || !hostRef.current) return;

    const term = new XTerm({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
      fontSize: fontSize - 1,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: false,
      scrollback: 5000,
      theme: xtermTheme(theme),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    termRef.current = term;
    fitRef.current = fitAddon;

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const ctrlShift = (event.ctrlKey || event.metaKey) && event.shiftKey;
      if (ctrlShift && event.key.toUpperCase() === "C") {
        void copySelection(term);
        return false;
      }
      if (ctrlShift && event.key.toUpperCase() === "V") {
        void pasteClipboard(term);
        return false;
      }
      return !isTerminalPassthrough(event);
    });

    term.onData((data) => {
      if (exitedRef.current) {
        if (data === "\r") {
          term.reset();
          void start(term);
        }
        return;
      }
      if (sessionRef.current !== null) api.terminalWrite(sessionRef.current, data).catch(() => {});
    });
    term.onResize(({ cols, rows }) => {
      if (sessionRef.current !== null) api.terminalResize(sessionRef.current, { cols, rows }).catch(() => {});
    });

    const host = hostRef.current;
    const observer = new ResizeObserver(() => fit());
    observerRef.current = observer;

    // the canvas measures glyphs once, so the font has to be ready before open()
    document.fonts.load(`${fontSize}px "JetBrains Mono"`).finally(() => {
      if (termRef.current !== term) return;
      term.open(host);
      fit();
      observer.observe(host);
      term.focus();
      void start(term);
    });
  }, [visible]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      if (sessionRef.current !== null) api.terminalKill(sessionRef.current).catch(() => {});
      termRef.current?.dispose();
      observerRef.current = null;
      sessionRef.current = null;
      termRef.current = null;
      fitRef.current = null;
    },
    [],
  );

  useEffect(() => {
    // wait a frame, App writes data-theme in its own effect which runs after ours
    const frame = requestAnimationFrame(() => {
      if (termRef.current) termRef.current.options.theme = xtermTheme(theme);
    });
    return () => cancelAnimationFrame(frame);
  }, [theme]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize - 1;
    fit();
  }, [fontSize]);

  useEffect(() => {
    if (!visible) return;
    fit();
    if (focusToken) termRef.current?.focus();
  }, [visible, focusToken]);

  return <div ref={hostRef} className="terminal-host" />;
}
