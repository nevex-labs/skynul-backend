import type { TaskAction } from '../../../types';
import {
  deleteFact as dbDeleteFact,
  formatObservationsForPrompt,
  getRecentObservations,
  saveFact,
  saveObservation,
  searchObservations,
} from '../task-memory';
import type { ExecutorContext, ExecutorResult } from './index';

async function handleRememberFact(fact: string): Promise<ExecutorResult> {
  if (!fact || typeof fact !== 'string') return { ok: false, error: '"fact" string required' };
  try {
    await saveFact(fact);
    return { ok: true, value: `Remembered: "${fact}"` };
  } catch {
    return { ok: false, error: 'Failed to save fact' };
  }
}

async function handleForgetFact(factId: string): Promise<ExecutorResult> {
  if (typeof factId !== 'string' || !factId) return { ok: false, error: '"factId" string required' };
  try {
    await dbDeleteFact(factId);
    return { ok: true, value: `Forgot fact #${factId}` };
  } catch {
    return { ok: false, error: 'Failed to delete fact' };
  }
}

export async function executeFactAction(
  _ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'remember_fact' | 'forget_fact' }>
): Promise<ExecutorResult> {
  if (action.type === 'remember_fact') return handleRememberFact(action.fact);
  return handleForgetFact(action.factId);
}

async function handleMemorySave(action: Extract<TaskAction, { type: 'memory_save' }>): Promise<ExecutorResult> {
  if (!action.title || !action.content) return { ok: false, error: '"title" and "content" are required' };
  try {
    const id = await saveObservation({
      title: action.title,
      content: action.content,
      obs_type: action.obs_type,
      project: action.project,
      topic_key: action.topic_key,
    });
    if (!id) return { ok: false, error: 'Failed to save observation' };
    return { ok: true, value: `Observation saved (id=${id}): "${action.title}"` };
  } catch {
    return { ok: false, error: 'Failed to save observation' };
  }
}

async function handleMemorySearch(action: Extract<TaskAction, { type: 'memory_search' }>): Promise<ExecutorResult> {
  if (!action.query) return { ok: false, error: '"query" is required' };
  try {
    const obs = await searchObservations(action.query, {
      type_filter: action.type_filter,
      project: action.project,
      limit: action.limit,
    });
    if (obs.length === 0) return { ok: true, value: 'No matching observations found.' };
    return { ok: true, value: formatObservationsForPrompt(obs) };
  } catch {
    return { ok: false, error: 'Failed to search observations' };
  }
}

async function handleMemoryContext(action: Extract<TaskAction, { type: 'memory_context' }>): Promise<ExecutorResult> {
  try {
    const obs = await getRecentObservations({ project: action.project, limit: action.limit });
    if (obs.length === 0) return { ok: true, value: 'No observations in memory.' };
    return { ok: true, value: formatObservationsForPrompt(obs) };
  } catch {
    return { ok: false, error: 'Failed to get observations' };
  }
}

export async function executeMemoryAction(
  _ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'memory_save' | 'memory_search' | 'memory_context' }>
): Promise<ExecutorResult> {
  if (action.type === 'memory_save') return handleMemorySave(action);
  if (action.type === 'memory_search') return handleMemorySearch(action);
  return handleMemoryContext(action);
}
