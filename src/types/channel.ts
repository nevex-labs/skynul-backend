export type ChannelId = 'telegram' | 'whatsapp' | 'discord' | 'signal' | 'slack';

export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ChannelSettings = {
  id: ChannelId;
  enabled: boolean;
  status: ChannelStatus;
  paired: boolean;
  pairingCode: string | null;
  error: string | null;
  hasCredentials: boolean;
  meta: Record<string, unknown>;
};

export type ChannelGlobalSettings = {
  autoApprove: boolean;
};
