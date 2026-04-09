import type { UpgradeWebSocket } from 'hono/ws';
import { getScreencastEngine } from '../core/browser/screencast-registry';

const FRAME_INTERVAL_MS = 300;

export function createScreencastHandler(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket((c) => {
    const taskId = c.req.param('taskId') ?? '';

    let timer: ReturnType<typeof setInterval> | null = null;
    let capturing = false;

    return {
      onOpen(_event, ws) {
        timer = setInterval(async () => {
          if (capturing) return;
          const engine = getScreencastEngine(taskId);
          if (!engine) {
            ws.send(JSON.stringify({ type: 'idle' }));
            return;
          }
          capturing = true;
          try {
            let data: Uint8Array;
            if (engine.screenshotJpeg) {
              const buf = await engine.screenshotJpeg(25);
              data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            } else {
              const b64 = await engine.screenshot();
              const buf = Buffer.from(b64, 'base64');
              data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            }
            ws.send(data as unknown as ArrayBuffer);
          } catch {
            // page might be navigating — skip this frame
          } finally {
            capturing = false;
          }
        }, FRAME_INTERVAL_MS);
      },
      onClose() {
        if (timer) clearInterval(timer);
      },
      onError() {
        if (timer) clearInterval(timer);
      },
    };
  });
}
