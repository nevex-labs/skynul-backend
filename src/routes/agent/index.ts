import { Hono } from 'hono';
import { dialogs } from './dialogs';
import { policy } from './policy';
import { skills } from './skills';

const agentGroup = new Hono().route('/skills', skills).route('/policy', policy).route('/dialogs', dialogs);

export { agentGroup };
export { policyState } from './policy';
export type AgentGroup = typeof agentGroup;
