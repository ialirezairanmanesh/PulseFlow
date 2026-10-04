"use client";

import type { ReactNode } from "react";
import { PulseProvider } from "@/lib/pulse-store";

export function Providers({ children }: { children: ReactNode }) {
  return <PulseProvider>{children}</PulseProvider>;
}
