import { Hono } from 'hono';
import { channels } from './channels';
import { secrets } from './secrets';

const integrationsGroup = new Hono().route('/channels', channels).route('/secrets', secrets);

export { integrationsGroup };
export { channelManager } from './channels';
export type IntegrationsGroup = typeof integrationsGroup;
