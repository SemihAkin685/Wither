import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Keys({ keys }: { keys: string }) {
  return (
    <span className="keys">
      {keys.split(" ").map((chord, i) => (
        <span key={i} className="keys-chord">
          {chord.split("+").map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
