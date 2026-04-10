import type { TaskCapabilityId, TaskMode, TaskRunnerId } from '../../types';

export function deriveRunner(
  mode: TaskMode,
  capabilities: TaskCapabilityId[],
  orchestrate?: string | boolean
): TaskRunnerId {
  if (orchestrate === 'sequential' || orchestrate === 'parallel' || orchestrate === 'conditional')
    return 'orchestrator';

  if (capabilities.some((c) => c.endsWith('.trading'))) return 'cdp';

  if (mode === 'sandbox') return 'sandbox';
  return 'web';
}
