import logoForDark from "@assets/logo-light.svg";
import logoForLight from "@assets/logo.svg";

export function Logo({ size, className = "" }: { size: number; className?: string }) {
  return (
    <span className={`logo ${className}`} style={{ width: size, height: size }} aria-label="Wither">
      <img src={logoForDark} alt="" className="logo-on-dark" draggable={false} />
      <img src={logoForLight} alt="" className="logo-on-light" draggable={false} />
    </span>
  );
}
