import { Box, Text } from 'ink';
import React from 'react';

interface InputAreaProps {
  value: string;
  placeholder?: string;
}

export function InputArea({ value, placeholder = 'Type a message...' }: InputAreaProps) {
  const displayValue = value || placeholder;
  const displayColor = value ? 'white' : 'gray';

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Divider line */}
      <Text color="gray">{'─'.repeat(80)}</Text>

      {/* Input row */}
      <Box flexDirection="row" paddingY={0}>
        <Text color="blue" bold>
          {'>'}
        </Text>
        <Box marginLeft={1} flexGrow={1}>
          <Text color={displayColor}>{displayValue}</Text>
          {value && <Text color="blue">{'|'}</Text>}
        </Box>
      </Box>
    </Box>
  );
}
