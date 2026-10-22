import { query } from '../db';
import { BaseRepository } from './baseRepository';
import type { GrantRole } from '../../models/AccessGrant';

export interface DBAccessGrant {
  id: string;
  owner_id: string;
  grantee_id: string;
  pet_id: string;
  role: GrantRole;
  token_hash: string;
  expires_at: Date;
  revoked_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class AccessGrantRepository extends BaseRepository<DBAccessGrant> {
  protected tableName = 'access_grants';

  async findByTokenHash(tokenHash: string): Promise<DBAccessGrant | null> {
    const res = await query(`SELECT * FROM ${this.tableName} WHERE token_hash = $1`, [tokenHash]);
    return res.rows[0] || null;
  }

  async findByOwnerId(ownerId: string): Promise<DBAccessGrant[]> {
    const res = await query(
      `SELECT * FROM ${this.tableName} WHERE owner_id = $1 ORDER BY created_at DESC`,
      [ownerId],
    );
    return res.rows;
  }

  async findByPetId(petId: string): Promise<DBAccessGrant[]> {
    const res = await query(
      `SELECT * FROM ${this.tableName} WHERE pet_id = $1 ORDER BY created_at DESC`,
      [petId],
    );
    return res.rows;
  }

  async create(grant: {
    id: string;
    owner_id: string;
    grantee_id: string;
    pet_id: string;
    role: GrantRole;
    token_hash: string;
    expires_at: string;
    revoked_at?: string | null;
    created_at: string;
    updated_at: string;
  }): Promise<DBAccessGrant> {
    const res = await query(
      `INSERT INTO ${this.tableName}
         (id, owner_id, grantee_id, pet_id, role, token_hash, expires_at, revoked_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        grant.id,
        grant.owner_id,
        grant.grantee_id,
        grant.pet_id,
        grant.role,
        grant.token_hash,
        grant.expires_at,
        grant.revoked_at || null,
        grant.created_at,
        grant.updated_at,
      ],
    );
    return res.rows[0];
  }

  async update(id: string, updates: Partial<DBAccessGrant>): Promise<DBAccessGrant | null> {
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return this.findById(id) as Promise<DBAccessGrant | null>;
    }

    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = fields.map((field) => (updates as Record<string, unknown>)[field]);

    const res = await query(`UPDATE ${this.tableName} SET ${setClause} WHERE id = $1 RETURNING *`, [
      id,
      ...values,
    ]);
    return res.rows[0] || null;
  }
}

export const accessGrantRepository = new AccessGrantRepository();
