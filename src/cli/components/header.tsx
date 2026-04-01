import { Box, Text } from 'ink';
import React from 'react';

type Props = {
  taskCount: number;
  wsConnected: boolean;
};

export function Header({ taskCount, wsConnected }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color="#00D4FF" bold>
          {' ╔══════════════════════════════════════════════════════════╗'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#00FF88" bold>
          {'  ███████╗██╗  ██╗██╗   ██╗███╗   ██╗██╗   ██╗██╗     '}
        </Text>
        <Text color="#00D4FF" bold>
          {'║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#00FF88" bold>
          {'  ██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██║   ██║██║     '}
        </Text>
        <Text color="#00D4FF" bold>
          {'║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#00FF88" bold>
          {'  ███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║██║   ██║██║     '}
        </Text>
        <Text color="#00D4FF" bold>
          {'║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#00FF88" bold>
          {'  ╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██║   ██║██║     '}
        </Text>
        <Text color="#00D4FF" bold>
          {'║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#00FF88" bold>
          {'  ███████║██║  ██╗   ██║   ██║ ╚████║╚██████╔╝███████╗'}
        </Text>
        <Text color="#00D4FF" bold>
          {'║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#00FF88" bold>
          {'  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝'}
        </Text>
        <Text color="#00D4FF" bold>
          {'║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ╠══════════════════════════════════════════════════════════╣'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ║'}
        </Text>
        <Text color="#FF00FF"> {'◆'}</Text>
        <Text> DEVTOOLS</Text>
        <Text dimColor> ── autonomous agent monitoring ──</Text>
        <Text color={wsConnected ? '#00FF88' : '#FF4444'}> {wsConnected ? '▣' : '▢'}</Text>
        <Text dimColor> {taskCount} missions</Text>
        <Text color="#00D4FF" bold>
          {'                                    ║'}
        </Text>
      </Text>
      <Text>
        <Text color="#00D4FF" bold>
          {' ╚══════════════════════════════════════════════════════════╝'}
        </Text>
      </Text>
    </Box>
  );
}
