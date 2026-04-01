import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { TextInput } from './text-input.js';

type TaskMode = 'browser' | 'code';

type Props = {
  onSubmit: (prompt: string, mode: TaskMode) => void;
  onCancel: () => void;
};

export function TaskCreator({ onSubmit, onCancel }: Props): React.JSX.Element {
  const [step, setStep] = useState<'prompt' | 'mode'>('prompt');
  const [prompt, setPrompt] = useState('');
  const [modeIdx, setModeIdx] = useState(0);

  const modes: { value: TaskMode; label: string; desc: string }[] = [
    { value: 'browser', label: 'BROWSER', desc: 'Control Chrome via Playwright (CDP)' },
    { value: 'code', label: 'CODE', desc: 'File operations, shell commands, scripting' },
  ];

  const handlePromptSubmit = (value: string) => {
    if (!value.trim()) return;
    setPrompt(value.trim());
    setStep('mode');
  };

  useInput((input, key) => {
    if (step !== 'mode') return;

    if (key.escape || input === 'b') {
      setStep('prompt');
      return;
    }
    if (key.downArrow || input === 'j') {
      setModeIdx((prev) => Math.min(prev + 1, modes.length - 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setModeIdx((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (key.return) {
      onSubmit(prompt, modes[modeIdx]!.value);
      return;
    }
  });

  if (step === 'prompt') {
    return (
      <TextInput
        label="NEW MISSION"
        placeholder="Describe what you want the agent to do..."
        onSubmit={handlePromptSubmit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#00FF88" paddingX={1}>
      <Text bold color="#00FF88">
        SELECT MODE
      </Text>
      <Box marginLeft={1} marginBottom={1}>
        <Text dimColor>Prompt: </Text>
        <Text>
          {prompt.slice(0, 60)}
          {prompt.length > 60 ? '…' : ''}
        </Text>
      </Box>

      <Box flexDirection="column">
        {modes.map((m, idx) => {
          const isSelected = idx === modeIdx;
          return (
            <Box key={m.value} flexDirection="row">
              <Text color={isSelected ? '#FFFFFF' : undefined}>{isSelected ? '▸ ' : '  '}</Text>
              <Text color={isSelected ? '#00FF88' : '#AAAAAA'} bold={isSelected}>
                {m.label}
              </Text>
              <Text dimColor> — {m.desc}</Text>
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="row" gap={2} marginTop={0}>
        <Text dimColor>[↑/↓/JK] navigate</Text>
        <Text dimColor>[ENTER] launch</Text>
        <Text dimColor>[ESC/B] back</Text>
      </Box>
    </Box>
  );
}
