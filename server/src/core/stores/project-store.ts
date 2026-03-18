import type { ProjectWithTasks } from '../../types'
import Database from 'better-sqlite3'
import { join } from 'path'
import { getDataDir } from '../config'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  const dbPath = join(getDataDir(), 'memory.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_tasks (
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, task_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `)
  return db
}

function rowToProject(row: Record<string, unknown>, taskIds: string[]): ProjectWithTasks {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    createdAt: row.created_at as number,
    taskIds
  }
}

export function projectList(): ProjectWithTasks[] {
  const d = getDb()
  const rows = d.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<
    string,
    unknown
  >[]
  return rows.map((r) => {
    const tasks = d
      .prepare('SELECT task_id FROM project_tasks WHERE project_id = ? ORDER BY added_at')
      .all(r.id as string) as { task_id: string }[]
    return rowToProject(
      r,
      tasks.map((t) => t.task_id)
    )
  })
}

export function projectCreate(name: string, color = '#6366f1'): ProjectWithTasks {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO projects (id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, color, now)
  return { id, name, color, createdAt: now, taskIds: [] }
}

export function projectUpdate(id: string, name: string, color: string): void {
  getDb().prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?').run(name, color, id)
}

export function projectDelete(id: string): void {
  const d = getDb()
  d.prepare('DELETE FROM project_tasks WHERE project_id = ?').run(id)
  d.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function projectAddTask(projectId: string, taskId: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO project_tasks (project_id, task_id, added_at) VALUES (?, ?, ?)')
    .run(projectId, taskId, Date.now())
}

export function projectRemoveTask(projectId: string, taskId: string): void {
  getDb()
    .prepare('DELETE FROM project_tasks WHERE project_id = ? AND task_id = ?')
    .run(projectId, taskId)
}

export function closeProjectDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
