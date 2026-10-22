/**
 * Backend country travel requirements database.
 * Issue #123 — Pet Travel Health Certificate Generator
 */

export interface VaccinationRequirement {
  vaccineName: string;
  minWeeksBeforeTravel?: number;
  validForMonths?: number;
  mandatory: boolean;
  notes?: string;
}

export interface HealthCheckRequirement {
  checkType: string;
  description: string;
  maxDaysBeforeTravel?: number;
  mandatory: boolean;
}

export interface DocumentRequirement {
  documentType: string;
  description: string;
  mandatory: boolean;
  issuingAuthority?: string;
}

export interface CountryTravelRequirements {
  countryCode: string;
  countryName: string;
  applicableSpecies: string[];
  vaccinations: VaccinationRequirement[];
  healthChecks: HealthCheckRequirement[];
  documents: DocumentRequirement[];
  lastUpdated: string;
  officialReferenceUrl?: string;
  additionalNotes?: string;
}

export const COUNTRY_REQUIREMENTS: CountryTravelRequirements[] = [
  {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
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
  },
  {
    countryCode: 'DE',
    countryName: 'Germany',
    applicableSpecies: ['dog', 'cat', 'rabbit'],
    lastUpdated: '2026-01-15',
    vaccinations: [
      { vaccineName: 'Rabies', minWeeksBeforeTravel: 3, validForMonths: 36, mandatory: true },
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
    vaccinations: [
      { vaccineName: 'Rabies', minWeeksBeforeTravel: 3, validForMonths: 36, mandatory: true },
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
    vaccinations: [
      {
        vaccineName: 'Rabies',
        mandatory: true,
        validForMonths: 36,
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
    ],
    documents: [
      {
        documentType: 'usda_health_certificate',
        description: 'USDA-endorsed health certificate (APHIS 7001)',
        mandatory: true,
        issuingAuthority: 'USDA-accredited veterinarian',
      },
    ],
  },
  {
    countryCode: 'AU',
    countryName: 'Australia',
    applicableSpecies: ['dog', 'cat'],
    lastUpdated: '2026-01-15',
    vaccinations: [{ vaccineName: 'Rabies', mandatory: true, validForMonths: 12 }],
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
    vaccinations: [{ vaccineName: 'Rabies', mandatory: true, validForMonths: 24 }],
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
    vaccinations: [
      { vaccineName: 'Rabies', mandatory: true, notes: 'Required for dogs 3 months and older' },
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
    vaccinations: [
      { vaccineName: 'Rabies', mandatory: true, minWeeksBeforeTravel: 4, validForMonths: 36 },
      { vaccineName: 'Distemper', mandatory: true },
      { vaccineName: 'Parvovirus', mandatory: true },
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
        description: 'Import licence from AVS',
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
    additionalNotes: 'Apply for import licence at least 30 days before travel.',
  },
];

export function getCountryRequirements(
  countryCode: string,
  species?: string,
): CountryTravelRequirements | undefined {
  const req = COUNTRY_REQUIREMENTS.find(
    (r) => r.countryCode.toUpperCase() === countryCode.toUpperCase(),
  );
  if (!req) return undefined;
  if (
    species &&
    req.applicableSpecies.length > 0 &&
    !req.applicableSpecies.includes(species.toLowerCase())
  ) {
    return undefined;
  }
  return req;
}

export function getSupportedCountries(): { code: string; name: string }[] {
  return COUNTRY_REQUIREMENTS.map((r) => ({ code: r.countryCode, name: r.countryName }));
}
