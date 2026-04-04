export type Project = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
};

export type ProjectWithTasks = Project & {
  taskIds: string[];
};
