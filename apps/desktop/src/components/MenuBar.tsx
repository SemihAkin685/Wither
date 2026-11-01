import { useEffect, useState, type MouseEvent } from "react";
import type { Menu, MenuItem } from "../lib/menus";
import { Keys } from "./ui";

interface MenuBarProps {
  menus: Menu[];
  onClose: () => void;
}

// keeps focus wherever it was (usually the editor) so edit actions still have a target
const keepFocus = (event: MouseEvent) => event.preventDefault();

export function MenuBar({ menus, onClose }: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (openId) setOpenId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openId, onClose]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    item.run();
  };

  return (
    <nav className="menubar" role="menubar">
      {menus.map((menu) => (
        <div key={menu.id} className="menubar-slot">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openId === menu.id}
            className={`menubar-item${openId === menu.id ? " is-open" : ""}`}
            onMouseDown={keepFocus}
            onClick={() => setOpenId(openId === menu.id ? null : menu.id)}
            onMouseEnter={() => openId && setOpenId(menu.id)}
          >
            {menu.title}
          </button>
          {openId === menu.id && (
            <div className="popup menu-dropdown" role="menu" onMouseDown={keepFocus}>
              {menu.entries.map((entry, index) =>
                entry === "separator" ? (
                  <div key={index} className="popup-separator" role="separator" />
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    className="popup-item"
                    disabled={entry.disabled}
                    onClick={() => choose(entry)}
                  >
                    <span className="popup-label">{entry.title}</span>
                    {entry.keys && <Keys keys={entry.keys} />}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
