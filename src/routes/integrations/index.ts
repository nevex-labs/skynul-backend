import { Hono } from 'hono';
import { channels } from './channels';
import { secrets } from './secrets';
import { trading } from './trading';

const integrationsGroup = new Hono().route('/channels', channels).route('/secrets', secrets).route('/trading', trading);

export { integrationsGroup };
export { channelManager } from './channels';
export type IntegrationsGroup = typeof integrationsGroup;
