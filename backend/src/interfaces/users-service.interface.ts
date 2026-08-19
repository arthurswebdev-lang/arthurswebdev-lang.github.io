import type { PublicUser, User } from '../types/user.types.js';

export interface IUsersService {
  /** Creates the account. Throws when the username is taken. */
  signUp(username: string, password: string): Promise<PublicUser>;

  /** The user these credentials belong to, or throws Unauthorized. */
  authenticate(username: string, password: string): Promise<User>;
}
