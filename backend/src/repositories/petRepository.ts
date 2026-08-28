import { query } from '../db';
import { BaseRepository } from './baseRepository';

export interface DBPet {
  id: string;
  name: string;
  species: string;
  breed?: string;
  date_of_birth?: Date;
  weight_kg?: number;
  microchip_id?: string;
  photo_url?: string;
  thumbnail_url?: string;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

export class PetRepository extends BaseRepository<DBPet> {
  protected tableName = 'pets';

  async create(pet: Partial<DBPet>): Promise<DBPet> {
    const {
      id,
      name,
      species,
      breed,
      date_of_birth,
      weight_kg,
      microchip_id,
      photo_url,
      thumbnail_url,
      owner_id,
    } = pet;
    const res = await query(
      `INSERT INTO pets (id, name, species, breed, date_of_birth, weight_kg, microchip_id, photo_url, thumbnail_url, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        name,
        species,
        breed,
        date_of_birth,
        weight_kg,
        microchip_id,
        photo_url,
        thumbnail_url,
        owner_id,
      ],
    );
    return res.rows[0];
  }

  async findByOwnerId(ownerId: string): Promise<DBPet[]> {
    const res = await query(`SELECT * FROM pets WHERE owner_id = $1`, [ownerId]);
    return res.rows;
  }

  async update(id: string, updates: Partial<DBPet>): Promise<DBPet | null> {
    const fields = Object.keys(updates);
    if (fields.length === 0) return this.findById(id);

    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map((f) => (updates as Record<string, unknown>)[f]);

    const res = await query(`UPDATE pets SET ${setClause} WHERE id = $1 RETURNING *`, [
      id,
      ...values,
    ]);
    return res.rows[0] || null;
  }
}

export const petRepository = new PetRepository();
