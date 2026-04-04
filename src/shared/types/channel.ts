export type ChannelId = 'telegram' | 'whatsapp' | 'discord' | 'signal' | 'slack';

export type ChannelStatus = 'pending' | 'active' | 'inactive' | 'error';

export type ChannelSettings = {
  id: ChannelId;
  name: string;
  enabled: boolean;
  paired: boolean;
  webhookUrl?: string;
  credentials?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
};

export type ChannelConfig = {
  id: ChannelId;
  status: ChannelStatus;
  credentials?: Record<string, string>;
  webhookUrl?: string;
  createdAt: number;
  updatedAt: number;
};
