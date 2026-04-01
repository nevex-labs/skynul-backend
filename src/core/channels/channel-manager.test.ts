import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskManager } from '../agent/task-manager';
import { ChannelManager } from './channel-manager';

const {
  mockWriteFile,
  mockMkdir,
  mockReadFile,
  mockTelegramStart,
  mockTelegramStop,
  mockTelegramSettings,
  mockTelegramSetCM,
  mockWhatsappStart,
  mockWhatsappStop,
  mockWhatsappSettings,
  mockWhatsappSetCM,
  mockDiscordStart,
  mockDiscordStop,
  mockDiscordSettings,
  mockDiscordSetCM,
  mockSignalStart,
  mockSignalStop,
  mockSignalSettings,
  mockSignalSetCM,
  mockSlackStart,
  mockSlackStop,
  mockSlackSettings,
  mockSlackSetCM,
} = vi.hoisted(() => {
  return {
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockReadFile: vi.fn().mockRejectedValue(new Error('not found')),
    mockTelegramStart: vi.fn().mockResolvedValue(undefined),
    mockTelegramStop: vi.fn().mockResolvedValue(undefined),
    mockTelegramSettings: vi.fn(() => ({
      id: 'telegram',
      enabled: false,
      status: 'disconnected',
      paired: false,
      pairingCode: null,
      error: null,
      hasCredentials: false,
      meta: {},
    })),
    mockTelegramSetCM: vi.fn(),
    mockWhatsappStart: vi.fn().mockResolvedValue(undefined),
    mockWhatsappStop: vi.fn().mockResolvedValue(undefined),
    mockWhatsappSettings: vi.fn(() => ({
      id: 'whatsapp',
      enabled: false,
      status: 'disconnected',
      paired: false,
      pairingCode: null,
      error: null,
      hasCredentials: false,
      meta: {},
    })),
    mockWhatsappSetCM: vi.fn(),
    mockDiscordStart: vi.fn().mockResolvedValue(undefined),
    mockDiscordStop: vi.fn().mockResolvedValue(undefined),
    mockDiscordSettings: vi.fn(() => ({
      id: 'discord',
      enabled: false,
      status: 'disconnected',
      paired: false,
      pairingCode: null,
      error: null,
      hasCredentials: false,
      meta: {},
    })),
    mockDiscordSetCM: vi.fn(),
    mockSignalStart: vi.fn().mockResolvedValue(undefined),
    mockSignalStop: vi.fn().mockResolvedValue(undefined),
    mockSignalSettings: vi.fn(() => ({
      id: 'signal',
      enabled: false,
      status: 'disconnected',
      paired: false,
      pairingCode: null,
      error: null,
      hasCredentials: false,
      meta: {},
    })),
    mockSignalSetCM: vi.fn(),
    mockSlackStart: vi.fn().mockResolvedValue(undefined),
    mockSlackStop: vi.fn().mockResolvedValue(undefined),
    mockSlackSettings: vi.fn(() => ({
      id: 'slack',
      enabled: false,
      status: 'disconnected',
      paired: false,
      pairingCode: null,
      error: null,
      hasCredentials: false,
      meta: {},
    })),
    mockSlackSetCM: vi.fn(),
  };
});

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('../config', () => ({
  getDataDir: vi.fn(() => '/tmp/test-data'),
}));

vi.mock('./telegram-channel', () => ({
  TelegramChannel: class {
    readonly id = 'telegram';
    start = mockTelegramStart;
    stop = mockTelegramStop;
    getSettings = mockTelegramSettings;
    setChannelManager = mockTelegramSetCM;
    constructor(_: unknown) {}
  },
}));
vi.mock('./whatsapp-channel', () => ({
  WhatsAppChannel: class {
    readonly id = 'whatsapp';
    start = mockWhatsappStart;
    stop = mockWhatsappStop;
    getSettings = mockWhatsappSettings;
    setChannelManager = mockWhatsappSetCM;
    constructor(_: unknown) {}
  },
}));
vi.mock('./discord-channel', () => ({
  DiscordChannel: class {
    readonly id = 'discord';
    start = mockDiscordStart;
    stop = mockDiscordStop;
    getSettings = mockDiscordSettings;
    setChannelManager = mockDiscordSetCM;
    constructor(_: unknown) {}
  },
}));
vi.mock('./signal-channel', () => ({
  SignalChannel: class {
    readonly id = 'signal';
    start = mockSignalStart;
    stop = mockSignalStop;
    getSettings = mockSignalSettings;
    setChannelManager = mockSignalSetCM;
    constructor(_: unknown) {}
  },
}));
vi.mock('./slack-channel', () => ({
  SlackChannel: class {
    readonly id = 'slack';
    start = mockSlackStart;
    stop = mockSlackStop;
    getSettings = mockSlackSettings;
    setChannelManager = mockSlackSetCM;
    constructor(_: unknown) {}
  },
}));

