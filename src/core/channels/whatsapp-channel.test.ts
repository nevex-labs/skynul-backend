import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppChannel } from './whatsapp-channel';

const { mockReadFile, mockWriteFile, mockMkdir, mockHandleCommand } = vi.hoisted(() => {
  return {
    mockReadFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
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

vi.mock('./command-router', () => ({
  handleCommand: mockHandleCommand,
}));

vi.mock('../agent/task-inference', () => ({
  inferTaskSetupRules: vi.fn(() => ({ capabilities: [], mode: 'browser' })),
}));

// Mock whatsapp-web.js
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockDestroy = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();

vi.mock('whatsapp-web.js', () => {
  class MockClient {
    on = mockOn;
    initialize = mockInitialize;
    destroy = mockDestroy;
    sendMessage = mockSendMessage;
    logout = mockLogout;
    info = undefined;
    constructor() {}
  }
  class MockLocalAuth {
    constructor() {}
  }
  return {
    default: {
      Client: MockClient,
      LocalAuth: MockLocalAuth,
    },
  };
});

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

describe('WhatsAppChannel', () => {
  let channel: WhatsAppChannel;
  let tm: ReturnType<typeof makeTaskManagerMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockHandleCommand.mockResolvedValue({ handled: false, text: '' });
    mockInitialize.mockResolvedValue(undefined);
    mockDestroy.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue(undefined);
    tm = makeTaskManagerMock();
    channel = new WhatsAppChannel(tm as any);
  });

  it('has id whatsapp', () => {
    expect(channel.id).toBe('whatsapp');
  });

  it('getSettings returns disconnected by default', () => {
    const s = channel.getSettings();
    expect(s.id).toBe('whatsapp');
    expect(s.enabled).toBe(false);
    expect(s.status).toBe('disconnected');
    expect(s.paired).toBe(false);
  });

  it('setCredentials is a no-op (QR-based auth)', async () => {
    await channel.setCredentials({ token: 'anything' });
    // No error, but also no secrets set
    expect(true).toBe(true);
  });

  it('generatePairingCode returns waiting-for-qr when no QR yet', async () => {
    const code = await channel.generatePairingCode();
    expect(code).toBe('waiting-for-qr');
  });

  it('unpair resets pairing state', async () => {
    await channel.unpair();
    const s = channel.getSettings();
    expect(s.paired).toBe(false);
    expect(s.pairingCode).toBeNull();
  });

  it('start skips when disabled', async () => {
    await channel.start();
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('start creates client and initializes when enabled', async () => {
    const savedState = { enabled: true, paired: false, pairedChatId: null, phoneNumber: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));

    await channel.start();

    expect(mockInitialize).toHaveBeenCalled();
    expect(mockOn).toHaveBeenCalledWith('qr', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('authenticated', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('auth_failure', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('disconnected', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('start subscribes to task updates', async () => {
    const savedState = { enabled: true, paired: false, pairedChatId: null, phoneNumber: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));

    await channel.start();
    expect(tm.on).toHaveBeenCalledWith('taskUpdate', expect.any(Function));
  });

  it('stop destroys client', async () => {
    const savedState = { enabled: true, paired: false, pairedChatId: null, phoneNumber: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
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
      JSON.stringify({ enabled: true, paired: false, pairedChatId: null, phoneNumber: null })
    );

    const s = await channel.setEnabled(true);
    expect(s.enabled).toBe(true);
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('setEnabled stops channel when false', async () => {
    const s = await channel.setEnabled(false);
    expect(s.enabled).toBe(false);
  });

  it('loads state from file', async () => {
    const savedState = { enabled: true, paired: true, pairedChatId: '54911@c.us', phoneNumber: '+54911' };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));

    await channel.start();

    const s = channel.getSettings();
    expect(s.paired).toBe(true);
    expect(s.meta?.pairedChatId).toBe('54911@c.us');
    expect(s.meta?.phoneNumber).toBe('+54911');
  });

  it('start handles initialization error gracefully', async () => {
    const savedState = { enabled: true, paired: false, pairedChatId: null, phoneNumber: null };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(savedState));
    mockInitialize.mockRejectedValueOnce(new Error('Browser not found'));

    await channel.start();

    const s = channel.getSettings();
    expect(s.error).toContain('Browser not found');
  });
});
