import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

const BASE = "mt-1 block w-full rounded-xl border border-[#9fb0d3] bg-white px-3 py-2 text-sm text-ink placeholder:text-[#6b7894] aria-[invalid=true]:border-high aria-[invalid=true]:bg-high-bg/40";

interface Common { label: string; hint?: ReactNode; error?: string }

export function Field({ label, hint, error, ...input }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} {...input} aria-invalid={!!error} aria-describedby={`${id}-d`} className={BASE} />
      <p id={`${id}-d`} className={`mt-1 text-xs ${error ? "font-medium text-high" : "text-muted"}`} role={error ? "alert" : undefined}>
        {error ?? hint}
      </p>
    </div>
  );
}

export function SelectField({ label, hint, error, children, ...sel }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} {...sel} aria-invalid={!!error} aria-describedby={`${id}-d`} className={BASE}>{children}</select>
      <p id={`${id}-d`} className={`mt-1 text-xs ${error ? "font-medium text-high" : "text-muted"}`} role={error ? "alert" : undefined}>
        {error ?? hint}
      </p>
    </div>
  );
}
