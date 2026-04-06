import { closeSecretReaderPool } from '../v2/secret-reader';
import { logger } from './logger';

let isShuttingDown = false;
let serverStarted = false;

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
  logger.info('Closing HTTP server...');
  server.close();

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

  logger.info('Destroying remaining tasks...');
  taskManager.destroyAll();

  logger.info('Closing browser connections...');
  const { closeSharedPlaywrightChromeCdp } = await import('./browser/playwright-cdp');
  await closeSharedPlaywrightChromeCdp();

  logger.info('Closing database connections...');
  await closeSecretReaderPool();

  logger.info('Flushing logs...');
  await logger.flush();
}
