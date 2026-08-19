export interface User {
  id: string;
  username: string;
  /** scrypt hash of the password; the password itself is never stored. */
  passwordHash: string;
  /** Random per-user salt, so identical passwords hash differently. */
  salt: string;
  createdAt: Date;
}

/** What signup accepts. */
export interface CreateUser {
  username: string;
  password: string;
}

/** A user as the API hands it back — never the hash or the salt. */
export type PublicUser = Pick<User, 'id' | 'username' | 'createdAt'>;

export const toPublicUser = ({ id, username, createdAt }: User): PublicUser =>
  ({ id, username, createdAt });
