import { execSync } from 'child_process';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Runtime stats error:', error);
  return Http.internalError();
};

const getSystemStats = () => {
  // Get memory usage
  const memUsage = process.memoryUsage();

  // Try to get CPU usage (simplified)
  let cpuPercent = 0;
  try {
    // This is a rough approximation
    const startUsage = process.cpuUsage();
    // Small delay to measure
    const endUsage = process.cpuUsage(startUsage);
    cpuPercent = (endUsage.user + endUsage.system) / 1000000; // Convert to seconds
  } catch {
    // Ignore CPU measurement errors
  }

  // Try to get system free memory
  let freeMemMB = 0;
  try {
    if (process.platform === 'linux') {
      const memInfo = execSync('free -m | grep Mem:', { encoding: 'utf8' });
      const parts = memInfo.trim().split(/\s+/);
      freeMemMB = Number.parseInt(parts[3], 10) || 0;
    } else if (process.platform === 'darwin') {
      const memInfo = execSync('vm_stat | grep "Pages free"', { encoding: 'utf8' });
      const match = memInfo.match(/(\d+)/);
      if (match) {
        freeMemMB = Math.floor((Number.parseInt(match[1], 10) * 4096) / 1024 / 1024);
      }
    } else if (process.platform === 'win32') {
      const memInfo = execSync('wmic OS get FreePhysicalMemory /Value', { encoding: 'utf8' });
      const match = memInfo.match(/FreePhysicalMemory=(\d+)/);
      if (match) {
        freeMemMB = Math.floor(Number.parseInt(match[1], 10) / 1024);
      }
    }
  } catch {
    // Ignore system memory errors
  }

  return {
    app: {
      cpuPercent,
      memoryMB: Math.floor(memUsage.heapUsed / 1024 / 1024),
    },
    system: {
      freeMemMB,
    },
  };
};

const runtime = new Hono().get(
  '/stats',
  handler((c) =>
    Effect.sync(() => {
      try {
        const stats = getSystemStats();
        return Http.ok(stats);
      } catch (e) {
        return handleError(e);
      }
    })
  )
);

export { runtime };
export type RuntimeRoute = typeof runtime;
