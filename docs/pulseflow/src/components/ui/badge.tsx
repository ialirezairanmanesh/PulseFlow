import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
  {
    variants: {
      variant: {
        default: "bg-white/10 text-[var(--ink-muted)]",
        live: "bg-emerald-400/15 text-emerald-300",
        mock: "bg-amber-400/15 text-amber-200",
        error: "bg-rose-400/15 text-rose-300",
        idle: "bg-white/8 text-[var(--ink-faint)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
