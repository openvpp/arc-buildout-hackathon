import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  verifyPassword,
} from '@/server/infrastructure/auth/password-hash';

describe('password hash', () => {
  it('accepts the password that was hashed', async () => {
    const stored = await hashPassword('correct-horse');
    await expect(verifyPassword('correct-horse', stored)).resolves.toBe(true);
  });

  it('rejects a different password and a tampered hash', async () => {
    const stored = await hashPassword('correct-horse');
    await expect(verifyPassword('wrong-horse', stored)).resolves.toBe(false);
    await expect(verifyPassword('correct-horse', 'not-a-hash')).resolves.toBe(
      false,
    );
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    await expect(
      verifyPassword(
        'correct-horse',
        [scheme, '99999', r, p, salt, hash].join('$'),
      ),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        'correct-horse',
        [scheme, n, r, p, salt, `${hash}aa`].join('$'),
      ),
    ).resolves.toBe(false);
  });
});
