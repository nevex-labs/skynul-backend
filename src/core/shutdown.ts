import { channelManager } from '../routes/integrations';
import { logger } from './logger';

// State
let isShuttingDown = false;
let serverStarted = false;

// Config
const SHUTDOWN_TIMEOUT = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);
const AGENT_LOOP_TIMEOUT = Number.parseInt(process.env.AGENT_LOOP_TIMEOUT_MS ?? '60000', 10);

export function markServerStarted(): void {
  serverStarted = true;
}

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

export function setupShutdownHandlers(server: { close: () => void }): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, forcing exit...');
      process.exit(1);
    }

    if (!serverStarted) {
      logger.warn({ signal }, 'Server never started, exiting without cleanup');
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info({ signal }, 'Starting graceful shutdown...');

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT);
    });

    try {
      await Promise.race([gracefulShutdown(server), timeoutPromise]);
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Graceful shutdown failed or timed out, forcing exit');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGUSR2', () => {
    logger.info('SIGUSR2 received (nodemon restart), shutting down gracefully...');
    void shutdown('SIGUSR2');
  });

  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
}

async function gracefulShutdown(server: { close: () => void }) {
  // 1. Stop accepting new connections
  logger.info('Closing HTTP server...');
  server.close();

  // 2. Close WebSocket connections
  logger.info('Closing WebSocket connections...');
  const { closeAllClients } = await import('../ws/events');
  closeAllClients();

  // 3. Stop all channel integrations
  logger.info('Stopping channel integrations...');
  await channelManager.stopAll();

  // 4. Mark running tasks as shutting_down and wait for them
  const { taskManager } = await import('../routes/tasks');
  const activeTaskCount = taskManager.markShuttingDown();
  logger.info({ activeTaskCount }, 'Marked tasks as shutting_down, waiting for completion...');

  if (activeTaskCount > 0) {
    const allCompleted = await taskManager.waitForAllTasks(AGENT_LOOP_TIMEOUT);
    if (allCompleted) {
      logger.info('All tasks completed gracefully');
    } else {
      logger.warn('Timeout waiting for tasks, forcing cancellation');
    }
  }

  // 5. Kill background processes
  logger.info('Killing background processes...');
  const { getProcessRegistry } = await import('./agent/process-registry');
  const processRegistry = getProcessRegistry();
  processRegistry.destroyAll();

  // 6. Destroy remaining tasks
  logger.info('Destroying remaining tasks...');
  taskManager.destroyAll();

  // 7. Close browser connections
  logger.info('Closing browser connections...');
  const { closeSharedPlaywrightChromeCdp } = await import('./browser/playwright-cdp');
  await closeSharedPlaywrightChromeCdp();

  // 8. Close database connections
  logger.info('Closing database connections...');
  const { disposeAllRuntimes } = await import('../lib/hono-effect');
  await disposeAllRuntimes();
  const { closeDatabasePool } = await import('../services/database');
  await closeDatabasePool();

  // 9. Flush logs
  logger.info('Flushing logs...');
  await logger.flush();
}
