import bcrypt from "bcrypt";
import { User, UserDoc } from "../../models/User";

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

export class AuthError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = "AuthError";
  }
}

export async function registerUser(email: string, password: string): Promise<UserDoc> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new AuthError("invalid email address");
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    // Deliberately vague — don't reveal whether an email is registered.
    throw new AuthError("could not create account with those details", 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await User.create({ email: normalizedEmail, passwordHash });
  return user;
}

export async function verifyCredentials(email: string, password: string): Promise<UserDoc> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  // Constant-shape response whether the user exists or not, to avoid leaking
  // account existence via timing/response differences where practical.
  const hashToCompare = user?.passwordHash ?? (await bcrypt.hash("placeholder", SALT_ROUNDS));
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    throw new AuthError("invalid email or password", 401);
  }
  return user;
}
