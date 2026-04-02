import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { SkynulClient } from './api-client.js';
import { ChatRoute } from './routes/chat/chat-route.js';
import { TaskRoute } from './routes/task/task-route.js';

export function Cli({ client }: { client: SkynulClient }) {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ChatRoute client={client} />} />
        <Route path="/task" element={<TaskRoute client={client} />} />
      </Routes>
    </MemoryRouter>
  );
}
