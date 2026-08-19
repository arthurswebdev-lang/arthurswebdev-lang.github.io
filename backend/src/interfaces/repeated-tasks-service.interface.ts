import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../types/repeated-tasks.types.js';

export interface IRepeatedTasksService {
  listAll(userId: string): Promise<RepeatedTask[]>;
  getById(id: string, userId: string): Promise<RepeatedTask | null>;
  create(input: CreateRepeatedTask, userId: string): Promise<RepeatedTask>;
  updateById(id: string, userId: string, changes: UpdateRepeatedTask): Promise<RepeatedTask>;
  deleteById(id: string, userId: string): Promise<void>;
}
