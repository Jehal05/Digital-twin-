import type { ReactNode } from "react";
import { Button } from "./Button";

export const Skeleton = ({ className = "h-6 w-full" }: { className?: string }) => <div aria-hidden className={`skeleton ${className}`} />;

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl bg-high-bg p-4 text-sm text-high">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel-dim p-5 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
