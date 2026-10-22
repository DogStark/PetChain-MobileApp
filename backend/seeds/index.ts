import { cleanupSeedData, seed } from './seedData';
import { closePool } from '../src/db';

// CLI entry point: `ts-node backend/seeds/index.ts --preset standard --owners 5 --seed-blockchain --cleanup`
async function main() {
  const args = process.argv.slice(2);
  const config: Record<string, string | number | boolean> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.replace('--', '');
    const next = args[i + 1];

    if (key === 'cleanup') {
      config.cleanup = true;
      continue;
    }

    if (key === 'seed-blockchain') {
      config.seedBlockchain = true;
      continue;
    }

    if (next && !next.startsWith('--')) {
      if (['preset'].includes(key)) {
        config[key] = next;
        i += 1;
        continue;
      }

      const numericValue = Number(next);
      if (!Number.isNaN(numericValue)) {
        const configKey =
          key === 'owners'
            ? 'numOwners'
            : key === 'vets'
              ? 'numVets'
              : key === 'pets'
                ? 'petsPerOwner'
                : key === 'records'
                  ? 'recordsPerPet'
                  : key === 'appointments'
                    ? 'appointmentsPerPet'
                    : key === 'medications'
                      ? 'medicationsPerPet'
                      : null;

        if (configKey) {
          config[configKey] = numericValue;
          i += 1;
        }
      }
    }
  }

  try {
    await seed(config);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await closePool();
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

export { cleanupSeedData, seed };
