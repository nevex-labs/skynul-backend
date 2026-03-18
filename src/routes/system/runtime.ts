import { execSync } from 'child_process';
import { Hono } from 'hono';

const runtime = new Hono().get('/stats', (c) => {
  try {
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

    return c.json({
      app: {
        cpuPercent,
        memoryMB: Math.floor(memUsage.heapUsed / 1024 / 1024),
      },
      system: {
        freeMemMB,
      },
    });
  } catch (e) {
    return c.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});

export { runtime };
export type RuntimeRoute = typeof runtime;
