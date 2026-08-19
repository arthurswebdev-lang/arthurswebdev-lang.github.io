import type {
  Collection, Db, Filter, OptionalUnlessRequiredId, WithId,
} from 'mongodb';

import type { IBaseRepository } from '../interfaces/base-repository.interface.js';
import type { Persisted } from './entity.interface.js';

/**
 * The CRUD every Mongo-backed repository shares, over one collection.
 *
 * Its whole job beyond the queries is translating between the stored document
 * (`_id`) and the domain entity (`id`), so services and filters never see a
 * Mongo shape. Dates need no translation at all — the driver stores and returns
 * real `Date` objects, which the JSON store had to rebuild by hand.
 */
export abstract class MongoRepository<
  TEntity extends { id: string; userId: string },
  TCreate,
  TUpdate,
>
implements IBaseRepository<TEntity, TCreate, TUpdate> {
  protected readonly collection: Collection<Persisted<TEntity>>;

  protected constructor(db: Db, collectionName: string) {
    this.collection = db.collection<Persisted<TEntity>>(collectionName);
  }

  /** Builds the stored entity — uuid, owner and all — from a create payload. */
  protected abstract toEntity(input: TCreate, userId: string): TEntity;

  /** Produces the entity to store in place of `entity`. */
  protected abstract applyUpdate(entity: TEntity, changes: TUpdate): TEntity;

  /** Indexes this collection needs. Called once at startup. */
  abstract ensureIndexes(): Promise<void>;

  /** Scoped to one owner: no caller ever sees another user's rows. */
  async list(userId: string): Promise<TEntity[]> {
    const owned = { userId } as unknown as Filter<Persisted<TEntity>>;
    const documents = await this.collection.find(owned).toArray();

    return documents.map((document) => this.toDomain(document));
  }

  async getById(id: string): Promise<TEntity | null> {
    const document = await this.collection.findOne(this.byId(id));

    return document === null ? null : this.toDomain(document);
  }

  async create(input: TCreate, userId: string): Promise<TEntity> {
    const entity = this.toEntity(input, userId);
    await this.collection.insertOne(
      this.toDocument(entity) as OptionalUnlessRequiredId<Persisted<TEntity>>,
    );

    return entity;
  }

  async updateById(id: string, changes: TUpdate): Promise<TEntity | null> {
    const current = await this.getById(id);
    if (current === null) return null;

    const updated = this.applyUpdate(current, changes);
    await this.collection.replaceOne(this.byId(id), this.toDocument(updated));

    return updated;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne(this.byId(id));

    return result.deletedCount > 0;
  }

  /** `_id` is the uuid, so a lookup by domain id is a lookup by primary key. */
  protected byId(id: string): Filter<Persisted<TEntity>> {
    return { _id: id } as Filter<Persisted<TEntity>>;
  }

  protected toDomain(document: WithId<Persisted<TEntity>>): TEntity {
    const { _id: id, ...rest } = document;

    // The spread loses the union's discriminant for the compiler, but every
    // document was written from a TEntity, so the shape is the entity's.
    return { ...rest, id } as unknown as TEntity;
  }

  protected toDocument(entity: TEntity): Persisted<TEntity> {
    const { id, ...rest } = entity;

    return { ...rest, _id: id } as unknown as Persisted<TEntity>;
  }
}
