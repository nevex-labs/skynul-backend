import { Box, Text } from 'ink';
import React from 'react';

type Props = {
  message: string;
};

export function ErrorBanner({ message }: Props): React.JSX.Element {
  return (
    <Box marginLeft={1} marginRight={1} borderStyle="single" borderColor="#FF4444" paddingX={1}>
      <Text color="#FF4444" bold>
        ✖ LINK DOWN
      </Text>
      <Text dimColor> ─ </Text>
      <Text color="#FF8888">{message}</Text>
    </Box>
  );
}
