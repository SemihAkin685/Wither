import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  fileName: string;
  onChoose: (choice: "save" | "discard" | "cancel") => void;
}

export function ConfirmDialog({ fileName, onChoose }: ConfirmDialogProps) {
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    saveRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onChoose("cancel");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onChoose]);

  return (
    <div className="overlay is-centered" onMouseDown={() => onChoose("cancel")}>
      <div className="dialog" role="alertdialog" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">Save changes to {fileName}?</h2>
        <p>Your changes will be lost if you close this tab without saving.</p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => onChoose("discard")}>
            Don't Save
          </button>
          <span className="dialog-spacer" />
          <button type="button" className="button" onClick={() => onChoose("cancel")}>
            Cancel
          </button>
          <button ref={saveRef} type="button" className="button is-primary" onClick={() => onChoose("save")}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
