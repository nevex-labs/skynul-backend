import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { Schedule } from '../../types';
import { getDataDir } from '../config';

function filePath(): string {
  return join(getDataDir(), 'schedules.json');
}

export async function loadSchedules(): Promise<Schedule[]> {
  try {
    const raw = await readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSchedules(schedules: Schedule[]): Promise<void> {
  const f = filePath();
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(schedules, null, 2), 'utf8');
}

export function createScheduleId(): string {
  return `sched_${randomBytes(4).toString('hex')}`;
}
