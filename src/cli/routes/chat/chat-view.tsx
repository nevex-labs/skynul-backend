import { Box, Text } from 'ink';
import React from 'react';
import { Footer } from '../../components/footer.js';
import { Hero } from '../../components/hero.js';
import { InputArea } from '../../components/input-area.js';

export interface ChatViewProps {
  input: string;
  isLoading: boolean;
  error: string | null;
}

export function ChatView({ input, isLoading, error }: ChatViewProps) {
  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column">
        <Hero />
        {error ? (
          <Box paddingX={2} marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        ) : null}
        {isLoading ? (
          <Box paddingX={2} marginTop={1}>
            <Text color="gray" dimColor>
              Creando tarea…
            </Text>
          </Box>
        ) : null}
      </Box>

      <Box marginTop={1}>
        <InputArea value={input} />
      </Box>
      <Footer />
    </Box>
  );
}
