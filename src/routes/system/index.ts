import { Hono } from 'hono';
import { browser } from './browser';
import { runtime } from './runtime';

const systemGroup = new Hono().route('/browser', browser).route('/runtime', runtime);

export { systemGroup };
export type SystemGroup = typeof systemGroup;
