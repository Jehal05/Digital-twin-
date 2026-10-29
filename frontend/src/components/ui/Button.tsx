import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
const V: Record<Variant, string> = {
  primary: "bg-brand text-on-strong hover:brightness-95 disabled:opacity-60",
  secondary: "bg-card/80 text-ink border border-white hover:bg-card disabled:opacity-60",
  ghost: "text-brand hover:bg-brand-soft disabled:opacity-60",
};

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button {...rest}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${V[variant]} ${className}`} />
  );
}
