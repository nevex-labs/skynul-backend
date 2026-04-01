import { Box, Text } from 'ink';
import React from 'react';
import type { ChannelSettings } from '../../types/channel.js';
import { formatMB, meterBar, meterColor } from '../utils.js';
import { BoxPanel } from './box-panel.js';

type Stats = {
  app: { cpuPercent: number; memoryMB: number };
  system: { freeMemMB: number };
};

type Props = {
  stats: Stats | null;
  channels: ChannelSettings[];
  wsConnected: boolean;
  pollInterval: number;
};

const CHANNEL_ICONS: Record<string, string> = {
  connected: '▣',
  connecting: '◧',
  disconnected: '▢',
  error: '✖',
};

const CHANNEL_COLORS: Record<string, string> = {
  connected: '#00FF88',
  connecting: '#FFAA00',
  disconnected: '#555577',
  error: '#FF4444',
};

function SystemPanel({ stats }: { stats: Stats | null }): React.JSX.Element {
  return (
    <BoxPanel title="SYS" color="#00D4FF">
      {stats ? (
        <>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>CPU </Text>
            <Text color={meterColor(stats.app.cpuPercent / 100)}>{meterBar(stats.app.cpuPercent, 100, 12)}</Text>
            <Text color="#00D4FF"> {stats.app.cpuPercent.toFixed(1)}%</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>HEAP </Text>
            <Text color={meterColor(stats.app.memoryMB / 512)}>{meterBar(stats.app.memoryMB, 512, 12)}</Text>
            <Text color="#00D4FF"> {formatMB(stats.app.memoryMB)}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>FREE </Text>
            <Text color="#00FF88">{meterBar(stats.system.freeMemMB, 8192, 12)}</Text>
            <Text color="#00D4FF"> {formatMB(stats.system.freeMemMB)}</Text>
          </Box>
        </>
      ) : (
        <Text dimColor> ▸ loading...</Text>
      )}
    </BoxPanel>
  );
}

function ChannelsPanel({ channels }: { channels: ChannelSettings[] }): React.JSX.Element {
  return (
    <BoxPanel title="CHANNELS" color="#FF00FF">
      {channels.length === 0 ? (
        <Text dimColor> no channels</Text>
      ) : (
        channels.map((ch) => {
          const icon = CHANNEL_ICONS[ch.status] ?? '?';
          const color = CHANNEL_COLORS[ch.status] ?? '#FFFFFF';
          return (
            <Box key={ch.id} flexDirection="row">
              <Text color={color}>{icon}</Text>
              <Text color={color}> {ch.id.toUpperCase().padEnd(9)}</Text>
              {ch.error && <Text color="#FF4444"> ⚠</Text>}
            </Box>
          );
        })
      )}
    </BoxPanel>
  );
}

function LinkPanel({
  wsConnected,
  pollInterval,
}: {
  wsConnected: boolean;
  pollInterval: number;
}): React.JSX.Element {
  return (
    <BoxPanel title="LINK" color={wsConnected ? '#00FF88' : '#FF4444'}>
      <Box flexDirection="row">
        <Text color={wsConnected ? '#00FF88' : '#FF4444'} bold>
          {wsConnected ? '▣ LIVE' : '▢ DOWN'}
        </Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor>POLL </Text>
        <Text color="#00D4FF">{pollInterval / 1000}s</Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor>MODE </Text>
        <Text color="#FF00FF">WS+HTTP</Text>
      </Box>
    </BoxPanel>
  );
}

export function SystemStats({ stats, channels, wsConnected, pollInterval }: Props): React.JSX.Element {
  return (
    <Box flexDirection="row" gap={1}>
      <SystemPanel stats={stats} />
      <ChannelsPanel channels={channels} />
      <LinkPanel wsConnected={wsConnected} pollInterval={pollInterval} />
    </Box>
  );
}
