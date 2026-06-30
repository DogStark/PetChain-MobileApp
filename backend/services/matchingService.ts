import { query } from '../src/db/index';

export type LostFoundType = 'lost' | 'found';

export interface LostFoundLocation {
  latitude: number;
  longitude: number;
}

export interface LostFoundReport {
  id: string;
  type: LostFoundType;
  title: string;
  description: string;
  species: string;
  breed?: string;
  photoUrl?: string;
  location: LostFoundLocation;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

const POSTGIS_SRID = 4326;
const METERS_PER_KM = 1000;

export function haversineDistanceKm(a: LostFoundLocation, b: LostFoundLocation): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const r = 6371;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const underRoot = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return r * 2 * Math.atan2(Math.sqrt(underRoot), Math.sqrt(1 - underRoot));
}

export function isFoundReportExpired(report: LostFoundReport): boolean {
  if (report.type !== 'found' || !report.expiresAt) return false;
  return Date.now() > Date.parse(report.expiresAt);
}

function normalize(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function photoUrlsMatch(left?: string, right?: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const filename = (value: string) => value.replace(/^.*[\/]/, '').replace(/[?].*$/, '');
  return filename(a) === filename(b);
}

function hasSpeciesBreedMatch(a: LostFoundReport, b: LostFoundReport): boolean {
  if (normalize(a.species) !== normalize(b.species)) return false;
  const breedA = normalize(a.breed);
  const breedB = normalize(b.breed);
  return !breedA || !breedB || breedA === breedB;
}

function withinRadius(
  report: LostFoundReport,
  center: LostFoundLocation,
  radiusKm: number,
): boolean {
  return haversineDistanceKm(report.location, center) <= radiusKm;
}

async function queryPostgisMatches(
  report: LostFoundReport,
  radiusKm: number,
): Promise<LostFoundReport[] | undefined> {
  try {
    const result = await query(
      `
      SELECT
        id,
        type,
        title,
        description,
        species,
        breed,
        photo_url AS "photoUrl",
        owner_id AS "ownerId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        expires_at AS "expiresAt",
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
      FROM lost_found_reports
      WHERE type = $1
        AND id != $2
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_Point($3, $4), ${POSTGIS_SRID})::geography,
          $5
        )
    `,
      [
        report.type === 'lost' ? 'found' : 'lost',
        report.id,
        report.location.longitude,
        report.location.latitude,
        radiusKm * METERS_PER_KM,
      ],
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      type: String(row.type) as LostFoundType,
      title: String(row.title),
      description: String(row.description),
      species: String(row.species),
      breed: row.breed ? String(row.breed) : undefined,
      photoUrl: row.photoUrl ? String(row.photoUrl) : undefined,
      location: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
      },
      ownerId: String(row.ownerId),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      expiresAt: row.expiresAt ? String(row.expiresAt) : undefined,
    }));
  } catch {
    return undefined;
  }
}

