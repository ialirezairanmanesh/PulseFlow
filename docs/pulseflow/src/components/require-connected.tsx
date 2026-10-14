"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePulse } from "@/lib/pulse-store";

/** Routes that work without a live Flutter VM session (offline analysis). */
const OFFLINE_OK = ["/size"];

export function RequireConnected({ children }: { children: React.ReactNode }) {
  const { connected, sharedView } = usePulse();
  const router = useRouter();
  const pathname = usePathname() || "";
  const offlineOk = OFFLINE_OK.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!connected && !sharedView && !offlineOk) {
      router.replace("/");
    }
  }, [connected, sharedView, offlineOk, router]);

  if (!connected && !sharedView && !offlineOk) {
    return (
      <p className="text-sm text-[var(--ink-faint)]">Redirecting to connect…</p>
    );
  }

  return <>{children}</>;
}
