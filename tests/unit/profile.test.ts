import { describe, expect, it } from 'vitest';
import { buildProfileUpdate } from '../../src/services/profile.service';
import { profilePatchSchema } from '../../src/types/profile.schema';

describe('profile update', () => {
  it('merges preferences key by key', () => {
    expect(buildProfileUpdate({ preferences: { theme: 'light', blindMode: true } })).toEqual({ $set: { 'preferences.theme': 'light', 'preferences.blindMode': true } });
  });
  it('removes the photo when avatar is null', () => {
    expect(buildProfileUpdate({ avatar: null })).toEqual({ $unset: { avatar: '' } });
  });
  it('does nothing for an empty patch', () => {
    expect(buildProfileUpdate({})).toEqual({});
  });
  it('accepts a small image and rejects other content', () => {
    expect(profilePatchSchema.safeParse({ avatar: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ avatar: 'data:text/html;base64,PHNjcmlwdD4=' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ avatar: 'https://example.com/a.png' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ role: 'hr_admin' }).success).toBe(false);
  });
});
