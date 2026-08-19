import type { IUsersRepository } from '../interfaces/users-repository.interface.js';
import type { IUsersService } from '../interfaces/users-service.interface.js';
import type { PublicUser, User } from '../types/user.types.js';
import { toPublicUser } from '../types/user.types.js';
import { UnauthorizedError } from '../utils/http-errors/unauthorized.error.js';
import { verifyPassword } from '../utils/password.util.js';

/**
 * Signup takes a username and a password and does nothing else with them —
 * no email, no confirmation step. The only rule is that the username is free,
 * and the database enforces that.
 */
export class UsersService implements IUsersService {
  constructor(private readonly usersRepository: IUsersRepository) {}

  async signUp(username: string, password: string): Promise<PublicUser> {
    const user = await this.usersRepository.create({ username, password });

    return toPublicUser(user);
  }

  async authenticate(username: string, password: string): Promise<User> {
    const user = await this.usersRepository.findByUsername(username);

    // Same error either way: saying "no such user" would let anyone probe which
    // usernames exist.
    if (user === null) throw new UnauthorizedError('Wrong username or password.');

    const matches = await verifyPassword(password, user.salt, user.passwordHash);
    if (!matches) throw new UnauthorizedError('Wrong username or password.');

    return user;
  }
}
