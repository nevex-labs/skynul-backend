import { Hono } from 'hono';
import { policy } from './policy';
import { skills } from './skills';

const agentGroup = new Hono().route('/skills', skills).route('/policy', policy);

export { agentGroup };
export type AgentGroup = typeof agentGroup;
