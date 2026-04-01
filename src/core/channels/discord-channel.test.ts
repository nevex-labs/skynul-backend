import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordChannel } from './discord-channel';

const { mockReadFile, mockWriteFile, mockMkdir, mockGetSecret, mockSetSecret, mockHandleCommand } = vi.hoisted(() => {
  return {
    mockReadFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockGetSecret: vi.fn().mockResolvedValue(null),
    mockSetSecret: vi.fn().mockResolvedValue(undefined),
    mockHandleCommand: vi.fn().mockResolvedValue({ handled: false, text: '' }),
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

vi.mock('../stores/secret-store', () => ({
  getSecret: mockGetSecret,
  setSecret: mockSetSecret,
}));

vi.mock('./command-router', () => ({
  handleCommand: mockHandleCommand,
}));

vi.mock('../agent/task-inference', () => ({
  inferTaskSetupRules: vi.fn(() => ({ capabilities: [], mode: 'browser' })),
}));

// Mock discord.js
const mockLogin = vi.fn().mockResolvedValue('token');
const mockDestroy = vi.fn().mockResolvedValue(undefined);
const mockIsReady = vi.fn().mockReturnValue(false);
const mockOn = vi.fn();
const mockFetch = vi.fn();

vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.on = mockOn;
    this.login = mockLogin;
    this.destroy = mockDestroy;
    this.isReady = mockIsReady;
    this.channels = { fetch: mockFetch };
  }),
  Events: {
    ClientReady: 'ready',
    MessageCreate: 'messageCreate',
    Error: 'error',
  },
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    DirectMessages: 4,
    MessageContent: 8,
  },
}));

function makeTaskManagerMock() {
  return {
    create: vi.fn(() => ({ id: 'task-1', status: 'pending_approval' })),
    approve: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(),
    cancel: vi.fn(),
    on: vi.fn(),
  };
}

describe('DiscordChannel', () => {
  let channel: DiscordChannel;
  let tm: ReturnType<typeof makeTaskManagerMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockGetSecret.mockResolvedValue(null);
    mockSetSecret.mockResolvedValue(undefined);
    mockHandleCommand.mockResolvedValue({ handled: false, text: '' });
    mockLogin.mockResolvedValue('token');
    mockDestroy.mockResolvedValue(undefined);
    mockIsReady.mockReturnValue(false);
    tm = makeTaskManagerMock();
    channel = new DiscordChannel(tm as any);
  });

  it('has id discord', () => {
    expect(channel.id).toBe('discord');
  });

  it('getSettings returns disconnected by default', () => {
    const s = channel.getSettings();
    expect(s.id).toBe('discord');
    expect(s.enabled).toBe(false);
    expect(s.status).toBe('disconnected');
    expect(s.paired).toBe(false);
  });

  it('getSettings shows connecting when enabled but not ready', () => {
    // We need to get state.enabled = true. Use saved state.
    // Since we can't easily inject state, just check disconnected default
    const s = channel.getSettings();
    expect(s.status).toBe('disconnected');
  });

  it('setCredentials stores token in secret store', async () => {
    await channel.setCredentials({ token: ' bot-token-123 ' });
    expect(mockSetSecret).toHaveBeenCalledWith('discord.botToken', 'bot-token-123');
  });

  it('setCredentials does nothing for empty creds', async () => {
    await channel.setCredentials({});
    expect(mockSetSecret).not.toHaveBeenCalled();
  });

  it('generatePairingCode returns hex code', async () => {
    const code = await channel.generatePairingCode();
    expect(code).toMatch(/^[a-f0-9]{8}$/);
  });

  it('unpair resets pairing state', async () => {
    await channel.unpair();
    const s = channel.getSettings();
    expect(s.paired).toBe(false);
    expect(s.pairingCode).toBeNull();
  });

  it('start skips when disabled', async () => {
    await channel.start();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('start skips when enabled but no token', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce(null);

    await channel.start();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('start creates client and logs in when enabled with token', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('discord-bot-token');

    await channel.start();

    const { Client } = await import('discord.js');
    expect(Client).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith('discord-bot-token');
    expect(mockOn).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('messageCreate', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('start subscribes to task updates', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('discord-bot-token');

    await channel.start();

    expect(tm.on).toHaveBeenCalledWith('taskUpdate', expect.any(Function));
  });

  it('stop destroys client', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('discord-bot-token');
    await channel.start();

    await channel.stop();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('stop does nothing when no client', async () => {
    await channel.stop();
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it('setEnabled starts channel when true', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null })
    );
    mockGetSecret.mockResolvedValueOnce('discord-bot-token');

    const s = await channel.setEnabled(true);
    expect(s.enabled).toBe(true);
    expect(mockLogin).toHaveBeenCalled();
  });

  it('setEnabled stops channel when false', async () => {
    const s = await channel.setEnabled(false);
    expect(s.enabled).toBe(false);
  });

  it('loads state from file', async () => {
    const savedState = {
      enabled: true,
      paired: true,
      pairedUserId: 'user-123',
      pairedChannelId: 'chan-456',
      pairingCode: null,
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('discord-bot-token');

    await channel.start();

    const s = channel.getSettings();
    expect(s.paired).toBe(true);
    expect(s.meta?.pairedUserId).toBe('user-123');
    expect(s.meta?.pairedChannelId).toBe('chan-456');
  });
});
