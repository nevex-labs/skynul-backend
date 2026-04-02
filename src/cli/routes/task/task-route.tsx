import { Box, useInput } from 'ink';
import React, { useCallback, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { SkynulClient } from '../../api-client.js';
import type { TaskLocationState } from './location-state.js';
import { StopTaskModal } from './stop-task-modal.js';
import { TaskView } from './task-view.js';

export function TaskRoute({ client }: { client: SkynulClient }) {
  const navigate = useNavigate();
  const location = useLocation();
  const task = (location.state as TaskLocationState | null)?.task;

  const [confirmStop, setConfirmStop] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    setConfirmStop(false);
    setStopError(null);
  }, []);

  const confirmStopTask = useCallback(async () => {
    if (!task || isStopping) return;
    setIsStopping(true);
    setStopError(null);
    try {
      await client.cancelTask(task.id);
      navigate('/');
    } catch (e) {
      setStopError(e instanceof Error ? e.message : 'No se pudo detener la tarea');
      setIsStopping(false);
    }
  }, [client, isStopping, navigate, task]);

  useInput(
    (inputChar, key) => {
      if (!task) return;

      if (confirmStop) {
        if (isStopping) return;
        if (key.escape || inputChar === 'n' || inputChar === 'N') {
          closeModal();
          return;
        }
        if (key.return || inputChar === 'y' || inputChar === 'Y') {
          void confirmStopTask();
          return;
        }
        return;
      }

      if (key.escape) {
        setConfirmStop(true);
        setStopError(null);
      }
    },
    { isActive: Boolean(task) }
  );

  if (!task) {
    return <Navigate to="/" replace />;
  }

  return (
    <Box flexDirection="column" height="100%">
      {confirmStop ? (
        <Box flexGrow={1} justifyContent="center" paddingX={2}>
          <StopTaskModal taskTitle={task.title} error={stopError} isLoading={isStopping} />
        </Box>
      ) : (
        <TaskView task={task} />
      )}
    </Box>
  );
}
