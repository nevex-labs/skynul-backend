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

const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pendiente',
  approved: 'Aprobada',
  running: 'En curso',
  completed: 'Completada',
  failed: 'Falló',
  cancelled: 'Cancelada',
  monitoring: 'Monitoreando',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Convert bare URLs to Telegram-clickable markdown links */
function linkify(text: string): string {
  return text
    .replace(/🔗\s*(https?:\/\/[^\s)]+)/g, (_m, url) => `[Ver acá](${url})`)
    .replace(/(?<![([])(https?:\/\/[^\s)]+)(?!\))/g, (url) => `[Link](${url})`);
}

// ── Public formatters ────────────────────────────────────────────────────────

export function formatTaskSummary(task: Task): string {
  const header =
    task.status === 'running'
      ? '\u{1f680} *Tarea en marcha*'
      : task.status === 'completed'
        ? '\u2705 *Tarea completada*'
        : task.status === 'failed'
          ? '\u26a0\ufe0f *Tarea fallida*'
          : task.status === 'cancelled'
            ? '\u26d4 *Tarea cancelada*'
            : task.status === 'monitoring'
              ? '\u{1f440} *Monitoreando*'
              : '\u2139\ufe0f *Estado de tarea*';

  const lines = [header, '', truncate(task.prompt, 150), `Estado: ${statusLabel(task.status)}`];
  if (task.summary) lines.push(linkify(task.summary));
  return lines.join('\n');
}

export function formatStepUpdate(task: Task): string {
  const step = task.steps[task.steps.length - 1];
  const thought = step?.thought ? `\n${truncate(step.thought, 150)}` : '';
  return `Trabajando... (paso ${task.steps.length}/${task.maxSteps})${thought}`;
}

export function formatTaskComplete(task: Task): string {
  if (task.summary) {
    return linkify(task.summary);
  }
  return 'Listo, terminé.';
}

export function formatTaskFailed(task: Task): string {
  if (task.error) return `No pude completarlo: ${truncate(task.error, 200)}`;
  if (task.status === 'cancelled') return 'Cancelado.';
  return 'No pude completar la tarea.';
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return '\u{1f4ed} No hay tareas.';

  const lines = ['\u{1f4cb} *Tus tareas:*', ''];

  tasks.slice(0, 10).forEach((t, i) => {
    const date = friendlyDate(t.createdAt);
    lines.push(`${i + 1}. ${truncate(t.prompt, 60)}`);
    lines.push(`   ${statusLabel(t.status)} - ${date}`);
    lines.push('');
  });

  if (tasks.length > 10) {
    lines.push(`...y ${tasks.length - 10} más`);
  }

  return lines.join('\n');
}
