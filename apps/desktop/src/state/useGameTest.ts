import { useCallback, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { TestTarget } from "../lib/types";
import type { OutputLine } from "./workbench";

interface GameTestOptions {
  lastTarget: TestTarget | null;
  saveAll: () => Promise<void>;
  log: (message: string, level?: OutputLine["level"]) => void;
  showOutput: () => void;
  /** Called after a run, the backend just saved the new last target. */
  onSettingsChanged: () => void;
}

export interface GameTest {
  busy: boolean;
  /** A run waiting for the user to confirm, because the game is open and a world is targeted. */
  pending: TestTarget | null;
  run: (target: TestTarget) => Promise<void>;
  /** Repeats the last run. Returns false when there's nothing to repeat yet. */
  runLast: () => boolean;
  confirm: (go: boolean) => void;
  exportAddon: (pack?: string) => Promise<void>;
}

/** Export and "Test in game" runs, shared by the menu, the status bar and the test view. */
export function useGameTest({ lastTarget, saveAll, log, showOutput, onSettingsChanged }: GameTestOptions): GameTest {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<TestTarget | null>(null);
  const busyRef = useRef(false);

  const execute = useCallback(
    async (target: TestTarget) => {
      busyRef.current = true;
      setBusy(true);
      try {
        const report = await api.testInGame(target.install, target.world);
        for (const line of report.installed) log(`Installed ${line}`);
        for (const line of report.skipped) log(`Skipped: ${line}`, "warn");
        for (const line of report.warnings) log(line, "warn");
        if (report.attachedTo) log(`Packs are active in world "${report.attachedTo}"`);
        if (report.launched) log("Started Minecraft, re-enter the world to pick up changes");
        else log("Packs are installed, start Minecraft yourself", "warn");
        onSettingsChanged();
      } catch (error) {
        log(`Test in game failed: ${errorMessage(error)}`, "error");
      } finally {
        busyRef.current = false;
        setBusy(false);
        showOutput();
      }
    },
    [log, showOutput, onSettingsChanged],
  );

  const run = useCallback(
    async (target: TestTarget) => {
      if (busyRef.current) return;
      await saveAll();
      if (target.world) {
        // the game rewrites the world's pack list when it leaves the world, so writing it now can get lost
        const running = await api.gameRunning().catch(() => null);
        if (running) {
          setPending(target);
          return;
        }
        if (running === null) log("Couldn't tell whether Minecraft is running, leave the world before testing", "warn");
      }
      await execute(target);
    },
    [saveAll, execute, log],
  );

  const runLast = useCallback(() => {
    if (!lastTarget) return false;
    void run(lastTarget);
    return true;
  }, [lastTarget, run]);

  const confirm = useCallback(
    (go: boolean) => {
      const target = pending;
      setPending(null);
      if (go && target) void execute(target);
    },
    [pending, execute],
  );

  const exportAddon = useCallback(
    async (pack?: string) => {
      await saveAll();
      try {
        const path = await api.exportAddon(pack ?? null);
        if (path) log(`Exported ${path}`);
      } catch (error) {
        log(`Export failed: ${errorMessage(error)}`, "error");
        showOutput();
      }
    },
    [saveAll, log, showOutput],
  );

  return useMemo(
    () => ({ busy, pending, run, runLast, confirm, exportAddon }),
    [busy, pending, run, runLast, confirm, exportAddon],
  );
}
