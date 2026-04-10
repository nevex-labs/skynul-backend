import type { TaskAction } from '../../../types';
import { generateImage } from '../../providers/image-gen';
import type { ExecutorContext, ExecutorResult } from './index';

export async function executeImageAction(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'generate_image' }>
): Promise<ExecutorResult> {
  const prompt = String(action.prompt ?? '');
  if (!prompt) return { ok: false, error: 'generate_image requires a prompt' };

  const size = action.size ?? '1024x1024';
  try {
    const filePath = await generateImage(prompt, size);
    if (!ctx.task.attachments) ctx.task.attachments = [];
    ctx.task.attachments.push(filePath);
    ctx.pushUpdate();
    return { ok: true, value: `Image generated and saved to: ${filePath}` };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}
