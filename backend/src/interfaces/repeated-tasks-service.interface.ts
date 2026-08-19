import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../types/repeated-tasks.types.js';

export interface IRepeatedTasksService {
  listAll(): Promise<RepeatedTask[]>;
  getById(id: string): Promise<RepeatedTask | null>;
  create(input: CreateRepeatedTask): Promise<RepeatedTask>;
  updateById(id: string, changes: UpdateRepeatedTask): Promise<RepeatedTask>;
  deleteById(id: string): Promise<void>;
}
