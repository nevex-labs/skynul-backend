import { Box, Text } from 'ink';
import React from 'react';

export function StopTaskModal({
  taskTitle,
  error,
  isLoading,
}: {
  taskTitle: string;
  error: string | null;
  isLoading: boolean;
}) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={2} paddingY={1}>
      <Text bold>Detener tarea</Text>
      <Box marginTop={1}>
        <Text dimColor>{taskTitle}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Se va a parar la tarea.</Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{isLoading ? 'Deteniendo…' : '[Enter/Y] confirmar  [N/Esc] cancelar'}</Text>
      </Box>
    </Box>
  );
}
