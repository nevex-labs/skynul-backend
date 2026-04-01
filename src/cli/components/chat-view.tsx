import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import type { Task, TaskAction, TaskStep } from '../../types/task.js';
import { truncate } from '../utils.js';

const CHAT_WIDTH = 76;

// ── Action formatting ──────────────────────────────────────────────────────

function actionIcon(action: TaskAction): string {
  switch (action.type) {
    case 'click':
    case 'double_click':
      return '◎';
    case 'type':
      return '✎';
    case 'key':
      return '⌨';
    case 'scroll':
    case 'move':
      return '↗';
    case 'shell':
      return 'λ';
    case 'launch':
      return '▣';
    case 'wait':
      return '◌';
    case 'web_scrape':
      return '⟠';
    case 'file_read':
      return '◉';
    case 'file_write':
    case 'file_edit':
      return '✎';
    case 'file_list':
    case 'file_search':
      return '⊘';
    case 'done':
      return '◆';
    case 'fail':
      return '✖';
    case 'user_message':
      return '▸';
    case 'plan':
      return '◈';
    case 'task_spawn':
    case 'task_spawn_batch':
      return '⊞';
    case 'task_send':
    case 'task_message':
      return '→';
    case 'task_read':
    case 'task_list_peers':
      return '⊘';
    case 'task_wait':
      return '◌';
    case 'set_identity':
      return '◉';
    case 'remember_fact':
    case 'memory_save':
      return '◈';
    case 'forget_fact':
      return '⊗';
    case 'memory_search':
    case 'memory_context':
      return '⊘';
    case 'generate_image':
      return '▣';
    case 'save_to_excel':
      return '⊞';
    case 'upload_file':
      return '↑';
    case 'app_script':
      return 'λ';
    case 'chain_get_balance':
    case 'chain_get_token_balance':
    case 'chain_get_tx_status':
      return '⊘';
    case 'chain_send_token':
    case 'chain_swap':
      return '→';
    case 'cex_get_balance':
    case 'cex_get_positions':
      return '⊘';
    case 'cex_place_order':
      return '◈';
    case 'cex_cancel_order':
      return '⊗';
    case 'cex_withdraw':
      return '↑';
    default:
      return '▸';
  }
}

function actionLabel(action: TaskAction): string {
  switch (action.type) {
    case 'click':
      return `click(${action.x}, ${action.y})`;
    case 'double_click':
      return `dblclick(${action.x}, ${action.y})`;
    case 'type':
      return `type "${truncate(action.text, 40)}"`;
    case 'key':
      return `key ${action.combo}`;
    case 'scroll':
      return `scroll ${action.direction} ${action.amount ?? 1}`;
    case 'move':
      return `move(${action.x}, ${action.y})`;
    case 'shell':
      return `$ ${truncate(action.command, 50)}`;
    case 'launch':
      return `launch ${action.app}`;
    case 'wait':
      return `wait ${action.ms}ms`;
    case 'done':
      return truncate(action.summary, 60);
    case 'fail':
      return truncate(action.reason, 60);
    case 'user_message':
      return truncate(action.text, 60);
    case 'web_scrape':
      return `scrape ${truncate(action.url, 40)}`;
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
      return `spawn: ${truncate(action.prompt, 40)}`;
    case 'task_send':
      return `send: ${truncate(action.prompt, 40)}`;
    case 'task_read':
      return `read task ${action.taskId}`;
    case 'task_message':
      return `msg ${action.taskId}`;
    case 'set_identity':
      return `identity: ${action.name}`;
    case 'remember_fact':
      return `remember: ${truncate(action.fact, 40)}`;
    case 'forget_fact':
      return `forget fact #${action.factId}`;
    case 'memory_save':
      return `memory: ${action.title}`;
    case 'memory_search':
      return `search memory: ${truncate(action.query, 30)}`;
    case 'memory_context':
      return 'memory context';
    case 'generate_image':
      return `image: ${truncate(action.prompt, 40)}`;
    case 'save_to_excel':
      return `excel: ${action.filename}`;
    case 'upload_file':
      return `upload: ${action.filePaths.length} files`;
    case 'app_script':
      return `script ${action.app}`;
    case 'task_spawn_batch':
      return `spawn batch (${action.tasks.length})`;
    case 'task_wait':
      return `wait for ${action.taskIds.length} tasks`;
    case 'chain_get_balance':
      return `chain balance${action.chainId ? ` (${action.chainId})` : ''}`;
    case 'chain_get_token_balance':
      return `token balance ${action.tokenAddress.slice(0, 10)}...`;
    case 'chain_send_token':
      return `send ${action.amount} to ${action.to.slice(0, 10)}...`;
    case 'chain_swap':
      return `swap ${action.amountIn} ${action.tokenIn} → ${action.tokenOut}`;
    case 'chain_get_tx_status':
      return `tx status ${action.txHash.slice(0, 10)}...`;
    case 'cex_get_balance':
      return `${action.exchange} balance`;
    case 'cex_place_order':
      return `${action.exchange} ${action.side} ${action.amount} ${action.symbol}${action.price ? ` @ ${action.price}` : ''}`;
    case 'cex_cancel_order':
      return `${action.exchange} cancel ${action.orderId}`;
    case 'cex_get_positions':
      return `${action.exchange} positions`;
    case 'cex_withdraw':
      return `${action.exchange} withdraw ${action.amount} ${action.asset}`;
    default:
      return (action as { type: string }).type;
  }
}

