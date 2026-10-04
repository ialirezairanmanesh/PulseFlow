"use client";

import { AppShell } from "@/components/app-shell";
import { RequireConnected } from "@/components/require-connected";

export default function ConnectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireConnected>
      <AppShell>{children}</AppShell>
    </RequireConnected>
  );
}
