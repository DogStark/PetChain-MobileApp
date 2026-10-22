/**
 * Third-party integration endpoints authenticated via API keys.
 */

import express from 'express';

import { authenticateApiKey } from '../../middleware/apiKeyAuth';
import { ok } from '../../server/response';
import { store } from '../../server/store';

const router = express.Router();

/** List pets (scoped integration access). */
router.get('/pets', authenticateApiKey('pets:read'), (_req, res) => {
  const pets = [...store.pets.values()].map((p) => ({
    id: p.id,
    name: p.name,
    species: p.species,
    breed: p.breed,
    ownerId: p.ownerId,
  }));
  return res.json(ok(pets));
});

export default router;
