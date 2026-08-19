import { randomUUID } from 'node:crypto';

import type { Collection, Db } from 'mongodb';
import { MongoServerError } from 'mongodb';

import type { IUsersRepository } from '../interfaces/users-repository.interface.js';
import type { CreateUser, User } from '../types/user.types.js';
import { ConflictError } from '../utils/http-errors/conflict.error.js';
import { hashPassword, newSalt } from '../utils/password.util.js';
import type { Persisted } from './entity.interface.js';

export const USERS_COLLECTION = 'users';

/** Mongo's duplicate-key code; the unique index on username raises it. */
const DUPLICATE_KEY = 11000;

export class UsersRepository implements IUsersRepository {
  private readonly collection: Collection<Persisted<User>>;

  constructor(db: Db) {
    this.collection = db.collection<Persisted<User>>(USERS_COLLECTION);
  }

  /**
   * Uniqueness is the database's job, not a read-then-write check: two signups
   * racing would both see the name free and both insert it.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ username: 1 }, { unique: true });
  }

  async findByUsername(username: string): Promise<User | null> {
    const document = await this.collection.findOne({ username });
    if (document === null) return null;

    const { _id: id, ...rest } = document;

    return { ...rest, id };
  }

  async create(input: CreateUser): Promise<User> {
    const salt = newSalt();
    const user: User = {
      id: randomUUID(),
      username: input.username,
      passwordHash: await hashPassword(input.password, salt),
      salt,
      createdAt: new Date(),
    };

    const { id, ...rest } = user;

    try {
      await this.collection.insertOne({ ...rest, _id: id });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        throw new ConflictError(`Username ${input.username} is taken.`);
      }

      throw error;
    }

    return user;
  }
}
