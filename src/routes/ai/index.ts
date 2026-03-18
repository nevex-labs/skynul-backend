import { Hono } from 'hono';
import { chat } from './chat';
import { chatgpt } from './chatgpt';
import { ollama } from './ollama';

const aiGroup = new Hono().route('/chat', chat).route('/chatgpt', chatgpt).route('/ollama', ollama);

export { aiGroup };
export type AiGroup = typeof aiGroup;
