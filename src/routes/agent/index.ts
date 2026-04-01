import { Hono } from 'hono';
import { policy } from './policy';
import { skills } from './skills';

const agentGroup = new Hono().route('/skills', skills).route('/policy', policy);

export { agentGroup };
export { policyState } from './policy';
export type AgentGroup = typeof agentGroup;
