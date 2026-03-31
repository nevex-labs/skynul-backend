import { Box, Text, useApp, useInput } from 'ink';
import React, { useState, useEffect, useCallback } from 'react';
import type { TaskMode } from '../../types/task.js';
import { SkynulClient } from '../api-client.js';
import { useSkynulData } from '../use-skynul-data.js';
import { ErrorBanner } from './error-banner.js';
import { Footer } from './footer.js';
import { Header } from './header.js';
import { LogStream } from './log-stream.js';
import { ProviderPanel } from './provider-panel.js';
import { SectionHeader } from './section-header.js';
import { SummaryBar } from './summary-bar.js';
import { SystemStats } from './system-stats.js';
import { TaskCreator } from './task-creator.js';
import { TaskDetail } from './task-detail.js';
import { TaskList } from './task-list.js';
import { TextInput } from './text-input.js';

type View = 'dashboard' | 'tasks' | 'stats' | 'detail' | 'logs' | 'create' | 'providers' | 'message';

type Props = {
  client: SkynulClient;
  pollMs: number;
};

export function Dashboard({ client, pollMs }: Props): React.JSX.Element {
  const { exit } = useApp();
  const data = useSkynulData(client, pollMs);
  const [view, setView] = useState<View>('dashboard');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [termWidth, setTermWidth] = useState(process.stdout.columns ?? 80);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setTermWidth(process.stdout.columns ?? 80);
    process.stdout.on('resize', handler);
    return () => {
      process.stdout.off('resize', handler);
    };
  }, []);

  // Auto-clear status messages
  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 4000);
    return () => clearTimeout(t);
  }, [statusMsg]);

  const runningTasks = data.tasks.filter((t) => t.status === 'running');
  const runningCount = runningTasks.length;
  const completedCount = data.tasks.filter((t) => t.status === 'completed').length;
  const failedCount = data.tasks.filter((t) => t.status === 'failed').length;
  const selectedTask = data.tasks[selectedIdx];

  // ── Action handlers ─────────────────────────────────────────────────

  const handleCreateTask = useCallback(
    async (prompt: string, mode: TaskMode) => {
      try {
        const task = await data.createTask({ prompt, mode, source: 'desktop' });
        setStatusMsg(`◆ Task created: ${task.id}`);
        setView('tasks');
        setSelectedIdx(0);
      } catch (err: unknown) {
        setStatusMsg(`✖ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [data]
  );

  const handleSelectProvider = useCallback(
    async (provider: string) => {
      try {
        await data.setProvider(provider);
        setStatusMsg(`◆ Provider set to ${provider}`);
      } catch (err: unknown) {
        setStatusMsg(`✖ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [data]
  );

  const handleSelectModel = useCallback(
    async (model: string) => {
      try {
        await data.setModel(model);
        setStatusMsg(`◆ Model set to ${model}`);
      } catch (err: unknown) {
        setStatusMsg(`✖ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [data]
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!selectedTask) return;
      try {
        await data.sendMessage(selectedTask.id, message);
        setStatusMsg(`◆ Message sent to ${selectedTask.id}`);
        setView('detail');
      } catch (err: unknown) {
        setStatusMsg(`✖ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [data, selectedTask]
  );

  const handleDeleteTask = useCallback(async () => {
    if (!selectedTask) return;
    if (selectedTask.status === 'running') {
      setStatusMsg('✖ Cannot delete running task. Cancel it first.');
      return;
    }
    try {
      await data.deleteTask(selectedTask.id);
      setStatusMsg(`◆ Task deleted: ${selectedTask.id}`);
      setSelectedIdx(Math.max(0, selectedIdx - 1));
    } catch (err: unknown) {
      setStatusMsg(`✖ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [data, selectedTask, selectedIdx]);

  // ── Keyboard input ──────────────────────────────────────────────────

  useInput((input, key) => {
    // Always allow quit
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    // Modal views: let their own useInput handle keys
    if (view === 'create' || view === 'providers' || view === 'message') return;

    // Detail view: only escape/back
    if (view === 'detail') {
      if (key.escape || input === 'b') {
        setView('tasks');
        return;
      }
      return;
    }

    // ── View switching ──────────────────────────────────────────────
    if (input === '1') {
      setView('dashboard');
      return;
    }
    if (input === '2') {
      setView('tasks');
      return;
    }
    if (input === '3') {
      setView('stats');
      return;
    }
    if (input === '4') {
      setView('logs');
      return;
    }
    if (input === 'r') {
      data.refresh();
      setStatusMsg('◆ Synced');
      return;
    }

    // ── Task navigation (dashboard + tasks view) ────────────────────
    if (view === 'tasks' || view === 'dashboard') {
      if (key.downArrow || input === 'j') {
        setSelectedIdx((prev) => Math.min(prev + 1, data.tasks.length - 1));
        return;
      }
      if (key.upArrow || input === 'k') {
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (key.return && selectedTask) {
        setView('detail');
        return;
      }
      if (input === 'c' && selectedTask && selectedTask.status === 'running') {
        data.cancelTask(selectedTask.id).catch(() => {});
        setStatusMsg(`◆ Cancelled ${selectedTask.id}`);
        return;
      }
      if (input === 'd' && selectedTask) {
        handleDeleteTask();
        return;
      }
    }

    // ── Global action keys ──────────────────────────────────────────
    if (input === 'n') {
      setView('create');
      return;
    }
    if (input === 'p') {
      setView('providers');
      return;
    }
    if (input === 'm' && selectedTask && selectedTask.status === 'running') {
      setView('message');
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Header taskCount={data.tasks.length} wsConnected={data.wsConnected} />

      <SummaryBar running={runningCount} completed={completedCount} failed={failedCount} lastUpdate={data.lastUpdate} />

      {/* Status message */}
      {statusMsg && (
        <Box marginLeft={1}>
          <Text color={statusMsg.startsWith('✖') ? '#FF4444' : '#00FF88'}>{statusMsg}</Text>
        </Box>
      )}

      {data.error && <ErrorBanner message={data.error} />}

      {/* ── Modal views ──────────────────────────────────────────────── */}

      {view === 'create' && (
        <Box flexDirection="column" marginTop={1}>
          <SectionHeader label="NEW MISSION" color="#00FF88" />
          <TaskCreator onSubmit={handleCreateTask} onCancel={() => setView('tasks')} />
        </Box>
      )}

      {view === 'providers' && (
        <Box flexDirection="column" marginTop={1}>
          <SectionHeader label="PROVIDER" color="#FF00FF" />
          <ProviderPanel
            policy={data.policy}
            onSelectProvider={handleSelectProvider}
            onSelectModel={handleSelectModel}
            onBack={() => setView('dashboard')}
          />
        </Box>
      )}

      {view === 'message' && selectedTask && (
        <Box flexDirection="column" marginTop={1}>
          <SectionHeader label={`MSG → ${selectedTask.id}`} color="#FFAA00" />
          <TextInput
            label="SEND MESSAGE"
            placeholder="Type your message to the running task..."
            onSubmit={handleSendMessage}
            onCancel={() => setView('detail')}
            color="#FFAA00"
          />
        </Box>
      )}

      {/* ── Detail view ──────────────────────────────────────────────── */}

      {view === 'detail' && selectedTask ? (
        <Box flexDirection="column" marginTop={1}>
          <SectionHeader label={`TASK ${selectedTask.id}`} color="#FF00FF" />
          <TaskDetail task={selectedTask} width={termWidth} />
        </Box>
      ) : view === 'logs' ? (
        <Box flexDirection="column" marginTop={1}>
          <SectionHeader label="AGENT LOG" color="#00FF88" />
          <LogStream tasks={data.tasks} width={termWidth} />
        </Box>
      ) : view !== 'create' && view !== 'providers' && view !== 'message' ? (
        <>
          {(view === 'dashboard' || view === 'tasks') && (
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" marginLeft={1}>
                <Text bold color="#00FF88">
                  {'━╋━ '}
                </Text>
                <Text bold color="#00FF88">
                  MISSIONS
                </Text>
                {selectedTask && <Text dimColor> ─ selected: {selectedTask.id}</Text>}
                {data.policy && (
                  <Text dimColor>
                    {' '}
                    │ provider: <Text color="#FF00FF">{data.policy.provider.active}</Text>/
                    <Text color="#00D4FF">{data.policy.provider.openaiModel}</Text>
                  </Text>
                )}
                <Text dimColor> {'━'.repeat(Math.max(2, 20))}</Text>
              </Box>
              <TaskList tasks={data.tasks} width={termWidth} selectedIndex={selectedIdx} />
            </Box>
          )}

          {(view === 'dashboard' || view === 'stats') && (
            <Box flexDirection="column" marginTop={1}>
              <SectionHeader label="TELEMETRY" color="#00D4FF" />
              <SystemStats
                stats={data.stats}
                channels={data.channels}
                wsConnected={data.wsConnected}
                pollInterval={pollMs}
              />
            </Box>
          )}
        </>
      ) : null}

      <Footer activeView={view} />
    </Box>
  );
}
