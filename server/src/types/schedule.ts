import type { TaskCapabilityId, TaskMode } from './task'

export type ScheduleFrequency = 'daily' | 'weekly' | 'custom'

export type Schedule = {
  id: string
  prompt: string
  capabilities: TaskCapabilityId[]
  mode: TaskMode
  frequency: ScheduleFrequency
  cronExpr: string // e.g. "0 9 * * *"
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number
  createdAt: number
}
