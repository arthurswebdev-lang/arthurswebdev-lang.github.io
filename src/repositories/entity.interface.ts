/**
 * How an entity looks in Mongo. The driver names the primary key `_id`, while
 * the domain calls it `id`, so the repository maps between the two and nothing
 * above it has to know Mongo exists.
 *
 * `_id` is a uuid string rather than an ObjectId: ids are uuids everywhere in
 * this API — the route validation, the Postman collection and every stored
 * `configTaskId` — and Mongo is happy to use a string as a primary key.
 */
export interface IEntity {
  _id: string;
}

/** The stored form of a domain entity: `id` becomes `_id`. */
export type Persisted<TEntity> = TEntity extends { id: string }
  ? Omit<TEntity, 'id'> & IEntity
  : never;
