export function RoleTab({ kit }: { kit: any }) {
  return (
    <div className="space-y-6 max-w-xl">
      <p className="text-sm text-ink-faint">
        {kit.role.seniority} · {kit.role.title}
      </p>
      {kit.role.responsibilities?.length > 0 && (
        <div>
          <h3 className="font-mono text-sm text-ink mb-2">Responsibilities</h3>
          <ul className="space-y-1.5">
            {kit.role.responsibilities.map((r: string, i: number) => (
              <li key={i} className="text-sm text-ink-faint">
                — {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="font-mono text-sm text-ink mb-2">Requirements</h3>
        <ul className="space-y-2">
          {kit.role.requirements.map((r: any) => (
            <li key={r.id} className="flex items-start gap-2 text-sm">
              <span
                className={`shrink-0 mt-0.5 text-xs font-mono px-1.5 py-0.5 ${
                  r.priority === "must" ? "bg-highlight text-ink" : "border border-line text-ink-faint"
                }`}
              >
                {r.priority}
              </span>
              <span className="text-ink">{r.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
