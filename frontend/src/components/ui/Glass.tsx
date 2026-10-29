import type { ElementType, HTMLAttributes } from "react";

export function Glass<T extends ElementType = "section">({ as, className = "", ...rest }: { as?: T } & HTMLAttributes<HTMLElement>) {
  const Tag = (as ?? "section") as ElementType;
  return <Tag className={`glass ${className}`} {...rest} />;
}

export function CardTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {aside}
    </div>
  );
}
