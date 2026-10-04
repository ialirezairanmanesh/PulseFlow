"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePulse } from "@/lib/pulse-store";

export function RequireConnected({ children }: { children: React.ReactNode }) {
  const { connected } = usePulse();
  const router = useRouter();

  useEffect(() => {
    if (!connected) {
      router.replace("/");
    }
  }, [connected, router]);

  if (!connected) {
    return (
      <p className="text-sm text-[var(--ink-faint)]">Redirecting to connect…</p>
    );
  }

  return <>{children}</>;
}
