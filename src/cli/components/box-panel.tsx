import { Box, Text } from 'ink';
import React from 'react';

type Props = {
  title: string;
  color: string;
  children: React.ReactNode;
};

export function BoxPanel({ title, color, children }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1} paddingY={0}>
      <Box marginBottom={0}>
        <Text bold color={color}>
          {title}
        </Text>
      </Box>
      {children}
    </Box>
  );
}
