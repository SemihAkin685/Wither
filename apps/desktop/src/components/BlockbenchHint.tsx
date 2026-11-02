import { useEffect, useState } from "react";
import { Box, Download, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { IconButton } from "./ui";

// only these can lead to a model, no point asking the backend about every ui or manifest file
const MODEL_PATH = /(^|\/)(entity|entities|attachables|models)\/.+\.json$|\.geo\.json$/i;

export const mayHaveModel = (path: string) => MODEL_PATH.test(path);

interface BlockbenchHintProps {
  path: string;
  log: (message: string, level?: "info" | "warn" | "error") => void;
  onDismiss: () => void;
}

/**
 * Banner over entity and model files: opens the model in Blockbench when it's installed,
 * points at the download page when it isn't. Renders nothing when no model is found.
 */
export function BlockbenchHint({ path, log, onDismiss }: BlockbenchHintProps) {
  const [model, setModel] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    setModel(null);
    api.entityModel(path).then(
      (found) => alive && setModel(found),
      () => alive && setModel(null),
    );
    return () => {
      alive = false;
    };
  }, [path]);

  // checked again on focus, so coming back after installing it flips the banner over
  useEffect(() => {
    let alive = true;
    const check = () => api.blockbenchInstalled().then((yes) => alive && setInstalled(yes), () => {});
    check();
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!model || installed === null) return null;

  const open = () =>
    api.openInBlockbench(path).then(
      () => log(`Opened ${model} in Blockbench`),
      (error) => log(`Could not open ${model} in Blockbench: ${errorMessage(error)}`, "error"),
    );
  const download = () =>
    api.openBlockbenchDownload().catch((error) => log(`Could not open the browser: ${errorMessage(error)}`, "error"));

  return (
    <div className="editor-hint" role="status">
      <Box size={14} className="editor-hint-icon" />
      <span>
        {installed
          ? model === path
            ? "Preview this model in Blockbench."
            : `This entity uses ${model.split("/").pop()}, preview it in Blockbench.`
          : "Install Blockbench to preview and edit this entity's model."}
      </span>
      {installed ? (
        <button type="button" className="button is-primary is-small" onClick={open}>
          <Box size={13} />
          Open in Blockbench
        </button>
      ) : (
        <button type="button" className="button is-small" onClick={download}>
          <Download size={13} />
          Get Blockbench
        </button>
      )}
      <IconButton label="Dismiss" onClick={onDismiss}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
