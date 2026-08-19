import type { CreateUser, User } from '../types/user.types.js';

export interface IUsersRepository {
  /** The user with this username, or null. Usernames are unique. */
  findByUsername(username: string): Promise<User | null>;

  /** Stores a new user. Throws ConflictError if the username is taken. */
  create(input: CreateUser): Promise<User>;

  ensureIndexes(): Promise<void>;
}
