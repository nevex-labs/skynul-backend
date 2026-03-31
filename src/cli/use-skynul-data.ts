import { useCallback, useEffect, useState } from 'react';
import type { ChannelSettings } from '../types/channel.js';
import type { Task, TaskCreateRequest } from '../types/task.js';
import { SkynulClient } from './api-client.js';
import { WsClient } from './ws-client.js';

export type RuntimeStats = {
  app: { cpuPercent: number; memoryMB: number };
  system: { freeMemMB: number };
};

export type PolicyInfo = {
  provider: { active: string; openaiModel: string };
  taskAutoApprove: boolean;
  paperTradingEnabled: boolean;
};

export type SkynulData = {
  tasks: Task[];
  channels: ChannelSettings[];
  stats: RuntimeStats | null;
  policy: PolicyInfo | null;
  wsConnected: boolean;
  error: string | null;
  lastUpdate: Date;
  refresh: () => void;
  cancelTask: (id: string) => Promise<void>;
  createTask: (req: TaskCreateRequest) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  sendMessage: (id: string, message: string) => Promise<void>;
  setProvider: (active: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
};

export function useSkynulData(client: SkynulClient, pollMs: number): SkynulData {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [channels, setChannels] = useState<ChannelSettings[]>([]);
  const [stats, setStats] = useState<RuntimeStats | null>(null);
  const [policy, setPolicy] = useState<PolicyInfo | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // ── WS updates ──────────────────────────────────────────────────────────

  useEffect(() => {
    const ws = new WsClient(client.wsUrl());

    ws.on((event) => {
      if (event.type === 'task:update') {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === event.payload.task.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = event.payload.task;
            return next;
          }
          return [event.payload.task, ...prev];
        });
        setLastUpdate(new Date());
      }
    });

    const checkConnected = setInterval(() => setWsConnected(ws.connected), 1000);
    ws.connect();
    return () => {
      clearInterval(checkConnected);
      ws.disconnect();
    };
  }, [client]);

  // ── Polling ──────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [taskList, channelList] = await Promise.all([client.listTasks(), client.listChannels()]);
      setTasks(taskList);
      setChannels(channelList);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [client]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await client.runtimeStats();
      setStats(data);
    } catch {
      /* not critical */
    }
  }, [client]);

  const fetchPolicy = useCallback(async () => {
    try {
      const data = await client.getPolicy();
      setPolicy(data);
    } catch {
      /* not critical */
    }
  }, [client]);

  useEffect(() => {
    fetchData();
    fetchStats();
    fetchPolicy();
    const poll = setInterval(fetchData, pollMs);
    const statsPoll = setInterval(fetchStats, pollMs * 3);
    const policyPoll = setInterval(fetchPolicy, pollMs * 5);
    return () => {
      clearInterval(poll);
      clearInterval(statsPoll);
      clearInterval(policyPoll);
    };
  }, [fetchData, fetchStats, fetchPolicy, pollMs]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    fetchData();
    fetchStats();
    fetchPolicy();
  }, [fetchData, fetchStats, fetchPolicy]);

  const cancelTask = useCallback(
    async (id: string) => {
      await client.cancelTask(id);
      await fetchData();
    },
    [client, fetchData]
  );

  const createTask = useCallback(
    async (req: TaskCreateRequest) => {
      const task = await client.createTask(req);
      await fetchData();
      return task;
    },
    [client, fetchData]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      await client.deleteTask(id);
      await fetchData();
    },
    [client, fetchData]
  );

  const sendMessage = useCallback(
    async (id: string, message: string) => {
      await client.sendMessage(id, message);
    },
    [client]
  );

  const setProvider = useCallback(
    async (active: string) => {
      await client.setProvider(active);
      await fetchPolicy();
    },
    [client, fetchPolicy]
  );

  const setModel = useCallback(
    async (model: string) => {
      await client.setModel(model);
      await fetchPolicy();
    },
    [client, fetchPolicy]
  );

  return {
    tasks,
    channels,
    stats,
    policy,
    wsConnected,
    error,
    lastUpdate,
    refresh,
    cancelTask,
    createTask,
    deleteTask,
    sendMessage,
    setProvider,
    setModel,
  };
}
