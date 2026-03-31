import { Box, Text } from 'ink';
import React from 'react';

type Props = {
  running: number;
  completed: number;
  failed: number;
  lastUpdate: Date;
};

export function SummaryBar({ running, completed, failed, lastUpdate }: Props): React.JSX.Element {
  return (
    <Box flexDirection="row" marginLeft={1} gap={3}>
      <Text>
        <Text color="#00FF88" bold>
          {running}
        </Text>
        <Text dimColor> active</Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {completed}
        </Text>
        <Text dimColor> done</Text>
      </Text>
      {failed > 0 && (
        <Text>
          <Text color="#FF4444" bold>
            {failed}
          </Text>
          <Text dimColor> failed</Text>
        </Text>
      )}
      <Text dimColor>─ synced {lastUpdate.toLocaleTimeString()}</Text>
    </Box>
  );
}
