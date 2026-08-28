import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { ok, sendError } from '../../server/response';
import shelterIntegrationService, {
  type BrowseShelterPetsFilters,
  type ShelterProvider,
} from '../../services/shelterIntegrationService';

const router = express.Router();

router.get('/oauth/:provider', async (req, res) => {
  const provider = req.params.provider as ShelterProvider;
  if (!['petfinder', 'adopt-a-pet'].includes(provider)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Unknown shelter provider');
  }

  const redirectUri = typeof req.query.redirectUri === 'string' ? req.query.redirectUri : undefined;
  const result = await shelterIntegrationService.getOAuthAuthorizationUrl(provider, redirectUri);
  return res.json(ok(result));
});

router.get('/pets', async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const filters: BrowseShelterPetsFilters = {
    provider:
      query.provider && ['petfinder', 'adopt-a-pet'].includes(query.provider)
        ? (query.provider as ShelterProvider)
        : undefined,
    species:
      query.species && ['dog', 'cat', 'rabbit', 'other', 'all'].includes(query.species)
        ? (query.species as BrowseShelterPetsFilters['species'])
        : undefined,
    breed: query.breed,
    location: query.location,
    ageMinMonths: query.ageMinMonths ? Number(query.ageMinMonths) : undefined,
    ageMaxMonths: query.ageMaxMonths ? Number(query.ageMaxMonths) : undefined,
  };

  const pets = await shelterIntegrationService.browseAdoptablePets(filters);
  return res.json(ok(pets));
});

router.post('/adopt', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const body = req.body as {
    provider?: ShelterProvider;
    shelterPetId?: string;
  };

  if (!body.provider || !['petfinder', 'adopt-a-pet'].includes(body.provider)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'provider is required');
  }
  if (!body.shelterPetId?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'shelterPetId is required');
  }

  try {
    const result = await shelterIntegrationService.adoptPet({
      provider: body.provider,
      shelterPetId: body.shelterPetId.trim(),
      adopterUserId: req.user!.id,
    });
    return res.status(201).json(ok(result, 'Shelter pet adopted'));
  } catch (error) {
    return sendError(
      res,
      404,
      'NOT_FOUND',
      error instanceof Error ? error.message : 'Unable to adopt shelter pet',
    );
  }
});

export default router;
