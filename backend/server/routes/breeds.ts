import express from 'express';

import { breedDatabase } from '../../src/data/breeds';
import { ok } from '../response';

const router = express.Router();

router.get('/', (req, res) => {
  const query = String(req.query.q ?? '')
    .trim()
    .toLowerCase();
  const matches = query
    ? breedDatabase.filter((breed) => breed.name.toLowerCase().includes(query))
    : breedDatabase;

  const result = matches.slice(0, 500).map((breed) => ({
    id: breed.id,
    name: breed.name,
    species: breed.species,
    lifeExpectancyYears: breed.lifeExpectancyYears,
    commonHealthConditions: breed.commonHealthConditions,
    careRecommendations: breed.careRecommendations,
  }));

  return res.json(ok(result));
});

export default router;
