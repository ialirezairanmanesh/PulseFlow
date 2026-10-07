import { Suspense } from "react";
import { LogsPanel } from "@/components/logs-panel";
import { RequireConnected } from "@/components/require-connected";

export const metadata = {
  title: "Logs — PulseFlow",
  description: "Runtime log stream from the VM Service Logging channel.",
};

export default function LogsPage() {
  return (
    <Suspense fallback={<LogsPanel />}>
      <RequireConnected>
        <LogsPanel />
      </RequireConnected>
    </Suspense>
  );
}
