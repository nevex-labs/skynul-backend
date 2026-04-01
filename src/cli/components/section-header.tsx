import { Box, Text } from 'ink';
import React from 'react';

type Props = {
  label: string;
  color: string;
};

export function SectionHeader({ label, color }: Props): React.JSX.Element {
  return (
    <Box flexDirection="row" marginLeft={1}>
      <Text color={color} bold>
        {'━╋━ '}
      </Text>
      <Text color={color} bold>
        {label}
      </Text>
      <Text dimColor> {'━'.repeat(Math.max(2, 50 - label.length))}</Text>
    </Box>
  );
}
