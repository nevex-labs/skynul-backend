import type { Task } from '../../types';

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

function friendlyDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function durationText(task: Task): string {
  if (!task.updatedAt || !task.createdAt) return '';
  const secs = Math.round((task.updatedAt - task.createdAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: '\u23f3 Pendiente',
  approved: '\u{1f680} Aprobada',
  running: '\u{1f504} En curso',
  completed: '\u2705 Completada',
  failed: '\u274c Falló',
  cancelled: '\u26d4 Cancelada',
};

function statusText(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function statusIcon(status: string): string {
  return (STATUS_LABEL[status] ?? '\u2753').split(' ')[0];
}

/** Convert bare URLs to Telegram-clickable markdown links */
function linkify(text: string): string {
  return text
    .replace(/🔗\s*(https?:\/\/[^\s)]+)/g, (_m, url) => `🔗 [Ver acá](${url})`)
    .replace(/(?<![([])(https?:\/\/[^\s)]+)(?!\))/g, (url) => `[Link](${url})`);
}

// ── Public formatters ────────────────────────────────────────────────────────

export function formatTaskSummary(task: Task): string {
  return [
    `\u{1f680} *Tarea en marcha*`,
    '',
    `\u{1f4dd} ${truncate(task.prompt, 200)}`,
    '',
    `_Te aviso cuando termine!_`,
  ].join('\n');
}

export function formatStepUpdate(task: Task): string {
  const step = task.steps[task.steps.length - 1];
  const thought = step?.thought ? `\n\u{1f4ad} _${truncate(step.thought, 150)}_` : '';
  return [
    `\u{1f504} *Trabajando...* (paso ${task.steps.length}/${task.maxSteps})`,
    `\u{1f4dd} ${truncate(task.prompt, 80)}${thought}`,
  ].join('\n');
}

export function formatTaskComplete(task: Task): string {
  if (task.summary) return linkify(task.summary);
  return 'Tarea completada.';
}

export function formatTaskFailed(task: Task): string {
  if (task.error) return task.error;
  if (task.status === 'cancelled') return 'Tarea cancelada.';
  return 'La tarea falló.';
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return '\u{1f4ed} No hay tareas.';

  const lines = ['\u{1f4cb} *Tus tareas:*', ''];

  tasks.slice(0, 10).forEach((t, i) => {
    const date = friendlyDate(t.createdAt);
    lines.push(`${statusIcon(t.status)} *${i + 1}.* ${truncate(t.prompt, 60)}`);
    lines.push(`     _${statusText(t.status)}_ \u2022 ${date}`);
    lines.push('');
  });

  if (tasks.length > 10) {
    lines.push(`_...y ${tasks.length - 10} más_`);
  }

  return lines.join('\n');
}
