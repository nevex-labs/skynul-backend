import { Box, Text } from 'ink';
import React from 'react';
import type { Task } from '../../types/task.js';
import { formatDuration, progressBar, timeAgo, truncate } from '../utils.js';

const STATUS_GLYPH: Record<string, string> = {
  running: '⠋',
  completed: '◆',
  failed: '✖',
  cancelled: '◇',
  pending_approval: '◈',
  approved: '▸',
};

const STATUS_LABEL: Record<string, string> = {
  running: 'RUNNING',
  completed: 'DONE',
  failed: 'FAIL',
  cancelled: 'KILL',
  pending_approval: 'WAIT',
  approved: 'RDY',
};

const STATUS_COLORS: Record<string, string> = {
  running: '#00FF88',
  completed: '#00D4FF',
  failed: '#FF4444',
  cancelled: '#FFAA00',
  pending_approval: '#FF00FF',
  approved: '#4488FF',
};

function ProgressBar({ task, colWidth }: { task: Task; colWidth: number }): React.JSX.Element {
  const steps = task.steps.length;
  const pct = steps / task.maxSteps;
  const barW = Math.min(colWidth - 20, 20);
  const bar = progressBar(steps, task.maxSteps, barW);
  const barColor = pct > 0.8 ? '#FF4444' : pct > 0.5 ? '#FFAA00' : '#00FF88';

  return (
    <Box flexDirection="row">
      <Text color={barColor}>{bar}</Text>
      <Text dimColor> {Math.round(pct * 100)}% </Text>
      <Text dimColor>
        step {steps}/{task.maxSteps}
      </Text>
    </Box>
  );
}

function TaskMeta({ task }: { task: Task }): React.JSX.Element {
  const parts: string[] = [task.runner.toUpperCase()];
  if (task.usage) {
    const total = task.usage.inputTokens + task.usage.outputTokens;
    parts.push(`${(total / 1000).toFixed(1)}k tok`);
  }
  if (task.source) parts.push(task.source);

  return (
    <Text dimColor>
      {' └ '}
      {parts.map((p) => (
        <React.Fragment key={p}>
          {p !== parts[0] && <Text dimColor> · </Text>}
          <Text dimColor>{p}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#333355" paddingX={1}>
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text color="#555577"> ┌─────────────────────┐</Text>
        <Text color="#555577"> │ NO ACTIVE MISSIONS │</Text>
        <Text color="#555577"> └─────────────────────┘</Text>
        <Box marginTop={1}>
          <Text dimColor>Create a task via the API to begin</Text>
        </Box>
      </Box>
    </Box>
  );
}

type Props = {
  tasks: Task[];
  width: number;
  selectedIndex?: number;
};

export function TaskList({ tasks, width, selectedIndex = -1 }: Props): React.JSX.Element {
  const running = tasks.filter((t) => t.status === 'running');
  const others = tasks
    .filter((t) => t.status !== 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10 - running.length);
  const display = [...running, ...others];

  if (display.length === 0) return <EmptyState />;

  const innerW = Math.max(width - 10, 40);

  return (
    <Box flexDirection="column">
      {display.map((task, idx) => {
        const statusColor = STATUS_COLORS[task.status] ?? '#FFFFFF';
        const isSelected = idx === selectedIndex;
        const prefix = isSelected ? '▸ ' : '  ';
        const isRunning = task.status === 'running';
        const separator = idx < display.length - 1 ? '─'.repeat(Math.min(innerW, 70)) : '';

        return (
          <Box key={task.id} flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={isSelected ? '#FFFFFF' : undefined}>{prefix}</Text>
              <Box flexDirection="row">
                <Text color={statusColor} bold>
                  {STATUS_GLYPH[task.status] ?? '?'}
                </Text>
                <Text color={statusColor} bold>
                  {' '}
                  {STATUS_LABEL[task.status] ?? '????'}
                </Text>
              </Box>
              <Box width={innerW - 22}>
                <Text>{truncate(task.prompt, innerW - 18)}</Text>
              </Box>
              <Box width={10} justifyContent="flex-end">
                <Text dimColor>{timeAgo(task.createdAt)}</Text>
              </Box>
            </Box>

            {isRunning && (
              <Box marginLeft={8}>
                <ProgressBar task={task} colWidth={innerW - 8} />
              </Box>
            )}

            <Box marginLeft={8}>
              <TaskMeta task={task} />
              {!isRunning && <Text dimColor> · {formatDuration(task.updatedAt - task.createdAt)}</Text>}
            </Box>

            {separator && (
              <Box marginLeft={2} marginRight={2}>
                <Text dimColor>{separator}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