export async function findNearbyMatches(
  report: LostFoundReport,
  candidates: LostFoundReport[],
  radiusKm = 30,
): Promise<LostFoundReport[]> {
  if (process.env.DATABASE_URL) {
    const dbMatches = await queryPostgisMatches(report, radiusKm);
    if (Array.isArray(dbMatches)) {
      return dbMatches.filter((candidate) => {
        if (!hasSpeciesBreedMatch(report, candidate)) return false;
        if (candidate.type === 'found' && isFoundReportExpired(candidate)) return false;
        return (
          withinRadius(candidate, report.location, radiusKm) ||
          photoUrlsMatch(report.photoUrl, candidate.photoUrl)
        );
      });
    }
  }

  return candidates.filter((candidate) => {
    if (candidate.type === report.type) return false;
    if (!hasSpeciesBreedMatch(report, candidate)) return false;
    if (candidate.type === 'found' && isFoundReportExpired(candidate)) return false;
    return (
      withinRadius(candidate, report.location, radiusKm) ||
      photoUrlsMatch(report.photoUrl, candidate.photoUrl)
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ADOPTION COMPATIBILITY SCORING
// ─────────────────────────────────────────────────────────────────────────────

export type HomeType = 'house_with_yard' | 'apartment' | 'condo' | 'farm' | 'other';
export type ActivityLevel = 'low' | 'moderate' | 'high' | 'very_high';

export interface AdopterProfile {
  userId: string;
  homeType: HomeType;
  hasYard: boolean;
  hasChildren: boolean;
  hasOtherPets: boolean;
  activityLevel: ActivityLevel;
  /** Breeds the adopter has experience with */
  experiencedBreeds: string[];
  /** Species the adopter has kept before */
  experiencedSpecies: string[];
  /** Max weekly hours the adopter can spend on grooming/exercise */
  weeklyTimeAvailableHours: number;
}

export interface PetRequirements {
  preferredHomeType?: HomeType[];
  requiresYard: boolean;
  goodWithChildren: boolean;
  goodWithOtherPets: boolean;
  /** Normalized energy level */
  energyLevel: ActivityLevel;
  species: string;
  breed?: string;
  /** Approximate grooming hours per week */
  weeklyGroomingHours: number;
  /** Approximate exercise hours per week */
  weeklyExerciseHours: number;
}

export interface MatchCriterion {
  label: string;
  matched: boolean;
  weight: number; // 0–1 contribution weight
  explanation: string;
}

export interface AdoptionMatchResult {
  score: number; // 0–100
  criteria: MatchCriterion[];
}

const ACTIVITY_RANK: Record<ActivityLevel, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  very_high: 4,
};

/**
 * Calculate a 0-100 adoption compatibility score between an adopter and a pet.
 * Each criterion is weighted; partial credit is given where applicable.
 */
export function computeAdoptionScore(
  adopter: AdopterProfile,
  pet: PetRequirements,
): AdoptionMatchResult {
  const criteria: MatchCriterion[] = [];

  // 1. Home type
  const homeTypeMatch =
    !pet.preferredHomeType || pet.preferredHomeType.includes(adopter.homeType);
  criteria.push({
    label: 'Home type',
    matched: homeTypeMatch,
    weight: 0.2,
    explanation: homeTypeMatch
      ? 'Your home type suits this pet perfectly.'
      : `This pet prefers ${pet.preferredHomeType?.join(' or ')}, but you have a ${adopter.homeType.replace(/_/g, ' ')}.`,
  });

  // 2. Yard
  const yardMatch = !pet.requiresYard || adopter.hasYard;
  criteria.push({
    label: 'Yard access',
    matched: yardMatch,
    weight: 0.15,
    explanation: yardMatch
      ? adopter.hasYard
        ? 'You have a yard — great for this pet.'
        : 'This pet does not require a yard.'
      : 'This pet needs outdoor yard access.',
  });

  // 3. Children
  const childrenMatch = !adopter.hasChildren || pet.goodWithChildren;
  criteria.push({
    label: 'Good with children',
    matched: childrenMatch,
    weight: 0.1,
    explanation: childrenMatch
      ? 'This pet is great with children.'
      : 'This pet may not be suitable for households with young children.',
  });

  // 4. Other pets
  const otherPetsMatch = !adopter.hasOtherPets || pet.goodWithOtherPets;
  criteria.push({
    label: 'Good with other pets',
    matched: otherPetsMatch,
    weight: 0.1,
    explanation: otherPetsMatch
      ? 'This pet gets along well with other animals.'
      : 'This pet prefers to be the only pet.',
  });

  // 5. Activity level — partial credit for adjacent levels
  const adopterRank = ACTIVITY_RANK[adopter.activityLevel];
  const petRank = ACTIVITY_RANK[pet.energyLevel];
  const activityDiff = Math.abs(adopterRank - petRank);
  const activityMatched = activityDiff === 0;
  const activityPartial = activityDiff <= 1;
  criteria.push({
    label: 'Activity level',
    matched: activityMatched,
    weight: activityPartial ? 0.2 * (1 - activityDiff * 0.4) : 0,
    explanation:
      activityDiff === 0
        ? 'Your activity level is a perfect match.'
        : activityDiff === 1
          ? 'Your activity level is close to what this pet needs.'
          : 'There is a significant mismatch in activity levels.',
  });

  // 6. Species experience
  const speciesExp = adopter.experiencedSpecies
    .map((s) => s.toLowerCase())
    .includes(pet.species.toLowerCase());
  criteria.push({
    label: 'Experience with species',
    matched: speciesExp,
    weight: 0.1,
    explanation: speciesExp
      ? `You have experience with ${pet.species}s.`
      : `This would be your first ${pet.species} — extra resources may be needed.`,
  });

  // 7. Breed experience
  const breedExp = pet.breed
    ? adopter.experiencedBreeds.map((b) => b.toLowerCase()).includes(pet.breed.toLowerCase())
    : true; // no breed specified → no penalty
  criteria.push({
    label: 'Experience with breed',
    matched: breedExp,
    weight: 0.1,
    explanation: breedExp
      ? pet.breed
        ? `You have experience with ${pet.breed}s.`
        : 'No specific breed requirements.'
      : `${pet.breed} can have unique traits — breed-specific knowledge helps.`,
  });

  // 8. Time availability
  const requiredHours = pet.weeklyGroomingHours + pet.weeklyExerciseHours;
  const timeMatch = adopter.weeklyTimeAvailableHours >= requiredHours;
  const timePartialWeight = timeMatch
    ? 0.05
    : Math.max(0, 0.05 * (adopter.weeklyTimeAvailableHours / Math.max(requiredHours, 1)));
  criteria.push({
    label: 'Time availability',
    matched: timeMatch,
    weight: timePartialWeight,
    explanation: timeMatch
      ? `You have enough time (${adopter.weeklyTimeAvailableHours}h/wk) for this pet.`
      : `This pet needs ~${requiredHours}h/wk but you have ${adopter.weeklyTimeAvailableHours}h/wk.`,
  });

  // Compute weighted score
  const totalWeight = criteria.reduce((sum, c) => sum + (c.matched ? c.weight : c.weight < 0.05 ? c.weight : 0), 0);
  // Cap the base weight sum to 1.0 then scale to 100
  const maxPossibleWeight = 1.0;
  const rawScore = Math.min(totalWeight / maxPossibleWeight, 1) * 100;

  return {
    score: Math.round(rawScore),
    criteria,
  };
}
