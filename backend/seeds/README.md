# PetChain Database Seeding

This directory contains the database seeding system for PetChain development and testing. It generates realistic test data including sample users, pets, medical records, appointments, and medications.

## Overview

The seeding system creates:
- **Sample Users**: Pet owners and veterinarians with realistic profiles
- **Sample Pets**: Dogs, cats, rabbits, and birds with varied breeds and characteristics
- **Medical Records**: Checkups, vaccinations, surgeries, and treatments
- **Appointments**: Scheduled vet appointments with various statuses
- **Medications**: Active and completed medication schedules

## Quick Start

### Run with Default Configuration

```bash
# Using ts-node
ts-node backend/seeds/index.ts

# Using npm script (if configured)
npm run seed
```

This creates:
- 5 pet owners
- 3 veterinarians
- 2 pets per owner (10 total)
- 3 medical records per pet (30 total)
- 2 appointments per pet (20 total)
- 1 medication per pet (10 total)

### Run with Custom Configuration

```bash
# Create 10 owners with 3 pets each
ts-node backend/seeds/index.ts --owners 10 --pets 3

# Create 5 vets
ts-node backend/seeds/index.ts --vets 5

# Create 5 medical records per pet
ts-node backend/seeds/index.ts --records 5

# Create 3 appointments per pet
ts-node backend/seeds/index.ts --appointments 3

# Create 2 medications per pet
ts-node backend/seeds/index.ts --medications 2

# Combine multiple options
ts-node backend/seeds/index.ts --owners 8 --vets 4 --pets 2 --records 4 --appointments 3 --medications 2
```

## Configuration Options

| Option | Flag | Default | Description |
|--------|------|---------|-------------|
| Owners | `--owners` | 5 | Number of pet owner users to create |
| Vets | `--vets` | 3 | Number of veterinarian users to create |
| Pets per Owner | `--pets` | 2 | Number of pets each owner will have |
| Records per Pet | `--records` | 3 | Number of medical records per pet |
| Appointments per Pet | `--appointments` | 2 | Number of appointments per pet |
| Medications per Pet | `--medications` | 1 | Number of medications per pet |

## Programmatic Usage

You can also use the seeding system programmatically in your code:

```typescript
import { seed } from './backend/seeds/seedData';

// Run with default configuration
await seed();

// Run with custom configuration
await seed({
  numOwners: 10,
  numVets: 5,
  petsPerOwner: 3,
  recordsPerPet: 5,
  appointmentsPerPet: 3,
  medicationsPerPet: 2,
});
```

## Data Generated

### Users

**Owners:**
- Random first and last names
- Email format: `firstname.lastname{random}@example.com`
- Random phone numbers
- Role: `owner`
- Email verified: `true`

**Veterinarians:**
- Random first and last names with "Dr." prefix
- Email format: `firstname.lastname{random}@vetclinic.com`
- Random phone numbers
- Role: `vet`
- Email verified: `true`

### Pets

- Random names from predefined list
- Species: dog, cat, rabbit, or bird
- Breed: Appropriate for species
- Date of birth: Random date within last 10 years
- Microchip ID: Random format `CHIP-{random}`
- Owner: Randomly assigned to created owners

### Medical Records

- Type: checkup, vaccination, surgery, treatment, or other
- Diagnosis: Realistic diagnoses (e.g., "Annual wellness exam", "Ear infection")
- Treatment: Realistic treatments (e.g., "Prescribed antibiotics")
- Visit date: Random date within last 180 days
- Next visit date: Calculated as 1 year after visit date

### Appointments

- Type: Routine checkup, vaccination, dental, or follow-up
- Status: Pending, confirmed, or completed
- Date: Random future date (within 60 days)
- Time: Random time between 8 AM and 5 PM
- Duration: 30 minutes
- Vet: Randomly assigned from created vets

### Medications

- Name: Common pet medications (Amoxicillin, Prednisone, Gabapentin, etc.)
- Dosage: Random between 5mg and 500mg
- Frequency: Once daily, twice daily, every other day, or as needed
- Start date: Random date within last 90 days
- Duration: Random between 7 and 90 days
- Status: Active or completed

## Testing

Run the test suite to verify seeding functionality:

```bash
# Run all seed tests
npm test -- backend/seeds/__tests__/seedData.test.ts

# Run with coverage
npm test -- --coverage backend/seeds/__tests__/seedData.test.ts
```

### Test Coverage

The test suite verifies:
- ✅ Seed runs without errors
- ✅ Correct number of records created
- ✅ Valid user roles (owner, vet)
- ✅ Valid pet species
- ✅ Valid medical record types
- ✅ Valid appointment statuses
- ✅ Valid medication statuses
- ✅ Referential integrity (no orphaned records)
- ✅ Valid timestamps on all records
- ✅ Custom configuration handling

## Database Requirements

The seeding system requires:
- PostgreSQL database with PetChain schema
- All migrations applied (run `npm run migrate` first)
- Valid `DATABASE_URL` environment variable

## Environment Setup

### Development

```bash
# Set DATABASE_URL
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/petchain"

# Run migrations
npm run migrate

# Run seeding
npm run seed
```

### Docker

```bash
# Start PostgreSQL
docker run -d \
  --name petchain-db \
  -e POSTGRES_DB=petchain \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15

# Run migrations and seeding
npm run migrate
npm run seed
```

## Acceptance Criteria

✅ **Seed runs correctly**
- No errors during execution
- All data types created successfully
- Proper logging output

✅ **Data is usable**
- All records have valid relationships
- No orphaned data
- Timestamps are valid
- Roles and statuses are valid
- Can query data via API endpoints

✅ **Flexible configuration**
- Default configuration works out of the box
- Custom parameters accepted via CLI
- Programmatic API available

## Troubleshooting

### "No DATABASE_URL provided"

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/petchain"
```

### "Migrations not applied"

```bash
npm run migrate
```

### "Foreign key constraint violation"

Ensure migrations have been run and the schema is up to date:

```bash
npm run migrate
```

### "Duplicate email error"

The seeding system generates random emails, but if you run it multiple times, you may get duplicates. Clear the data first:

```sql
DELETE FROM medications;
DELETE FROM appointments;
DELETE FROM medical_records;
DELETE FROM pets;
DELETE FROM users;
```

## Performance Notes

- Default configuration creates ~70 records total
- Typical execution time: 2-5 seconds
- Scales linearly with configuration size
- For large datasets (1000+ records), consider batch operations

## Future Enhancements

- [ ] Support for seeding community posts
- [ ] Support for seeding health metrics
- [ ] Support for seeding emergency contacts
- [ ] Support for seeding sync queue items
- [ ] Seed data export/import functionality
- [ ] Realistic data generation using Faker.js
- [ ] Seed data cleanup utilities
- [ ] Performance benchmarking

## Contributing

When adding new entities to the seeding system:

1. Add generator functions in `seedData.ts`
2. Add configuration options to `SeedConfig` interface
3. Add tests in `__tests__/seedData.test.ts`
4. Update this README with new data types
5. Ensure referential integrity is maintained
