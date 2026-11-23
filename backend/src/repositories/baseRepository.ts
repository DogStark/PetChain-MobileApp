import { query } from '../db';

export abstract class BaseRepository<T> {
  protected abstract tableName: string;

  async findAll(): Promise<T[]> {
    const res = await query(`SELECT * FROM ${this.tableName} WHERE deleted_at IS NULL`);
    return res.rows;
  }

  async findById(id: string): Promise<T | null> {
    const res = await query(`SELECT * FROM ${this.tableName} WHERE id = $1 AND deleted_at IS NULL`, [
      id,
    ]);
    return res.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const res = await query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
