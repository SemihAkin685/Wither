import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Cloud, GitBranch, GitBranchPlus, Plus, RefreshCw, Star } from "lucide-react";
import { fuzzyScore } from "../lib/tree";
import type { GitRepo } from "../lib/types";
import type { GitActions } from "../state/useGit";

interface GitPopupProps {
  repo: GitRepo | null | undefined;
  actions: GitActions;
  onClose: () => void;
}

interface Row {
  id: string;
  section?: string;
  icon: ReactNode;
  label: string;
  current?: boolean;
  run: () => void;
}

export function GitPopup({ repo, actions, onClose }: GitPopupProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [checkoutNew, setCheckoutNew] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), [newBranch === null]);

  const rows = useMemo<Row[]>(() => {
    if (repo === undefined) return [];
    if (repo === null) {
      return [
        {
          id: "init",
          section: "Version Control",
          icon: <Plus size={14} />,
          label: "Create Git Repository...",
          run: () => {
            onClose();
            actions.init();
          },
        },
      ];
    }
    const term = query.trim();
    const matches = (name: string) => !term || fuzzyScore(term, name) !== null;
    const branch = (name: string, section: string, icon: ReactNode): Row => ({
      id: `${section}:${name}`,
      icon,
      label: name,
      current: section === "Local" && !repo.detached && name === repo.head,
      run: () => {
        onClose();
        if (!(section === "Local" && name === repo.head)) actions.checkout(name);
      },
    });
    const withSection = (list: Row[], section: string) =>
      list.map((row, i) => (i === 0 ? { ...row, section } : row));

    const actionRows: Row[] = term
      ? []
      : [
          ...(repo.unborn
            ? []
            : [{ id: "new", icon: <GitBranchPlus size={14} />, label: "New Branch...", run: () => setNewBranch("") }]),
          { id: "refresh", icon: <RefreshCw size={14} />, label: "Refresh", run: actions.refresh },
        ];
    // current branch first, like the ide does it
    const local = [...repo.localBranches]
      .sort((a, b) => Number(b === repo.head) - Number(a === repo.head))
      .filter(matches)
      .map((name) => branch(name, "Local", name === repo.head ? <Star size={13} /> : <GitBranch size={14} />));
    const remote = repo.remoteBranches.filter(matches).map((name) => branch(name, "Remote", <Cloud size={14} />));
    return [...actionRows, ...withSection(local, "Local"), ...withSection(remote, "Remote")];
  }, [repo, query, actions, onClose]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onListKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setSelected((i) => Math.min(rows.length - 1, i + 1));
    else if (event.key === "ArrowUp") setSelected((i) => Math.max(0, i - 1));
    else if (event.key === "Enter") rows[selected]?.run();
    else return;
    event.preventDefault();
  };

  const createBranch = () => {
    const name = newBranch?.trim();
    if (!name) return;
    onClose();
    actions.createBranch(name, checkoutNew);
  };

  if (newBranch !== null) {
    return (
      <div className="popup git-popup" role="dialog" aria-label="Create new branch">
        <div className="popup-heading">Create New Branch</div>
        <input
          ref={inputRef}
          className="popup-input"
          value={newBranch}
          placeholder="Branch name"
          spellCheck={false}
          onChange={(e) => setNewBranch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createBranch();
          }}
        />
        <label className="popup-check">
          <input type="checkbox" checked={checkoutNew} onChange={(e) => setCheckoutNew(e.target.checked)} />
          Checkout branch
        </label>
        <div className="popup-actions">
          <button type="button" className="button" onClick={() => setNewBranch(null)}>
            Cancel
          </button>
          <button type="button" className="button is-primary" disabled={!newBranch.trim()} onClick={createBranch}>
            Create
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="popup git-popup" role="dialog" aria-label="Git branches">
      {repo && (
        <input
          ref={inputRef}
          className="popup-input"
          value={query}
          placeholder="Search branches"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onListKey}
        />
      )}
      {repo?.unborn && (
        <div className="popup-note">No commits yet. Branches can be created after the first commit.</div>
      )}
      <div className="popup-list" ref={listRef} role="listbox">
        {repo === undefined && <div className="popup-empty">Reading repository...</div>}
        {rows.map((row, index) => (
          <div key={row.id} role="presentation">
            {row.section && <div className="popup-section">{row.section}</div>}
            <div
              role="option"
              aria-selected={index === selected}
              className={`popup-item${index === selected ? " is-selected" : ""}${row.current ? " is-current" : ""}`}
              onMouseMove={() => setSelected(index)}
              onClick={row.run}
            >
              {row.icon}
              <span className="popup-label">{row.label}</span>
            </div>
          </div>
        ))}
        {repo && rows.length === 0 && <div className="popup-empty">No matching branches</div>}
      </div>
    </div>
  );
}
