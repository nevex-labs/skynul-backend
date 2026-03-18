export type RuntimeStats = {
  ts: number;
  app: {
    /** Sum of percentCPUUsage across processes. */
    cpuPercent: number;
    /** Sum of working set memory across processes. */
    memoryMB: number;
    processCount: number;
  };
  system: {
    totalMemMB: number;
    freeMemMB: number;
    loadavg1m: number;
  };
};
