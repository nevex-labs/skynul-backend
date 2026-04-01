import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackChannel } from './slack-channel';

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

// Mock @slack/bolt
const mockSlackStart = vi.fn().mockResolvedValue(undefined);
const mockSlackStop = vi.fn().mockResolvedValue(undefined);
const mockSlackPostMessage = vi.fn().mockResolvedValue({ ok: true });
const mockSlackMessage = vi.fn();

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.message = mockSlackMessage;
    this.start = mockSlackStart;
    this.stop = mockSlackStop;
    this.client = { chat: { postMessage: mockSlackPostMessage } };
  }),
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

describe('SlackChannel', () => {
  let channel: SlackChannel;
  let tm: ReturnType<typeof makeTaskManagerMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockGetSecret.mockResolvedValue(null);
    mockSetSecret.mockResolvedValue(undefined);
    mockHandleCommand.mockResolvedValue({ handled: false, text: '' });
    mockSlackStart.mockResolvedValue(undefined);
    mockSlackStop.mockResolvedValue(undefined);
    mockSlackPostMessage.mockResolvedValue({ ok: true });
    tm = makeTaskManagerMock();
    channel = new SlackChannel(tm as any);
  });

  it('has id slack', () => {
    expect(channel.id).toBe('slack');
  });

  it('getSettings returns disconnected by default', () => {
    const s = channel.getSettings();
    expect(s.id).toBe('slack');
    expect(s.enabled).toBe(false);
    expect(s.status).toBe('disconnected');
    expect(s.paired).toBe(false);
  });

  it('setCredentials stores both tokens', async () => {
    await channel.setCredentials({ botToken: 'xoxb-123', appToken: 'xapp-456' });
    expect(mockSetSecret).toHaveBeenCalledWith('slack.botToken', 'xoxb-123');
    expect(mockSetSecret).toHaveBeenCalledWith('slack.appToken', 'xapp-456');
  });

  it('setCredentials stores only provided tokens', async () => {
    await channel.setCredentials({ botToken: 'xoxb-123' });
    expect(mockSetSecret).toHaveBeenCalledTimes(1);
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
    expect(mockSlackStart).not.toHaveBeenCalled();
  });

  it('start skips when enabled but missing tokens', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    // No tokens set

    await channel.start();
    expect(mockSlackStart).not.toHaveBeenCalled();
  });

  it('start creates app when enabled with tokens', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('xoxb-bot-token');
    mockGetSecret.mockResolvedValueOnce('xapp-app-token');

    await channel.start();

    const { App } = await import('@slack/bolt');
    expect(App).toHaveBeenCalledWith({
      token: 'xoxb-bot-token',
      appToken: 'xapp-app-token',
      socketMode: true,
    });
    expect(mockSlackStart).toHaveBeenCalled();
    expect(mockSlackMessage).toHaveBeenCalledWith(expect.any(Function));
  });

  it('start subscribes to task updates', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('xoxb-bot-token');
    mockGetSecret.mockResolvedValueOnce('xapp-app-token');

    await channel.start();
    expect(tm.on).toHaveBeenCalledWith('taskUpdate', expect.any(Function));
  });

  it('stop stops app', async () => {
    const savedState = { enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('xoxb-bot-token');
    mockGetSecret.mockResolvedValueOnce('xapp-app-token');
    await channel.start();

    await channel.stop();
    expect(mockSlackStop).toHaveBeenCalled();
  });

  it('stop does nothing when no app', async () => {
    await channel.stop();
    expect(mockSlackStop).not.toHaveBeenCalled();
  });

  it('setEnabled starts channel when true', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ enabled: true, paired: false, pairedUserId: null, pairedChannelId: null, pairingCode: null })
    );
    mockGetSecret.mockResolvedValueOnce('xoxb-bot-token');
    mockGetSecret.mockResolvedValueOnce('xapp-app-token');

    const s = await channel.setEnabled(true);
    expect(s.enabled).toBe(true);
    expect(mockSlackStart).toHaveBeenCalled();
  });

  it('setEnabled stops channel when false', async () => {
    const s = await channel.setEnabled(false);
    expect(s.enabled).toBe(false);
  });

  it('loads state from file', async () => {
    const savedState = {
      enabled: true,
      paired: true,
      pairedUserId: 'U123',
      pairedChannelId: 'C456',
      pairingCode: null,
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('xoxb-bot-token');
    mockGetSecret.mockResolvedValueOnce('xapp-app-token');

    await channel.start();

    const s = channel.getSettings();
    expect(s.paired).toBe(true);
    expect(s.meta?.pairedUserId).toBe('U123');
    expect(s.meta?.pairedChannelId).toBe('C456');
  });
});
