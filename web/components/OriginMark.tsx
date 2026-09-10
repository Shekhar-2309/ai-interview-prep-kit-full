export function OriginMark({ meta }: { meta?: { origin: string } }) {
  if (!meta || meta.origin === "generated") return null;
  const label = meta.origin === "manual" ? "added by hand" : "edited";
  return (
    <span className="shrink-0 text-xs font-mono text-pen flex items-center gap-1" title={label}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path
          d="M1 9L1.5 6.5L6.5 1.5L8.5 3.5L3.5 8.5L1 9Z"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </span>
  );
}
