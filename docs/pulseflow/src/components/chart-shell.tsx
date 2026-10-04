"use client";

export function ChartShell({
  title,
  subtitle,
  empty,
  loading,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  empty?: string;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative min-h-[240px] overflow-hidden rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm ${className}`}
    >
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            {title}
          </h3>
          <p className="text-sm text-[var(--ink-muted)]">{subtitle}</p>
        </div>
      </div>
      {loading ? (
        <div className="flex h-[180px] items-center justify-center text-sm text-[var(--ink-faint)]">
          Waiting for samples…
        </div>
      ) : empty ? (
        <div className="flex h-[180px] items-center justify-center text-center text-sm text-[var(--ink-faint)]">
          {empty}
        </div>
      ) : (
        <div className="h-[180px] w-full">{children}</div>
      )}
    </section>
  );
}
