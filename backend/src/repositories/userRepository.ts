import { query } from '../db';
import { BaseRepository } from './baseRepository';
import { type UserRole } from '../../models/UserRole';

export interface DBUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  is_email_verified: boolean;
  last_login_at?: Date;
  password_hash?: string;
  stellar_public_key?: string;
  created_at: Date;
  updated_at: Date;
}

export class UserRepository extends BaseRepository<DBUser> {
  protected tableName = 'users';

  async create(user: Partial<DBUser>): Promise<DBUser> {
    const { id, email, name, phone, role, is_email_verified, password_hash } = user;
    const res = await query(
      `INSERT INTO users (id, email, name, phone, role, is_email_verified, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, email, name, phone, role, is_email_verified ?? false, password_hash],
    );
    return res.rows[0];
  }

  async findByEmail(email: string): Promise<DBUser | null> {
    const res = await query(`SELECT * FROM users WHERE email = $1`, [email]);
    return res.rows[0] || null;
  }

  async update(id: string, updates: Partial<DBUser>): Promise<DBUser | null> {
    const fields = Object.keys(updates);
    if (fields.length === 0) return this.findById(id);

    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map((f) => (updates as Record<string, unknown>)[f]);

    const res = await query(`UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`, [
      id,
      ...values,
    ]);
    return res.rows[0] || null;
  }
}

export const userRepository = new UserRepository();
