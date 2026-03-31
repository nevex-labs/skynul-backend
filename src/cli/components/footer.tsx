import { Box, Text } from 'ink';
import React from 'react';

type Props = {
  activeView: string;
};

export function Footer({ activeView }: Props): React.JSX.Element {
  const isActive = (v: string) => activeView === v;
  const isModal = activeView === 'create' || activeView === 'providers' || activeView === 'message';

  return (
    <Box flexDirection="column" marginLeft={1} marginTop={1}>
      <Text dimColor>{'─'.repeat(68)}</Text>

      {/* Navigation row */}
      <Box flexDirection="row" gap={2}>
        <Text color={isActive('dashboard') ? '#00FF88' : '#555577'} bold={isActive('dashboard')}>
          [1] ALL
        </Text>
        <Text color={isActive('tasks') ? '#00FF88' : '#555577'} bold={isActive('tasks')}>
          [2] MISSIONS
        </Text>
        <Text color={isActive('stats') ? '#00FF88' : '#555577'} bold={isActive('stats')}>
          [3] SYSTEM
        </Text>
        <Text color={isActive('logs') ? '#00FF88' : '#555577'} bold={isActive('logs')}>
          [4] LOGS
        </Text>
      </Box>

      {/* Actions row */}
      <Box flexDirection="row" gap={2}>
        <Text color="#00FF88">[N]</Text>
        <Text dimColor>NEW</Text>
        <Text color="#FF00FF">[P]</Text>
        <Text dimColor>PROVIDER</Text>
        <Text color="#FFAA00">[M]</Text>
        <Text dimColor>MSG</Text>
        <Text color="#FF4444">[D]</Text>
        <Text dimColor>DELETE</Text>
        <Text color="#FFAA00">[C]</Text>
        <Text dimColor>CANCEL</Text>
        <Text dimColor>{' │ '}</Text>
        <Text color="#FF00FF">[↑↓/JK]</Text>
        <Text dimColor>NAV</Text>
        <Text color="#00D4FF">[ENTER]</Text>
        <Text dimColor>DETAIL</Text>
      </Box>

      {/* System row */}
      <Box flexDirection="row" gap={2}>
        <Text color="#FF00FF">[R]</Text>
        <Text dimColor>SYNC</Text>
        {isModal || isActive('detail') ? (
          <>
            <Text color="#00D4FF">[ESC/B]</Text>
            <Text dimColor>BACK</Text>
          </>
        ) : null}
        <Text color="#FF4444">[Q]</Text>
        <Text dimColor>EXIT</Text>
      </Box>
    </Box>
  );
}
