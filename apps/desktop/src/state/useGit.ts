import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { GitRepo } from "../lib/types";
import type { WorkbenchActions } from "./useWorkbench";

export interface GitActions {
  refresh: () => void;
  init: () => void;
  checkout: (branch: string) => void;
  createBranch: (name: string, checkout: boolean) => void;
}

/**
 * Tracks the git repository behind the open workspace. `repo` is undefined while
 * we don't know yet and null when the workspace isn't under version control.
 */
export function useGit(workspaceRoot: string | null, log: WorkbenchActions["log"]) {
  const [repo, setRepo] = useState<GitRepo | null | undefined>(undefined);

  const refresh = useCallback(() => {
    if (!workspaceRoot) return;
    api
      .gitStatus()
      .then(setRepo)
      .catch((error) => {
        setRepo(null);
        log(`Could not read git status: ${errorMessage(error)}`, "error");
      });
  }, [workspaceRoot, log]);

  useEffect(() => {
    setRepo(undefined);
    refresh();
  }, [refresh]);

  // branches change behind our back all the time (terminal, other tools), so recheck when the window comes back
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const run = useCallback(
    (task: () => Promise<GitRepo | null>, done: (repo: GitRepo | null) => string, failure: string) => {
      task()
        .then((next) => {
          setRepo(next);
          log(done(next));
        })
        .catch((error) => log(`${failure}: ${errorMessage(error)}`, "error"));
    },
    [log],
  );

  const actions = useMemo<GitActions>(
    () => ({
      refresh,
      init: () =>
        run(api.gitInit, (next) => `Created git repository in ${next?.root ?? workspaceRoot}`, "Could not create repository"),
      checkout: (branch) =>
        run(() => api.gitCheckout(branch), (next) => `Checked out ${next?.head ?? branch}`, `Could not check out ${branch}`),
      createBranch: (name, checkout) =>
        run(() => api.gitCreateBranch(name, checkout), () => `Created branch ${name}`, `Could not create branch ${name}`),
    }),
    [refresh, run, workspaceRoot],
  );

  return { repo: workspaceRoot ? repo : undefined, actions };
}
