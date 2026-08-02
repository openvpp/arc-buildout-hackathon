import { eq } from 'drizzle-orm';

import type {
  PrincipalRecord,
  PrincipalRepository,
} from '@/server/domain/shared/ports';

import { principals } from '../schema';
import type { DbOrTx } from '../transaction';

function mapPrincipal(row: typeof principals.$inferSelect): PrincipalRecord {
  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrincipalRepository(db: DbOrTx): PrincipalRepository {
  return {
    async create(input) {
      const [row] = await db
        .insert(principals)
        .values({
          type: input.type,
          displayName: input.displayName,
        })
        .returning();

      if (row === undefined) {
        throw new Error('Failed to insert principal');
      }

      return mapPrincipal(row);
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(principals)
        .where(eq(principals.id, id))
        .limit(1);

      return row === undefined ? null : mapPrincipal(row);
    },
  };
}
