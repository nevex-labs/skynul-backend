import type { LoopSetupFn, LoopSetupResult } from '../loop-registry';
import type { TaskAction } from '../task-runner';

export interface ShellRunner {
  run(command: string, cwd?: string, timeout?: number): Promise<string>;
}

export type CodeLoopOpts = {
  shellRunner: ShellRunner;
};

export function createCodeLoopSetup(opts: CodeLoopOpts): LoopSetupFn {
  return (task): LoopSetupResult => {
    const actionExecutors: Record<string, (action: TaskAction) => Promise<string | undefined>> = {
      shell: async (action) => {
        return opts.shellRunner.run(
          (action as any).command as string,
          (action as any).cwd as string | undefined,
          (action as any).timeout as number | undefined
        );
      },
      wait: async (action) => {
        await new Promise((r) => setTimeout(r, (action as any).ms ?? 1000));
        return undefined;
      },
    };

    const systemPrompt = [
      `You are an autonomous code agent. Execute the user's task using shell commands and file operations.`,
      `You have NO screen access. Do NOT use click, scroll, move, or other screen actions.`,
      `Respond with JSON: {"thought": "...", "action": {"type": "...", ...}}`,
      `When done: {"action": {"type": "done", "summary": "..."}}`,
      `When failing: {"action": {"type": "fail", "reason": "..."}}`,
      task.capabilities.length > 0 ? `\nAvailable capabilities: ${task.capabilities.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const initialHistory = [
      {
        role: 'user' as const,
        content: `Task: ${task.prompt}`,
      },
    ];

    return { actionExecutors, systemPrompt, initialHistory };
  };
}
