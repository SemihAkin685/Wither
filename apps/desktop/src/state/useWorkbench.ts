import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { fileName } from "../lib/tree";
import {
  activeTab,
  initialState,
  isDirty,
  reducer,
  type Action,
  type OutputLine,
  type WorkbenchState,
} from "./workbench";

export interface WorkbenchActions {
  dispatch: (action: Action) => void;
  log: (message: string, level?: OutputLine["level"]) => void;
  openWorkspace: () => Promise<void>;
  closeWorkspace: () => Promise<void>;
  openFile: (path: string, line?: number, column?: number) => void;
  save: (path?: string) => Promise<boolean>;
  saveAll: () => Promise<void>;
  requestCloseTab: (id: string) => void;
  confirmClose: (choice: "save" | "discard" | "cancel") => Promise<void>;
}

let nextLogId = 1;

const CHECK_DELAY_MS = 300;

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

export function useWorkbench() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const stateRef = useRef<WorkbenchState>(state);
  stateRef.current = state;

  const log = useCallback((message: string, level: OutputLine["level"] = "info") => {
    dispatch({ type: "log", line: { id: nextLogId++, time: timestamp(), level, message } });
  }, []);

  // recheck a moment after typing stops, unsaved edits go along so problems follow the editor
  const checkSeq = useRef(0);
  useEffect(() => {
    // bumped even with no workspace, so a check still in flight when it closes gets dropped
    const seq = ++checkSeq.current;
    if (!state.workspace) return;
    const timer = setTimeout(() => {
      const unsaved = Object.fromEntries(
        Object.entries(state.buffers).flatMap(([path, b]) =>
          b.status === "ready" && b.content !== b.saved ? [[path, b.content]] : [],
        ),
      );
      api
        .checkWorkspace(unsaved)
        .then((problems) => {
          // hmm, a slower older check can land after a newer one, drop it
          if (seq === checkSeq.current) dispatch({ type: "problemsChecked", problems });
        })
        .catch((error) => {
          if (seq === checkSeq.current) log(`Could not check the workspace: ${errorMessage(error)}`, "error");
        });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.workspace, state.buffers, log]);

  const openWorkspace = useCallback(async () => {
    try {
      const workspace = await api.openWorkspace();
      dispatch({ type: "workspaceOpened", workspace });
      log(`Opened workspace "${workspace.name}" at ${workspace.root}`);
    } catch (error) {
      log(`Could not open workspace: ${errorMessage(error)}`, "error");
    }
  }, [log]);

  const closeWorkspace = useCallback(async () => {
    const name = stateRef.current.workspace?.name;
    try {
      await api.closeWorkspace();
      dispatch({ type: "workspaceClosed" });
      if (name) log(`Closed workspace "${name}"`);
    } catch (error) {
      log(`Could not close workspace: ${errorMessage(error)}`, "error");
    }
  }, [log]);

  const openFile = useCallback(
    (path: string, line?: number, column?: number) => {
      const node = stateRef.current.files[path];
      const alreadyLoaded = !!stateRef.current.buffers[path];
      dispatch({ type: "openFile", path, line, column });
      if (alreadyLoaded) return;
      if (node?.language === "image") {
        dispatch({ type: "bufferFailed", path, error: "Image preview is not available yet." });
        return;
      }
      api
        .readFile(path)
        .then((content) => dispatch({ type: "bufferLoaded", path, content }))
        .catch((error) => {
          dispatch({ type: "bufferFailed", path, error: errorMessage(error) });
          log(`Could not read ${path}: ${errorMessage(error)}`, "error");
        });
    },
    [log],
  );

  const save = useCallback(
    async (path?: string) => {
      const current = stateRef.current;
      const tab = activeTab(current);
      const target = path ?? (tab?.kind === "file" ? tab.path : undefined);
      if (!target || !isDirty(current, target)) return true;
      const content = current.buffers[target].content;
      try {
        await api.writeFile(target, content);
        dispatch({ type: "saved", path: target, content });
        log(`Saved ${target}`);
        return true;
      } catch (error) {
        log(`Could not save ${target}: ${errorMessage(error)}`, "error");
        return false;
      }
    },
    [log],
  );

  const saveAll = useCallback(async () => {
    const dirty = Object.keys(stateRef.current.buffers).filter((p) => isDirty(stateRef.current, p));
    for (const path of dirty) await save(path);
  }, [save]);

  const requestCloseTab = useCallback((id: string) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id);
    if (tab?.kind === "file" && isDirty(stateRef.current, tab.path)) {
      dispatch({ type: "activateTab", id });
      setPendingClose(id);
    } else {
      dispatch({ type: "closeTab", id });
    }
  }, []);

  const confirmClose = useCallback(
    async (choice: "save" | "discard" | "cancel") => {
      const id = pendingClose;
      setPendingClose(null);
      if (!id || choice === "cancel") return;
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (choice === "save" && tab?.kind === "file") {
        if (!(await save(tab.path))) return;
      }
      dispatch({ type: "closeTab", id });
    },
    [pendingClose, save],
  );

  const actions = useMemo<WorkbenchActions>(
    () => ({
      dispatch,
      log,
      openWorkspace,
      closeWorkspace,
      openFile,
      save,
      saveAll,
      requestCloseTab,
      confirmClose,
    }),
    [log, openWorkspace, closeWorkspace, openFile, save, saveAll, requestCloseTab, confirmClose],
  );

  const pendingCloseTitle = pendingClose
    ? fileName(state.tabs.find((t) => t.id === pendingClose)?.title ?? "")
    : null;

  return { state, actions, pendingCloseTitle };
}
