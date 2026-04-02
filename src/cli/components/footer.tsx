import { Box, Text } from 'ink';
import React from 'react';

export function Footer() {
  return (
    <Box flexDirection="row" paddingX={1} paddingY={1}>
      <Shortcut shortcut="/help" label="help" />
      <Box marginLeft={2}>
        <Shortcut shortcut="Esc" label="exit" />
      </Box>
      <Box marginLeft={2}>
        <Shortcut shortcut="↑↓" label="history" />
      </Box>
    </Box>
  );
}

function Shortcut({ shortcut, label }: { shortcut: string; label: string }) {
  return (
    <Box flexDirection="row">
      <Text color="gray">[</Text>
      <Text color="gray" dimColor>
        {shortcut}
      </Text>
      <Text color="gray">]</Text>
      <Box marginLeft={1}>
        <Text color="gray" dimColor>
          {label}
        </Text>
      </Box>
    </Box>
  );
}
