/** Original HealthTwin mark: two overlapping rings (the person and their twin). */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6c9bff" /><stop offset="1" stopColor="#2a58c8" /></linearGradient></defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <circle cx="12.5" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2" opacity=".7" />
      <circle cx="19.5" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
