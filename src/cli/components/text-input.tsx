import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

type Props = {
  label: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  color?: string;
};

export function TextInput({ label, placeholder, onSubmit, onCancel, color = '#00D4FF' }: Props): React.JSX.Element {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }
    if (input.length === 1 && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  const display = value || placeholder || '';
  const isEmpty = !value;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      <Text bold color={color}>
        {label}
      </Text>
      <Box flexDirection="row">
        <Text color="#FF00FF">{'❯ '}</Text>
        <Text color={isEmpty ? '#555577' : '#FFFFFF'} italic={isEmpty}>
          {display}
        </Text>
        <Text color="#00FF88">█</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>[ENTER] submit</Text>
        <Text dimColor>[ESC] cancel</Text>
      </Box>
    </Box>
  );
}
