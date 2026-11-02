import { useEffect, useRef, useState } from "react";
import { Gamepad2, Loader, Package, Play, RefreshCw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { MinecraftInstall, PackInfo, TestTarget, World } from "../lib/types";
import type { GameTest } from "../state/useGameTest";

interface GameTestViewProps {
  hasWorkspace: boolean;
  lastTarget: TestTarget | null;
  game: GameTest;
  onOpenSettings: () => void;
}

const kindLabel: Record<PackInfo["manifest"]["kind"], string> = {
  behavior: "Behavior pack",
  resource: "Resource pack",
  skin: "Skin pack",
  unknown: "Pack",
};

function lastPlayed(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
}

function WorldThumb({ install, world }: { install: string; world: World }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!world.hasIcon) return;
    let objectUrl: string | null = null;
    let live = true;
    api
      .worldIcon(install, world.id)
      .then((bytes) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [install, world.id, world.hasIcon]);
  return (
    <div className="world-thumb">{url ? <img src={url} alt="" draggable={false} /> : <Gamepad2 size={22} />}</div>
  );
}

export function GameTestView({ hasWorkspace, lastTarget, game, onOpenSettings }: GameTestViewProps) {
  const [installs, setInstalls] = useState<MinecraftInstall[] | null>(null);
  const [installId, setInstallId] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<World[] | null>(null);
  // null means "game only", no world gets touched
  const [world, setWorld] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const lastTargetRef = useRef(lastTarget);
  lastTargetRef.current = lastTarget;

  const loadInstalls = () => {
    setError(null);
    api
      .minecraftInstalls()
      .then((found) => {
        setInstalls(found);
        setInstallId((current) => {
          if (current && found.some((i) => i.id === current)) return current;
          const last = lastTargetRef.current?.install;
          return found.find((i) => i.id === last)?.id ?? found[0]?.id ?? null;
        });
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(loadInstalls, []);

  useEffect(() => {
    if (!hasWorkspace) {
      setPacks(null);
      return;
    }
    setPackError(null);
    api
      .listPacks()
      .then(setPacks)
      .catch((e) => {
        setPacks([]);
        setPackError(errorMessage(e));
      });
  }, [hasWorkspace]);

  useEffect(() => {
    setWorlds(null);
    if (!installId) return;
    let live = true;
    api
      .listWorlds(installId)
      .then((found) => {
        if (!live) return;
        setWorlds(found);
        const last = lastTargetRef.current;
        const remembered = last?.install === installId ? last.world : null;
        setWorld(remembered && found.some((w) => w.id === remembered) ? remembered : null);
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [installId]);

  const canRun = hasWorkspace && !!installId && !game.busy && (packs?.length ?? 0) > 0;

  return (
    <div className="settings-view game-view">
      <div className="settings-inner game-inner">
        <div className="settings-header">
          <h1>Test in Game</h1>
          <button
            type="button"
            className="button is-primary"
            disabled={!canRun}
            onClick={() => installId && void game.run({ install: installId, world })}
          >
            {game.busy ? <Loader size={14} className="spin" /> : <Play size={14} />}
            Install and Launch
          </button>
        </div>

        <section>
          <div className="game-section-header">
            <h2>Packs</h2>
            {hasWorkspace && (packs?.length ?? 0) > 0 && (
              <button type="button" className="button is-small" onClick={() => void game.exportAddon()}>
                Export as .mcaddon
              </button>
            )}
          </div>
          {!hasWorkspace && <p className="game-note">Open a project folder to export or test its packs.</p>}
          {packError && <p className="game-note is-error">{packError}</p>}
          {hasWorkspace && packs?.length === 0 && !packError && (
            <p className="game-note">No folder with a manifest.json in this project.</p>
          )}
          {packs?.map((pack) => (
            <div key={pack.rel} className="settings-row">
              <div className="game-pack">
                <Package size={16} />
                <div>
                  <div className="settings-row-title">{pack.manifest.name || pack.folder}</div>
                  <div className="settings-row-description">
                    {kindLabel[pack.manifest.kind]} · {pack.rel || "project root"} · v{pack.manifest.version.join(".")}
                  </div>
                </div>
              </div>
              <button type="button" className="button is-small" onClick={() => void game.exportAddon(pack.rel)}>
                Export .mcpack
              </button>
            </div>
          ))}
        </section>

        <section>
          <div className="game-section-header">
            <h2>Where to install</h2>
            <div className="game-install">
              {installs && installs.length > 1 && (
                <select
                  className="text-input"
                  aria-label="Minecraft install"
                  value={installId ?? ""}
                  onChange={(e) => setInstallId(e.target.value)}
                >
                  {installs.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="button is-small" aria-label="Refresh" title="Refresh" onClick={loadInstalls}>
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
          {error && <p className="game-note is-error">{error}</p>}
          {installs?.length === 0 && (
            <p className="game-note">
              No Minecraft install found.{" "}
              <button type="button" className="link-button" onClick={onOpenSettings}>
                Set the folder in Settings
              </button>
            </p>
          )}
          {installs && installs.length === 1 && <p className="game-note">{installs[0].label}</p>}

          {installId && (
            <div className="world-grid" role="radiogroup" aria-label="Target">
              <button
                type="button"
                role="radio"
                aria-checked={world === null}
                className={`world-card${world === null ? " is-selected" : ""}`}
                onClick={() => setWorld(null)}
              >
                <div className="world-thumb">
                  <Gamepad2 size={22} />
                </div>
                <span className="world-name">Game only</span>
                <span className="world-meta">Install packs, pick them in game</span>
              </button>
              {worlds?.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="radio"
                  aria-checked={world === w.id}
                  className={`world-card${world === w.id ? " is-selected" : ""}`}
                  onClick={() => setWorld(w.id)}
                >
                  <WorldThumb install={installId} world={w} />
                  <span className="world-name">{w.name}</span>
                  <span className="world-meta">{lastPlayed(w.lastPlayed)}</span>
                </button>
              ))}
            </div>
          )}
          {!worlds && installId && !error && (
            <p className="game-note">
              <Loader size={13} className="spin" /> Loading worlds
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function GameRunningDialog({ onChoose }: { onChoose: (go: boolean) => void }) {
  const goRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    goRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onChoose(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onChoose]);

  return (
    <div className="overlay is-centered" onMouseDown={() => onChoose(false)}>
      <div className="dialog" role="alertdialog" aria-labelledby="game-running-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="game-running-title">Minecraft is running</h2>
        <p>If that world is open, the game can overwrite its pack list when you leave it. Leave the world first, then continue.</p>
        <div className="dialog-actions">
          <span className="dialog-spacer" />
          <button type="button" className="button" onClick={() => onChoose(false)}>
            Cancel
          </button>
          <button ref={goRef} type="button" className="button is-primary" onClick={() => onChoose(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
