import { Types } from 'mongoose';
import { UserModel } from '../models/user.model';
import type { ProfilePatch } from '../types/profile.schema';
import { NotFoundError } from '../utils/errors';

export interface ProfileDto {
  name: string;
  avatar: string | null;
  preferences: Record<string, unknown>;
}

/** PURE. Turns a patch into a Mongo update. Preferences are merged key by key so saving one switch never wipes the others. */
export function buildProfileUpdate(patch: ProfilePatch): Record<string, Record<string, unknown>> {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  if (patch.name !== undefined) $set['name'] = patch.name;
  if (patch.avatar === null) $unset['avatar'] = '';
  else if (patch.avatar !== undefined) $set['avatar'] = patch.avatar;
  for (const [key, value] of Object.entries(patch.preferences ?? {})) {
    if (value !== undefined) $set[`preferences.${key}`] = value;
  }
  const update: Record<string, Record<string, unknown>> = {};
  if (Object.keys($set).length > 0) update['$set'] = $set;
  if (Object.keys($unset).length > 0) update['$unset'] = $unset;
  return update;
}

async function get(userId: string): Promise<ProfileDto> {
  const u = await UserModel.findById(userId).select({ name: 1, avatar: 1, preferences: 1 }).lean<{ name: string; avatar?: string; preferences?: Record<string, unknown> } | null>();
  if (!u) throw new NotFoundError('User not found');
  return { name: u.name, avatar: u.avatar ?? null, preferences: u.preferences ?? {} };
}

async function save(userId: string, patch: ProfilePatch): Promise<ProfileDto> {
  const update = buildProfileUpdate(patch);
  if (Object.keys(update).length > 0) await UserModel.updateOne({ _id: new Types.ObjectId(userId) }, update);
  return get(userId);
}

export const profileService = { get, save };
