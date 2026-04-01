import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from './telegram-channel';

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
  stat: vi.fn(),
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

// Mock grammy Bot
const mockBotApiSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
const mockBotApiSendDocument = vi.fn().mockResolvedValue({ message_id: 2 });
const mockBotStart = vi.fn().mockResolvedValue(undefined);
const mockBotStop = vi.fn().mockResolvedValue(undefined);
const mockBotCommand = vi.fn();
const mockBotOn = vi.fn();
const mockBotCatch = vi.fn();

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(function (this: any, token: string) {
    this.token = token;
    this.api = {
      sendMessage: mockBotApiSendMessage,
      sendDocument: mockBotApiSendDocument,
      getFile: vi.fn(),
    };
    this.start = mockBotStart;
    this.stop = mockBotStop;
    this.command = mockBotCommand;
    this.on = mockBotOn;
    this.catch = mockBotCatch;
  }),
  InputFile: vi.fn().mockImplementation((path: string) => ({ path })),
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

describe('TelegramChannel', () => {
  let channel: TelegramChannel;
  let tm: ReturnType<typeof makeTaskManagerMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations after clearAllMocks clears them
    mockBotStart.mockResolvedValue(undefined);
    mockBotStop.mockResolvedValue(undefined);
    mockBotApiSendMessage.mockResolvedValue({ message_id: 1 });
    mockBotApiSendDocument.mockResolvedValue({ message_id: 2 });
    mockGetSecret.mockResolvedValue(null);
    mockSetSecret.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockHandleCommand.mockResolvedValue({ handled: false, text: '' });
    tm = makeTaskManagerMock();
    channel = new TelegramChannel(tm as any);
  });

  it('has id telegram', () => {
    expect(channel.id).toBe('telegram');
  });

  it('getSettings returns disconnected by default', () => {
    const s = channel.getSettings();
    expect(s.id).toBe('telegram');
    expect(s.enabled).toBe(false);
    expect(s.status).toBe('disconnected');
    expect(s.paired).toBe(false);
    expect(s.hasCredentials).toBe(false);
  });

  it('getSettings shows hasCredentials when token exists', async () => {
    mockGetSecret.mockResolvedValueOnce('bot-token-123');
    // Start with token to set hasToken
    await channel.start();
    const s = channel.getSettings();
    expect(s.hasCredentials).toBe(true);
  });

  it('getSettings shows enabled=false status=disconnected when no token', () => {
    const s = channel.getSettings();
    expect(s.enabled).toBe(false);
    expect(s.status).toBe('disconnected');
  });

  it('setCredentials stores token in secret store', async () => {
    await channel.setCredentials({ token: ' bot-token-123 ' });
    expect(mockSetSecret).toHaveBeenCalledWith('telegram.botToken', 'bot-token-123');
    const s = channel.getSettings();
    expect(s.hasCredentials).toBe(true);
  });

  it('setCredentials does nothing for empty token', async () => {
    await channel.setCredentials({});
    expect(mockSetSecret).not.toHaveBeenCalled();
  });

  it('generatePairingCode returns hex code', async () => {
    const code = await channel.generatePairingCode();
    expect(code).toMatch(/^[a-f0-9]{8}$/);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('generatePairingCode generates unique codes', async () => {
    const code1 = await channel.generatePairingCode();
    const code2 = await channel.generatePairingCode();
    expect(code1).not.toBe(code2);
  });

  it('unpair resets pairing state', async () => {
    // First generate a pairing code
    await channel.generatePairingCode();
    expect(channel.getSettings().pairingCode).not.toBeNull();

    await channel.unpair();
    expect(channel.getSettings().paired).toBe(false);
    expect(channel.getSettings().pairingCode).toBeNull();
  });

  it('start skips when disabled', async () => {
    await channel.start();
    expect(mockBotStart).not.toHaveBeenCalled();
  });

  it('start creates bot when enabled with token', async () => {
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');

    await channel.start();

    const { Bot } = await import('grammy');
    expect(Bot).toHaveBeenCalledWith('bot-token-123');
    expect(mockBotStart).toHaveBeenCalled();
    expect(channel.getSettings().enabled).toBe(true);
  });

  it('start warns when enabled but no token', async () => {
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce(null);

    await channel.start();

    expect(mockBotStart).not.toHaveBeenCalled();
    const s = channel.getSettings();
    expect(s.status).toBe('error');
  });

  it('stop clears bot and timer', async () => {
    // Start first
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');
    await channel.start();

    await channel.stop();

    expect(mockBotStop).toHaveBeenCalled();
  });

  it('setEnabled starts channel when true', async () => {
    // setEnabled saves first, then start() reloads from disk
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ enabled: true, pairedChatId: null, pairingCode: null }));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');

    const s = await channel.setEnabled(true);
    expect(s.enabled).toBe(true);
    expect(mockBotStart).toHaveBeenCalled();
  });

  it('setEnabled stops channel when false', async () => {
    const s = await channel.setEnabled(false);
    expect(s.enabled).toBe(false);
  });

  it('registers bot commands on start', async () => {
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');

    await channel.start();

    expect(mockBotCommand).toHaveBeenCalledWith('pair', expect.any(Function));
    expect(mockBotCommand).toHaveBeenCalledWith('unpair', expect.any(Function));
    expect(mockBotCommand).toHaveBeenCalledWith('list', expect.any(Function));
    expect(mockBotCommand).toHaveBeenCalledWith('status', expect.any(Function));
    expect(mockBotCommand).toHaveBeenCalledWith('cancel', expect.any(Function));
    expect(mockBotCommand).toHaveBeenCalledWith('send', expect.any(Function));
    expect(mockBotOn).toHaveBeenCalledWith('message:document', expect.any(Function));
    expect(mockBotOn).toHaveBeenCalledWith('message:text', expect.any(Function));
  });

  it('registers bot error handler', async () => {
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');

    await channel.start();

    expect(mockBotCatch).toHaveBeenCalledWith(expect.any(Function));
  });

  it('subscribes to task updates', async () => {
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');

    await channel.start();

    expect(tm.on).toHaveBeenCalledWith('taskUpdate', expect.any(Function));
  });

  it('loads state from file on start', async () => {
    const savedState = { enabled: true, pairedChatId: 12345, pairingCode: 'abc' };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token');

    await channel.start();

    const s = channel.getSettings();
    expect(s.paired).toBe(true);
    expect(s.pairingCode).toBe('abc');
    expect(s.meta?.pairedChatId).toBe(12345);
  });

  it('getSettings shows error status when enabled with error', async () => {
    const savedState = { enabled: true, pairedChatId: null, pairingCode: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockGetSecret.mockResolvedValueOnce('bot-token-123');

    // Simulate start error by making Bot constructor throw
    mockBotStart.mockImplementationOnce(() => {
      throw new Error('Invalid token');
    });

    await channel.start();

    const s = channel.getSettings();
    expect(s.status).toBe('error');
    expect(s.error).toContain('Invalid token');
  });
});
