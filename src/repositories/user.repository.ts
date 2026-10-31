import { Types } from 'mongoose';
import { UserModel, type UserDoc } from '../models/user.model';
import type { AuthUser } from '../types/auth.schema';
import type { Role } from '../types/enums';

function toAuthUser(doc: UserDoc): AuthUser {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    role: doc.role as Role,
    isDemo: doc.isDemo,
  };
}

export interface UpsertUserInput {
  email: string;
  name: string;
  /** Applied on first insert only; an existing user keeps their role. */
  role: Role;
  isDemo?: boolean;
}

export interface GoogleUpsertInput {
  email: string;
  name: string;
  googleSub: string;
  role: Role;
}

const DUPLICATE_KEY = 11000;

export const userRepository = {
  async findById(id: string): Promise<AuthUser | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await UserModel.findById(id).lean<UserDoc | null>();
    return doc ? toAuthUser(doc) : null;
  },

  async findByEmail(email: string): Promise<AuthUser | null> {
    const doc = await UserModel.findOne({ email }).lean<UserDoc | null>();
    return doc ? toAuthUser(doc) : null;
  },

  /**
   * Google sign-in: link to an existing user by email or create one. Returns null when the existing account is
   * already linked to a DIFFERENT Google account (refuse rather than silently take it over).
   */
  async upsertFromGoogle(input: GoogleUpsertInput): Promise<AuthUser | null> {
    const existing = await UserModel.findOne({ email: input.email }).lean<UserDoc | null>();
    if (existing?.googleSub && existing.googleSub !== input.googleSub) return null;
    if (existing) {
      const doc = await UserModel.findOneAndUpdate(
        { _id: existing._id },
        { $set: { googleSub: input.googleSub, lastLoginAt: new Date() } },
        { new: true },
      ).lean<UserDoc | null>();
      return doc ? toAuthUser(doc) : null;
    }
    const doc = await UserModel.create({
      email: input.email,
      name: input.name,
      role: input.role,
      googleSub: input.googleSub,
      lastLoginAt: new Date(),
      isDemo: false,
    });
    return toAuthUser(doc.toObject() as UserDoc);
  },

  /** Create-or-update on login. `email` is in the filter, so Mongo inserts it automatically on upsert. */
  async upsertOnLogin(input: UpsertUserInput): Promise<AuthUser> {
    const run = (): Promise<UserDoc | null> =>
      UserModel.findOneAndUpdate(
        { email: input.email },
        {
          $set: { lastLoginAt: new Date() },
          $setOnInsert: { name: input.name, role: input.role, isDemo: input.isDemo ?? false },
        },
        { upsert: true, new: true },
      ).lean<UserDoc | null>();

    let doc: UserDoc | null;
    try {
      doc = await run();
    } catch (err) {
      // Two first-time logins racing on the unique email index: the loser simply retries as an update.
      if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
      doc = await run();
    }
    if (!doc) throw new Error('User upsert returned no document');
    return toAuthUser(doc);
  },
};
