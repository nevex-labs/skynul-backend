import { dirname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { DEFAULT_POLICY, type PolicyState, type ProviderId } from '../../types';
import { getDataDir } from '../config';
import { PolicyStateSchema } from './schemas';

function policyPath(): string {
  return join(getDataDir(), 'policy.json');
}

function normalizePolicy(parsed: Record<string, unknown>): PolicyState {
  let activeProvider =
    ((parsed.provider as Record<string, unknown>)?.active as string) ?? DEFAULT_POLICY.provider.active;
  if (activeProvider === 'openai') activeProvider = 'chatgpt';

  return {
    workspaceRoot: (parsed.workspaceRoot as string | null) ?? null,
    capabilities: {
      ...DEFAULT_POLICY.capabilities,
      ...((parsed.capabilities as Record<string, boolean>) ?? {}),
    },
    themeMode: (parsed.themeMode as PolicyState['themeMode']) ?? DEFAULT_POLICY.themeMode,
    language: (parsed.language as PolicyState['language']) ?? DEFAULT_POLICY.language,
    provider: {
      active: activeProvider as ProviderId,
      openaiModel:
        ((parsed.provider as Record<string, unknown>)?.openaiModel as string) ?? DEFAULT_POLICY.provider.openaiModel,
    },
    taskMemoryEnabled: (parsed.taskMemoryEnabled as boolean) ?? DEFAULT_POLICY.taskMemoryEnabled,
    taskAutoApprove: (parsed.taskAutoApprove as boolean) ?? DEFAULT_POLICY.taskAutoApprove,
    paperTradingEnabled: (parsed.paperTradingEnabled as boolean) ?? DEFAULT_POLICY.paperTradingEnabled,
  };
}

export async function loadPolicy(): Promise<PolicyState> {
  try {
    const raw = await readFile(policyPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = PolicyStateSchema.safeParse(parsed);
    if (result.success) return normalizePolicy(result.data as unknown as Record<string, unknown>);
    console.warn('[policy-store] Invalid data:', result.error.issues);
  } catch {
    // fall through to default
  }
  return DEFAULT_POLICY;
}

export async function savePolicy(next: PolicyState): Promise<void> {
  const file = policyPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
}