// ── Single chat bubble ─────────────────────────────────────────────────────

function ChatBubble({ step, isLast }: { step: TaskStep; isLast: boolean }): React.JSX.Element {
  const hasError = !!step.error;
  const hasThought = !!step.thought;
  const hasResult = !!step.result;
  const isDone = step.action.type === 'done';
  const isFail = step.action.type === 'fail';
  const icon = actionIcon(step.action);
  const label = actionLabel(step.action);

  const accentColor = hasError || isFail ? '#FF4444' : isDone ? '#00FF88' : '#00D4FF';
  const borderColor = isLast && !isDone && !isFail ? accentColor : '#333355';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} marginBottom={0}>
      {/* Header: step number + action */}
      <Box flexDirection="row">
        <Text dimColor>#{String(step.index).padStart(3, '0')}</Text>
        <Text color={accentColor}>
          {' '}
          {icon} {label}
        </Text>
      </Box>

      {/* Thinking bubble */}
      {hasThought && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text color="#FF00FF" dimColor>
            thinking:
          </Text>
          <Box marginLeft={1}>
            <Text color="#CC88FF" italic>
              {wrapText(step.thought!, CHAT_WIDTH - 8)}
            </Text>
          </Box>
        </Box>
      )}

      {/* Result */}
      {hasResult && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text color="#8888AA" dimColor>
            result:
          </Text>
          <Box marginLeft={1}>
            <Text color="#AAAACC">{wrapText(step.result!, CHAT_WIDTH - 8)}</Text>
          </Box>
        </Box>
      )}

      {/* Error */}
      {hasError && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text color="#FF4444" dimColor>
            error:
          </Text>
          <Box marginLeft={1}>
            <Text color="#FF6666">{wrapText(step.error!, CHAT_WIDTH - 8)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Text wrapping for terminal ─────────────────────────────────────────────

function wrapText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxWidth) {
      lines.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf(' ', maxWidth);
    if (breakAt <= 0) breakAt = maxWidth;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return lines.join('\n');
}

// ── Input bar at the bottom ────────────────────────────────────────────────

function ChatInput({
  onSubmit,
  onBack,
  taskStatus,
}: {
  onSubmit: (msg: string) => void;
  onBack: () => void;
  taskStatus: string;
}): React.JSX.Element {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && value.trim()) {
      onSubmit(value.trim());
      setValue('');
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (input.length === 1 && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  const canSend = taskStatus === 'running';
  const placeholder = canSend ? 'Type a message...' : `Task is ${taskStatus} — cannot send`;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#FFAA00" paddingX={1}>
      <Box flexDirection="row">
        <Text color="#FFAA00">{'❯ '}</Text>
        <Text color={value ? '#FFFFFF' : '#555577'} italic={!value}>
          {value || placeholder}
        </Text>
        <Text color="#00FF88">█</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>[ENTER] send</Text>
        <Text dimColor>[ESC] back</Text>
        {canSend && <Text dimColor>│ task running</Text>}
      </Box>
    </Box>
  );
}

// ── Main chat view ─────────────────────────────────────────────────────────

type Props = {
  task: Task;
  width: number;
  onSendMessage: (message: string) => void;
  onBack: () => void;
};

export function ChatView({ task, width, onSendMessage, onBack }: Props): React.JSX.Element {
  const steps = task.steps;

  // ── Header ────────────────────────────────────────────────────────────
  const statusColors: Record<string, string> = {
    running: '#00FF88',
    completed: '#00D4FF',
    failed: '#FF4444',
    cancelled: '#FFAA00',
    pending_approval: '#FF00FF',
    approved: '#4488FF',
  };
  const statusColor = statusColors[task.status] ?? '#FFFFFF';

  return (
    <Box flexDirection="column" height="100%">
      {/* Compact task header */}
      <Box flexDirection="column" borderStyle="single" borderColor={statusColor} paddingX={1}>
        <Box flexDirection="row" gap={2}>
          <Text color={statusColor} bold>
            {task.status.toUpperCase()}
          </Text>
          <Text bold>{task.id}</Text>
          <Text dimColor>{task.runner}</Text>
          {task.source && <Text dimColor>via {task.source}</Text>}
          <Text dimColor>
            {steps.length}/{task.maxSteps} steps
          </Text>
        </Box>
        <Box>
          <Text>{truncate(task.prompt, Math.max(40, width - 10))}</Text>
        </Box>
      </Box>

      {/* Conversation area */}
      <Box flexDirection="column" marginTop={1}>
        {/* User prompt as first message */}
        <Box flexDirection="column" borderStyle="round" borderColor="#FFAA00" paddingX={1} marginBottom={0}>
          <Box flexDirection="row">
            <Text dimColor>user</Text>
          </Box>
          <Box marginLeft={1}>
            <Text color="#FFCC44">{wrapText(task.prompt, CHAT_WIDTH - 6)}</Text>
          </Box>
        </Box>

        {/* Agent steps as conversation */}
        {steps.length === 0 ? (
          <Box marginLeft={1} marginTop={1}>
            <Text dimColor italic>
              waiting for agent response...
            </Text>
          </Box>
        ) : (
          steps.map((step, i) => <ChatBubble key={step.index} step={step} isLast={i === steps.length - 1} />)
        )}

        {/* Completion/failure banner */}
        {task.status === 'completed' && task.summary && (
          <Box flexDirection="column" borderStyle="double" borderColor="#00FF88" paddingX={1} marginTop={0}>
            <Text color="#00FF88" bold>
              ◆ COMPLETED
            </Text>
            <Box marginLeft={1}>
              <Text color="#88FFCC">{wrapText(task.summary, CHAT_WIDTH - 6)}</Text>
            </Box>
          </Box>
        )}

        {task.status === 'failed' && task.error && (
          <Box flexDirection="column" borderStyle="double" borderColor="#FF4444" paddingX={1} marginTop={0}>
            <Text color="#FF4444" bold>
              ✖ FAILED
            </Text>
            <Box marginLeft={1}>
              <Text color="#FF8888">{wrapText(task.error, CHAT_WIDTH - 6)}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Input bar */}
      <Box marginTop={1}>
        <ChatInput onSubmit={onSendMessage} onBack={onBack} taskStatus={task.status} />
      </Box>
    </Box>
  );
}
