import { CloudDataBootstrap } from "@/features/core/sync/CloudDataBootstrap";
import { useMultiDeviceSync } from "@/lib/realtime/useMultiDeviceSync";
import { useRealtimeRefreshBridge } from "@/lib/realtime/useRealtimeRefreshBridge";

/** Authenticated background work that must never delay or replace the page UI. */
export default function BackgroundRuntime() {
  useRealtimeRefreshBridge();
  useMultiDeviceSync();
  return <CloudDataBootstrap />;
}
