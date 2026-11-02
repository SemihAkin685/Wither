import { ChevronRight } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { isSubMenu, type Menu, type MenuEntry, type MenuItem } from "../lib/menus";
import { Keys } from "./ui";

interface MenuBarProps {
  menus: Menu[];
  onClose: () => void;
}

// keeps focus wherever it was (usually the editor) so edit actions still have a target
const keepFocus = (event: MouseEvent) => event.preventDefault();

export function MenuBar({ menus, onClose }: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (subId) setSubId(null);
      else if (openId) setOpenId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openId, subId, onClose]);

  useEffect(() => setSubId(null), [openId]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    item.run();
  };

  const renderEntries = (entries: MenuEntry[], nested: boolean) =>
    entries.map((entry, index) => {
      if (entry === "separator") return <div key={index} className="popup-separator" role="separator" />;
      if (isSubMenu(entry)) {
        const open = subId === entry.id && !entry.disabled;
        return (
          <div key={entry.id} className="menu-sub" onMouseEnter={() => setSubId(entry.id)}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              className={`popup-item${open ? " is-selected" : ""}`}
              disabled={entry.disabled}
              onClick={() => setSubId(entry.id)}
            >
              <span className="popup-label">{entry.title}</span>
              <ChevronRight size={13} className="menu-sub-chevron" />
            </button>
            {open && (
              <div className="popup menu-dropdown menu-submenu" role="menu">
                {renderEntries(entry.entries, true)}
              </div>
            )}
          </div>
        );
      }
      return (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          className="popup-item"
          disabled={entry.disabled}
          title={entry.hint}
          onClick={() => choose(entry)}
          // hovering a plain item in the top level closes whatever submenu was open
          onMouseEnter={nested ? undefined : () => setSubId(null)}
        >
          <span className="popup-label">{entry.title}</span>
          {entry.keys && <Keys keys={entry.keys} />}
        </button>
      );
    });

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
              {renderEntries(menu.entries, false)}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
