"use client";

import { useEffect } from "react";
import { initErrorMonitor } from "@/lib/error-monitor";
import { DEFAULT_ERROR_MONITOR_ENDPOINT } from "@/lib/error-monitor-shared";

export function ErrorMonitorInit() {
  useEffect(() => {
    initErrorMonitor({
      endpoint: process.env.NEXT_PUBLIC_ERROR_MONITOR_ENDPOINT || DEFAULT_ERROR_MONITOR_ENDPOINT,
    });
  }, []);
  return null;
}
