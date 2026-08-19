/**
 * CRUD contract every repository implements, whatever backs it.
 *
 * @typeParam TEntity - the stored shape, which owns its `id`.
 * @typeParam TCreate - the payload accepted when creating one.
 * @typeParam TUpdate - the payload accepted when updating one.
 */
export interface IBaseRepository<TEntity extends { id: string }, TCreate, TUpdate> {
  /** Everything this user owns, in insertion order. */
  list(userId: string): Promise<TEntity[]>;

  /** The entity with this id, or `null` when nothing matches. */
  getById(id: string): Promise<TEntity | null>;

  /** Stores a new entity, assigning its uuid and owner, and returns it. */
  create(input: TCreate, userId: string): Promise<TEntity>;

  /** Applies `changes`, returning the updated entity or `null` if absent. */
  updateById(id: string, changes: TUpdate): Promise<TEntity | null>;

  /** Removes the entity; `false` when there was nothing to remove. */
  deleteById(id: string): Promise<boolean>;
}
