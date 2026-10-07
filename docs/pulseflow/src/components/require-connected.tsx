"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePulse } from "@/lib/pulse-store";

export function RequireConnected({ children }: { children: React.ReactNode }) {
  const { connected, sharedView } = usePulse();
  const router = useRouter();

  useEffect(() => {
    if (!connected && !sharedView) {
      router.replace("/");
    }
  }, [connected, sharedView, router]);

  if (!connected && !sharedView) {
    return (
      <p className="text-sm text-[var(--ink-faint)]">Redirecting to connect…</p>
    );
  }

  return <>{children}</>;
}
