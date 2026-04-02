import { Box, Text } from 'ink';
import React from 'react';

export interface Task {
  id: string;
  title: string;
  content: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  createdAt: Date;
  updatedAt: Date;
}

interface TaskViewProps {
  task: Task;
}

export function TaskView({ task }: TaskViewProps) {
  const statusColor = {
    pending: 'yellow',
    running: 'blue',
    completed: 'green',
    error: 'red',
  }[task.status];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={2} paddingY={1}>
        <Text bold color="white">
          {task.title}
        </Text>
      </Box>

      <Box paddingX={2}>
        <Box flexDirection="row" paddingX={1}>
          <Text color={statusColor}>{task.status.toUpperCase()}</Text>
        </Box>
      </Box>

      <Box paddingX={1} paddingY={1}>
        <Text color="gray">{'─'.repeat(80)}</Text>
      </Box>

      <Box flexGrow={1} paddingX={2}>
        <Text color="gray" dimColor>
          {task.content}
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="gray">Progress</Text>
        <Box marginTop={1}>
          <Text color="blue">
            {'█'.repeat(3)}
            {'░'.repeat(17)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
