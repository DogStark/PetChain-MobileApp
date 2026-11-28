/**
 * One-time backfill of vet clinic coordinates (#1396).
 *
 * Geocodes every clinic that has an address but no lat/lng — both the
 * vet_profiles table (when present) and the in-process vet directory.
 * Usage: ts-node backend/scripts/backfillVetCoordinates.ts
 */
import { geocodeAddress } from '../services/geocodingService';
import { backfillVetCoordinates } from '../services/vetDirectoryService';
import { query } from '../src/db';

/** Nominatim allows at most 1 request per second. */
const DELAY_MS = Number(process.env.GEOCODING_DELAY_MS ?? 1100);

async function backfillDatabase(): Promise<number> {
  const table = await query(`SELECT to_regclass('public.vet_profiles') AS name`);
  if (!table.rows[0]?.name) return 0;

  const rows = await query(
    `SELECT id, address FROM vet_profiles
      WHERE (lat IS NULL OR lng IS NULL) AND address IS NOT NULL AND address <> ''`,
  );
  let updated = 0;
  for (const row of rows.rows) {
    const coords = await geocodeAddress(row.address);
    if (coords) {
      await query('UPDATE vet_profiles SET lat = $1, lng = $2 WHERE id = $3', [
        coords.lat,
        coords.lng,
        row.id,
      ]);
      updated += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  return updated;
}

if (require.main === module) {
  (async () => {
    const dbUpdated = await backfillDatabase();
    const memoryUpdated = await backfillVetCoordinates();
    console.log(JSON.stringify({ dbUpdated, memoryUpdated }, null, 2));
    process.exit(0);
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { backfillDatabase };
