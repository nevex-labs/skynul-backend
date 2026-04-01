import { Box, Text } from 'ink';
import React from 'react';
import type { Task, TaskAction, TaskStep } from '../../types/task.js';
import { formatDuration, timeAgo } from '../utils.js';

type Props = {
  task: Task;
  width: number;
};

function actionLabel(action: TaskAction): string {
  switch (action.type) {
    case 'click':
      return `click(${action.x}, ${action.y})`;
    case 'double_click':
      return `dblclick(${action.x}, ${action.y})`;
    case 'type':
      return `type "${action.text.slice(0, 30)}${action.text.length > 30 ? '…' : ''}"`;
    case 'key':
      return `key ${action.combo}`;
    case 'scroll':
      return `scroll ${action.direction} ${action.amount ?? 1}`;
    case 'move':
      return `move(${action.x}, ${action.y})`;
    case 'shell':
      return `shell "${action.command.slice(0, 40)}"`;
    case 'launch':
      return `launch ${action.app}`;
    case 'wait':
      return `wait ${action.ms}ms`;
    case 'done':
      return `done: ${action.summary.slice(0, 40)}`;
    case 'fail':
      return `fail: ${action.reason.slice(0, 40)}`;
    case 'user_message':
      return `msg: ${action.text.slice(0, 40)}`;
    case 'web_scrape':
      return `scrape ${action.url}`;
    case 'file_read':
      return `read ${action.path}`;
    case 'file_write':
      return `write ${action.path}`;
    case 'file_edit':
      return `edit ${action.path}`;
    case 'file_list':
      return `list ${action.pattern}`;
    case 'file_search':
      return `search ${action.pattern}`;
    case 'plan':
      return `plan (${action.plan.subtasks.length} subtasks)`;
    case 'task_spawn':
      return `spawn: ${action.prompt.slice(0, 30)}`;
    case 'task_spawn_batch':
      return `spawn batch (${action.tasks.length})`;
    case 'task_wait':
      return `wait for ${action.taskIds.length} tasks`;
    case 'task_list_peers':
      return 'list peers';
    case 'task_send':
      return `send: ${action.prompt.slice(0, 30)}`;
    case 'task_read':
      return `read task ${action.taskId}`;
    case 'task_message':
      return `msg ${action.taskId}`;
    case 'set_identity':
      return `identity: ${action.name}`;
    case 'remember_fact':
      return `remember: ${action.fact.slice(0, 30)}`;
    case 'forget_fact':
      return `forget fact #${action.factId}`;
    case 'memory_save':
      return `memory: ${action.title}`;
    case 'memory_search':
      return `search memory: ${action.query}`;
    case 'memory_context':
      return 'memory context';
    case 'generate_image':
      return `image: ${action.prompt.slice(0, 30)}`;
    case 'save_to_excel':
      return `excel: ${action.filename}`;
    case 'upload_file':
      return `upload: ${action.filePaths.length} files`;
    case 'app_script':
      return `script ${action.app}`;
    default:
      return (action as { type: string }).type;
  }
}

function StepLine({ step }: { step: TaskStep }): React.JSX.Element {
  const hasError = !!step.error;
  const hasThought = !!step.thought;
  const hasResult = !!step.result;
  const color = hasError ? '#FF4444' : step.action.type === 'done' ? '#00FF88' : '#00D4FF';

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text dimColor> #{String(step.index).padStart(3, '0')} </Text>
        <Text color={color}> {actionLabel(step.action)} </Text>
        {step.contextPct !== undefined && <Text dimColor> ctx:{Math.round(step.contextPct * 100)}%</Text>}
      </Box>
      {hasThought && (
        <Box marginLeft={7} marginRight={2}>
          <Text color="#FF00FF" italic>
            💭 {step.thought!.slice(0, Math.max(60, 120))}
          </Text>
        </Box>
      )}
      {hasResult && (
        <Box marginLeft={7} marginRight={2}>
          <Text color="#8888AA">→ {step.result!.slice(0, Math.max(60, 120))}</Text>
        </Box>
      )}
      {hasError && (
        <Box marginLeft={7} marginRight={2}>
          <Text color="#FF4444">✖ {step.error!.slice(0, Math.max(60, 120))}</Text>
        </Box>
      )}
    </Box>
  );
}

function TaskHeader({ task }: { task: Task }): React.JSX.Element {
  const statusColors: Record<string, string> = {
    running: '#00FF88',
    completed: '#00D4FF',
    failed: '#FF4444',
    cancelled: '#FFAA00',
    pending_approval: '#FF00FF',
    approved: '#4488FF',
  };
  const color = statusColors[task.status] ?? '#FFFFFF';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      <Box flexDirection="row" gap={2}>
        <Text color={color} bold>
          {task.status.toUpperCase()}
        </Text>
        <Text bold>{task.id}</Text>
        <Text dimColor>{task.runner.toUpperCase()}</Text>
        {task.source && <Text dimColor>via {task.source}</Text>}
      </Box>
      <Box flexDirection="row">
        <Text>{task.prompt}</Text>
      </Box>
      <Box flexDirection="row" gap={3}>
        <Text dimColor>
          steps: {task.steps.length}/{task.maxSteps}
        </Text>
        <Text dimColor>duration: {formatDuration(task.updatedAt - task.createdAt)}</Text>
        <Text dimColor>{timeAgo(task.createdAt)}</Text>
        {task.usage && (
          <Text dimColor>tokens: {(task.usage.inputTokens + task.usage.outputTokens).toLocaleString()}</Text>
        )}
      </Box>
      {task.error && (
        <Box>
          <Text color="#FF4444">✖ {task.error}</Text>
        </Box>
      )}
      {task.summary && (
        <Box>
          <Text color="#00FF88">◆ {task.summary}</Text>
        </Box>
      )}
      {task.childTaskIds && task.childTaskIds.length > 0 && (
        <Box>
          <Text dimColor>children: {task.childTaskIds.join(', ')}</Text>
        </Box>
      )}
    </Box>
  );
}

export function TaskDetail({ task, width }: Props): React.JSX.Element {
  const steps = task.steps;
  const maxVisible = 20;
  const visibleSteps = steps.slice(-maxVisible);

  return (
    <Box flexDirection="column">
      <TaskHeader task={task} />

      <Box marginTop={1} marginLeft={1}>
        <Text bold color="#00D4FF">
          STEPS ({steps.length}
          {steps.length > maxVisible ? ` — showing last ${maxVisible}` : ''})
        </Text>
      </Box>

      {visibleSteps.length === 0 ? (
        <Box marginLeft={1}>
          <Text dimColor> no steps yet</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visibleSteps.map((step) => (
            <StepLine key={step.index} step={step} />
          ))}
        </Box>
      )}
    </Box>
  );
}