function makeTaskManager(): TaskManager {
  return {
    create: vi.fn(),
    approve: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    on: vi.fn(),
  } as unknown as TaskManager;
}

describe('ChannelManager', () => {
  let tm: TaskManager;
  let manager: ChannelManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tm = makeTaskManager();
    manager = new ChannelManager(tm);
  });

  it('creates all 5 channels on construction', () => {
    expect(manager.getChannel('telegram')).toBeDefined();
    expect(manager.getChannel('discord')).toBeDefined();
    expect(manager.getChannel('slack')).toBeDefined();
    expect(manager.getChannel('whatsapp')).toBeDefined();
    expect(manager.getChannel('signal')).toBeDefined();
  });

  it('injects channel manager back-reference on each channel', () => {
    expect(mockTelegramSetCM).toHaveBeenCalledWith(manager);
    expect(mockWhatsappSetCM).toHaveBeenCalledWith(manager);
    expect(mockDiscordSetCM).toHaveBeenCalledWith(manager);
    expect(mockSignalSetCM).toHaveBeenCalledWith(manager);
    expect(mockSlackSetCM).toHaveBeenCalledWith(manager);
  });

  it('getChannel returns the correct channel', () => {
    const telegram = manager.getChannel('telegram');
    expect(telegram.id).toBe('telegram');
    expect(telegram).toHaveProperty('start');
    expect(telegram).toHaveProperty('stop');
  });

  it('getChannel throws for unknown channel', () => {
    expect(() => manager.getChannel('nonexistent' as any)).toThrow('Unknown channel: nonexistent');
  });

  it('getAllSettings returns settings from all channels', () => {
    const settings = manager.getAllSettings();
    expect(settings).toHaveLength(5);
    expect(settings.map((s) => s.id)).toEqual(
      expect.arrayContaining(['telegram', 'whatsapp', 'discord', 'signal', 'slack'])
    );
  });

  it('startAll calls start on all channels', async () => {
    await manager.startAll();
    expect(mockTelegramStart).toHaveBeenCalled();
    expect(mockWhatsappStart).toHaveBeenCalled();
    expect(mockDiscordStart).toHaveBeenCalled();
    expect(mockSignalStart).toHaveBeenCalled();
    expect(mockSlackStart).toHaveBeenCalled();
  });

  it('startAll continues even if one channel fails', async () => {
    mockTelegramStart.mockRejectedValueOnce(new Error('Token invalid'));
    await manager.startAll();
    expect(mockDiscordStart).toHaveBeenCalled();
    expect(mockSlackStart).toHaveBeenCalled();
  });

  it('stopAll calls stop on all channels', async () => {
    await manager.stopAll();
    expect(mockTelegramStop).toHaveBeenCalled();
    expect(mockWhatsappStop).toHaveBeenCalled();
    expect(mockDiscordStop).toHaveBeenCalled();
    expect(mockSignalStop).toHaveBeenCalled();
    expect(mockSlackStop).toHaveBeenCalled();
  });

  it('stopAll continues even if one channel fails', async () => {
    mockDiscordStop.mockRejectedValueOnce(new Error('Already destroyed'));
    await manager.stopAll();
    expect(mockTelegramStop).toHaveBeenCalled();
  });

  it('autoApprove defaults to true', () => {
    expect(manager.isAutoApprove()).toBe(true);
  });

  it('getGlobalSettings returns a copy', () => {
    const s1 = manager.getGlobalSettings();
    const s2 = manager.getGlobalSettings();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2);
  });

  it('setAutoApprove updates and persists', async () => {
    const result = await manager.setAutoApprove(false);
    expect(result.autoApprove).toBe(false);
    expect(manager.isAutoApprove()).toBe(false);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('loadGlobal reads from disk', async () => {
    const manager2 = new ChannelManager(tm);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ autoApprove: false }));
    await (manager2 as any).loadGlobal();
    expect(manager2.isAutoApprove()).toBe(false);
  });

  it('loadGlobal uses defaults on read error', async () => {
    const manager2 = new ChannelManager(tm);
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    await (manager2 as any).loadGlobal();
    expect(manager2.isAutoApprove()).toBe(true);
  });
});
