import { Box, Text } from 'ink';
import React from 'react';
import type { Task } from '../../types/task.js';

type Props = {
  tasks: Task[];
  width: number;
};

function actionSummary(task: Task): string {
  if (task.steps.length === 0) return 'idle';
  const last = task.steps[task.steps.length - 1]!;
  const action = last.action;
  const truncated = JSON.stringify(action).slice(0, 60);
  return `${action.type}: ${truncated}`;
}

export function LogStream({ tasks, width }: Props): React.JSX.Element {
  const running = tasks.filter((t) => t.status === 'running');

  if (running.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#333355" paddingX={1}>
        <Text bold color="#555577">
          AGENT LOG
        </Text>
        <Text dimColor> no active agents</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#00FF88" paddingX={1}>
      <Text bold color="#00FF88">
        AGENT LOG
      </Text>
      {running.map((task) => {
        const lastStep = task.steps[task.steps.length - 1];
        const thought = lastStep?.thought?.slice(0, Math.min(width - 10, 80));

        return (
          <Box key={task.id} flexDirection="column" marginTop={0}>
            <Box flexDirection="row">
              <Text color="#00D4FF">▸ {task.id} </Text>
              <Text dimColor>
                {task.runner} step {task.steps.length}/{task.maxSteps}
              </Text>
            </Box>
            {lastStep && (
              <>
                <Box marginLeft={2}>
                  <Text dimColor>action: </Text>
                  <Text color="#FFAA00">{lastStep.action.type}</Text>
                </Box>
                {thought && (
                  <Box marginLeft={2}>
                    <Text color="#FF00FF" italic>
                      💭 {thought}
                    </Text>
                  </Box>
                )}
                {lastStep.error && (
                  <Box marginLeft={2}>
                    <Text color="#FF4444">✖ {lastStep.error.slice(0, 60)}</Text>
                  </Box>
                )}
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
