/**
 * Static database of pet travel requirements per country.
 * Issue #123 — Pet Travel Health Certificate Generator
 *
 * Sources: USDA APHIS, EU Pet Travel Scheme, DEFRA, and official government portals.
 * Last verified: 2026-05-01. Always confirm with official sources before travel.
 */

import type { CountryTravelRequirements } from '../models/TravelCertificate';

export const COUNTRY_REQUIREMENTS: CountryTravelRequirements[] = [
  {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://www.gov.uk/bring-pet-to-great-britain',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        minWeeksBeforeTravel: 3,
        validForMonths: 36,
        mandatory: true,
        notes: 'Must be administered after microchipping',
      },
    ],
    healthChecks: [
      {
        checkType: 'tapeworm_treatment',
        description: 'Tapeworm treatment by a vet (dogs only)',
        maxDaysBeforeTravel: 5,
        mandatory: true,
      },
      {
        checkType: 'microchip',
        description: 'ISO 11784/11785 compliant microchip',
        mandatory: true,
      },
    ],
    documents: [
      {
        documentType: 'pet_health_certificate',
        description: 'Official veterinary health certificate (AHC)',
        mandatory: true,
        issuingAuthority: 'Official Veterinarian (OV)',
      },
    ],
    additionalNotes: 'Pet must enter via an approved route and port.',
  },
  {
    countryCode: 'DE',
    countryName: 'Germany',
    applicableSpecies: ['dog', 'cat', 'rabbit'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://ec.europa.eu/food/animals/pet-movement_en',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        minWeeksBeforeTravel: 3,
        validForMonths: 36,
        mandatory: true,
      },
    ],
    healthChecks: [
      {
        checkType: 'microchip',
        description: 'ISO 11784/11785 compliant microchip',
        mandatory: true,
      },
    ],
    documents: [
      {
        documentType: 'eu_pet_passport',
        description: 'EU Pet Passport or official health certificate',
        mandatory: true,
        issuingAuthority: 'Accredited Veterinarian',
      },
    ],
  },
  {
    countryCode: 'FR',
    countryName: 'France',
    applicableSpecies: ['dog', 'cat', 'rabbit'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://agriculture.gouv.fr/animaux-de-compagnie',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        minWeeksBeforeTravel: 3,
        validForMonths: 36,
        mandatory: true,
      },
    ],
    healthChecks: [
      {
        checkType: 'microchip',
        description: 'ISO 11784/11785 compliant microchip',
        mandatory: true,
      },
    ],
    documents: [
      {
        documentType: 'eu_pet_passport',
        description: 'EU Pet Passport or official health certificate',
        mandatory: true,
        issuingAuthority: 'Accredited Veterinarian',
      },
    ],
  },
  {
    countryCode: 'US',
    countryName: 'United States',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://www.aphis.usda.gov/pet-travel',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        minWeeksBeforeTravel: 0,
        validForMonths: 36,
        mandatory: true,
        notes: 'Required for dogs; cats recommended',
      },
    ],
    healthChecks: [
      {
        checkType: 'general_health_exam',
        description: 'General health examination by a licensed vet',
        maxDaysBeforeTravel: 10,
        mandatory: true,
      },
      {
        checkType: 'screwworm_inspection',
        description: 'Screwworm inspection (if traveling from affected countries)',
        mandatory: false,
      },
    ],
    documents: [
      {
        documentType: 'usda_health_certificate',
        description: 'USDA-endorsed health certificate (APHIS 7001)',
        mandatory: true,
        issuingAuthority: 'USDA-accredited veterinarian',
      },
    ],
    additionalNotes:
      'Dogs must be vaccinated against rabies if traveling from high-risk countries.',
  },
  {
    countryCode: 'AU',
    countryName: 'Australia',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://www.agriculture.gov.au/biosecurity-trade/cats-dogs',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        minWeeksBeforeTravel: 0,
        validForMonths: 12,
        mandatory: true,
      },
      {
        vaccineName: 'Leptospirosis',
        mandatory: false,
        notes: 'Recommended for dogs',
      },
    ],
    healthChecks: [
      {
        checkType: 'microchip',
        description: 'ISO 11784/11785 compliant microchip',
        mandatory: true,
      },
      {
        checkType: 'rabies_titre_test',
        description: 'Rabies neutralising antibody titre test (RNATT)',
        maxDaysBeforeTravel: 180,
        mandatory: true,
      },
      {
        checkType: 'parasite_treatment',
        description: 'Treatment for internal and external parasites',
        maxDaysBeforeTravel: 5,
        mandatory: true,
      },
    ],
    documents: [
      {
        documentType: 'import_permit',
        description: 'Import permit from Australian Department of Agriculture',
        mandatory: true,
        issuingAuthority: 'Australian Department of Agriculture',
      },
      {
        documentType: 'health_certificate',
        description: 'Official veterinary health certificate',
        mandatory: true,
        issuingAuthority: 'Government-accredited veterinarian',
      },
    ],
    additionalNotes: 'Australia has strict biosecurity laws. Quarantine period may apply.',
  },
  {
    countryCode: 'JP',
    countryName: 'Japan',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://www.maff.go.jp/aqs/english/animal/dog/index.html',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        minWeeksBeforeTravel: 0,
        validForMonths: 24,
        mandatory: true,
      },
    ],
    healthChecks: [
      {
        checkType: 'microchip',
        description: 'ISO 11784/11785 compliant microchip',
        mandatory: true,
      },
      {
        checkType: 'rabies_titre_test',
        description: 'Rabies antibody titre test (≥0.5 IU/mL)',
        maxDaysBeforeTravel: 180,
        mandatory: true,
      },
      {
        checkType: 'waiting_period',
        description: '180-day waiting period after titre test',
        mandatory: true,
      },
    ],
    documents: [
      {
        documentType: 'advance_notification',
        description: 'Advance notification to Animal Quarantine Service (40 days before arrival)',
        mandatory: true,
        issuingAuthority: 'Japan Animal Quarantine Service',
      },
      {
        documentType: 'health_certificate',
        description: 'Official veterinary health certificate',
        mandatory: true,
        issuingAuthority: 'Government-accredited veterinarian',
      },
    ],
    additionalNotes: 'Quarantine period of up to 180 days may apply if requirements are not met.',
  },
  {
    countryCode: 'CA',
    countryName: 'Canada',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://inspection.canada.ca/importing-food-plants-or-animals/pets',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        mandatory: true,
        notes: 'Required for dogs 3 months and older',
      },
    ],
    healthChecks: [
      {
        checkType: 'general_health_exam',
        description: 'General health examination',
        maxDaysBeforeTravel: 30,
        mandatory: false,
      },
    ],
    documents: [
      {
        documentType: 'rabies_vaccination_certificate',
        description: 'Rabies vaccination certificate signed by a licensed vet',
        mandatory: true,
        issuingAuthority: 'Licensed Veterinarian',
      },
    ],
  },
  {
    countryCode: 'SG',
    countryName: 'Singapore',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    officialReferenceUrl: 'https://www.nparks.gov.sg/avs/pets/bringing-animals-into-singapore',
    vaccinations: [
      {
        vaccineName: 'Rabies',
        mandatory: true,
        minWeeksBeforeTravel: 4,
        validForMonths: 36,
      },
      {
        vaccineName: 'Distemper',
        mandatory: true,
      },
      {
        vaccineName: 'Parvovirus',
        mandatory: true,
      },
    ],
    healthChecks: [
      {
        checkType: 'microchip',
        description: 'ISO 11784/11785 compliant microchip',
        mandatory: true,
      },
      {
        checkType: 'rabies_titre_test',
        description: 'Rabies antibody titre test',
        mandatory: true,
      },
    ],
    documents: [
      {
        documentType: 'import_licence',
        description: 'Import licence from AVS (Animals & Veterinary Service)',
        mandatory: true,
        issuingAuthority: 'Singapore AVS',
      },
      {
        documentType: 'health_certificate',
        description: 'Official veterinary health certificate',
        mandatory: true,
        issuingAuthority: 'Government-accredited veterinarian',
      },
    ],
    additionalNotes:
      'Quarantine period applies. Apply for import licence at least 30 days before travel.',
  },
];

/** Look up requirements for a given country code and species */
export function getCountryRequirements(
  countryCode: string,
  species?: string,
): CountryTravelRequirements | undefined {
  const req = COUNTRY_REQUIREMENTS.find(
    (r) => r.countryCode.toUpperCase() === countryCode.toUpperCase(),
  );
  if (!req) return undefined;
  if (species && req.applicableSpecies.length > 0) {
    const applies = req.applicableSpecies.includes(species.toLowerCase());
    if (!applies) return undefined;
  }
  return req;
}

/** Return all supported countries as { code, name } pairs */
export function getSupportedCountries(): { code: string; name: string }[] {
  return COUNTRY_REQUIREMENTS.map((r) => ({ code: r.countryCode, name: r.countryName }));
}
