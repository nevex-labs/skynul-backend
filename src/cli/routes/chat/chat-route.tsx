import { useInput } from 'ink';
import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { SkynulClient } from '../../api-client.js';
import type { Task } from '../task/task-view.js';
import { ChatView } from './chat-view.js';

export function ChatRoute({ client }: { client: SkynulClient }) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const handleSubmit = useCallback(async () => {
    const text = inputRef.current.trim();
    if (!text || isLoading) return;

    setSubmitError(null);
    setInput('');
    setIsLoading(true);

    try {
      const taskResponse = await client.createTask({
        prompt: text,
        mode: 'code',
        source: 'desktop',
      });

      const newTask: Task = {
        id: taskResponse.id,
        title: `Task: ${text.slice(0, 50)}${text.length > 50 ? '...' : ''}`,
        content: text,
        status: taskResponse.status as Task['status'],
        createdAt: new Date(taskResponse.createdAt),
        updatedAt: new Date(taskResponse.updatedAt || taskResponse.createdAt),
      };

      navigate('/task', { state: { task: newTask } });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'No se pudo crear la tarea');
    } finally {
      setIsLoading(false);
    }
  }, [client, isLoading, navigate]);

  useInput((inputChar, key) => {
    if (key.return) {
      handleSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      if (submitError) setSubmitError(null);
      return;
    }

    if (inputChar && inputChar.length === 1 && !key.ctrl && !key.meta) {
      setInput((prev) => prev + inputChar);
      if (submitError) setSubmitError(null);
    }
  });

  return <ChatView input={input} isLoading={isLoading} error={submitError} />;
}
