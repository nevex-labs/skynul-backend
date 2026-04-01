import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import type { PolicyInfo } from '../use-skynul-data.js';

const PROVIDERS = [
  'chatgpt',
  'claude',
  'deepseek',
  'kimi',
  'glm',
  'minimax',
  'openrouter',
  'gemini',
  'ollama',
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: 'OpenAI (ChatGPT)',
  claude: 'Anthropic (Claude)',
  deepseek: 'DeepSeek',
  kimi: 'Moonshot (Kimi)',
  glm: 'Zhipu (GLM)',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  gemini: 'Google (Gemini)',
  ollama: 'Ollama (local)',
};

type Props = {
  policy: PolicyInfo | null;
  onSelectProvider: (provider: string) => void;
  onSelectModel: (model: string) => void;
  onBack: () => void;
};

export function ProviderPanel({ policy, onSelectProvider, onSelectModel, onBack }: Props): React.JSX.Element {
  const [mode, setMode] = useState<'providers' | 'models'>('providers');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const activeProvider = policy?.provider.active ?? 'chatgpt';
  const activeModel = policy?.provider.openaiModel ?? 'gpt-4.1-mini';

  const models: Record<string, string[]> = {
    chatgpt: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    claude: ['claude-opus-4', 'claude-sonnet-4', 'claude-sonnet-3.7', 'claude-haiku-3.5'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    kimi: ['kimi-latest', 'kimi-thinking'],
    glm: ['glm-4-plus', 'glm-4-flash'],
    minimax: ['MiniMax-Text-01'],
    openrouter: ['openrouter/auto'],
    gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    ollama: ['llama3.2', 'qwen2.5', 'mistral', 'phi4'],
  };

  const items = mode === 'providers' ? [...PROVIDERS] : (models[activeProvider] ?? []);

  useInput((input, key) => {
    if (key.escape || input === 'b') {
      if (mode === 'models') {
        setMode('providers');
        setSelectedIdx(0);
      } else {
        onBack();
      }
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIdx((prev) => Math.min(prev + 1, items.length - 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (key.return) {
      if (mode === 'providers') {
        const provider = items[selectedIdx] as string;
        onSelectProvider(provider);
        setMode('models');
        setSelectedIdx(0);
      } else {
        const model = items[selectedIdx] as string;
        onSelectModel(model);
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#FF00FF" paddingX={1}>
      <Box flexDirection="row" gap={2}>
        <Text bold color="#FF00FF">
          {mode === 'providers' ? 'PROVIDERS' : `MODELS (${activeProvider})`}
        </Text>
        <Text dimColor>
          active: <Text color="#00FF88">{activeProvider}</Text> / <Text color="#00D4FF">{activeModel}</Text>
        </Text>
      </Box>

      <Box flexDirection="column">
        {items.map((item, idx) => {
          const isSelected = idx === selectedIdx;
          const isActive = mode === 'providers' ? item === activeProvider : item === activeModel;
          const prefix = isSelected ? '▸ ' : '  ';
          const label = mode === 'providers' ? (PROVIDER_LABELS[item] ?? item) : item;
          const suffix = isActive ? ' ◆' : '';

          return (
            <Box key={item} flexDirection="row">
              <Text color={isSelected ? '#FFFFFF' : undefined}>{prefix}</Text>
              <Text color={isActive ? '#00FF88' : isSelected ? '#FFFFFF' : '#AAAAAA'} bold={isActive}>
                {label}
                {suffix}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="row" gap={2} marginTop={0}>
        <Text dimColor>[↑/↓/JK] navigate</Text>
        <Text dimColor>[ENTER] select</Text>
        <Text dimColor>[ESC/B] back</Text>
      </Box>
    </Box>
  );
}
