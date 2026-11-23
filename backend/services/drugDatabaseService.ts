import axios from 'axios';

export type Species = 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';
export type DoseUnit = 'mg' | 'ml' | 'tablets';

export interface DosageRange {
  minPerKg: number;
  maxPerKg: number;
  typicalPerKg: number;
}

export interface DrugRecord {
  id: string;
  name: string;
  genericName: string;
  drugClass: string;
  dosageBySpecies: Partial<Record<Species, DosageRange>>;
  defaultUnit: DoseUnit;
  concentration?: number;
  tabletStrength?: number;
  safetyWarnings: Partial<Record<Species, string[]>>;
  contraindications: Partial<Record<Species, string[]>>;
  vetVerified: boolean;
  lastUpdated: string;
}

export interface DrugLookupResult {
  drug: DrugRecord;
  range: DosageRange | null;
  warnings: string[];
  contraindications: string[];
}

const DRUG_DATABASE: DrugRecord[] = [
  {
    id: 'amoxicillin',
    name: 'Amoxicillin',
    genericName: 'amoxicillin trihydrate',
    drugClass: 'Antibiotic (Penicillin)',
    dosageBySpecies: {
      dog: { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
      cat: { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
    },
    defaultUnit: 'mg',
    tabletStrength: 250,
    safetyWarnings: {
      dog: ['May cause GI upset. Administer with food.'],
      cat: ['May cause GI upset. Administer with food.'],
      rabbit: ['CONTRAINDICATED — can cause fatal enterotoxemia.'],
    },
    contraindications: {
      rabbit: ['Fatal enterotoxemia risk in hindgut fermenters.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'metronidazole',
    name: 'Metronidazole',
    genericName: 'metronidazole',
    drugClass: 'Antibiotic / Antiprotozoal',
    dosageBySpecies: {
      dog: { minPerKg: 10, maxPerKg: 25, typicalPerKg: 15 },
      cat: { minPerKg: 10, maxPerKg: 25, typicalPerKg: 15 },
      rabbit: { minPerKg: 20, maxPerKg: 40, typicalPerKg: 20 },
    },
    defaultUnit: 'mg',
    tabletStrength: 250,
    safetyWarnings: {
      dog: ['Neurological signs at high doses. Avoid long-term use.'],
      cat: ['Neurological signs at high doses. Avoid long-term use.'],
    },
    contraindications: {
      dog: ['Avoid in pregnant animals.'],
      cat: ['Avoid in pregnant animals.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'carprofen',
    name: 'Carprofen',
    genericName: 'carprofen',
    drugClass: 'NSAID',
    dosageBySpecies: {
      dog: { minPerKg: 2.2, maxPerKg: 4.4, typicalPerKg: 4.4 },
    },
    defaultUnit: 'mg',
    tabletStrength: 25,
    safetyWarnings: {
      dog: [
        'Monitor for GI ulceration and renal/hepatic toxicity.',
        'Do not use concurrently with other NSAIDs or corticosteroids.',
      ],
    },
    contraindications: {
      cat: ['Not approved for cats. Consider meloxicam under vet supervision.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'meloxicam',
    name: 'Meloxicam',
    genericName: 'meloxicam',
    drugClass: 'NSAID',
    dosageBySpecies: {
      dog: { minPerKg: 0.1, maxPerKg: 0.2, typicalPerKg: 0.1 },
      cat: { minPerKg: 0.05, maxPerKg: 0.1, typicalPerKg: 0.05 },
      rabbit: { minPerKg: 0.3, maxPerKg: 0.6, typicalPerKg: 0.5 },
    },
    defaultUnit: 'ml',
    concentration: 1.5,
    safetyWarnings: {
      dog: ['Monitor renal function. Do not combine with other NSAIDs.'],
      cat: [
        'Extreme caution required. Renal toxicity risk.',
        'Single post-operative dose only without continuous monitoring.',
      ],
      rabbit: ['Monitor renal and hepatic function.'],
    },
    contraindications: {
      cat: ['Repeated dosing without close vet monitoring is dangerous.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'prednisone',
    name: 'Prednisone',
    genericName: 'prednisone',
    drugClass: 'Corticosteroid',
    dosageBySpecies: {
      dog: { minPerKg: 0.5, maxPerKg: 2.0, typicalPerKg: 1.0 },
      cat: { minPerKg: 1.0, maxPerKg: 2.0, typicalPerKg: 1.0 },
    },
    defaultUnit: 'mg',
    tabletStrength: 5,
    safetyWarnings: {
      dog: ['Taper dose on discontinuation. Long-term use causes Cushing-like effects.'],
      cat: ['Monitor for diabetes mellitus. Higher doses required than in dogs.'],
    },
    contraindications: {
      dog: ['Do not use concurrently with NSAIDs.'],
      cat: ['Do not use concurrently with NSAIDs.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'enrofloxacin',
    name: 'Enrofloxacin',
    genericName: 'enrofloxacin',
    drugClass: 'Fluoroquinolone Antibiotic',
    dosageBySpecies: {
      dog: { minPerKg: 5, maxPerKg: 20, typicalPerKg: 10 },
      cat: { minPerKg: 5, maxPerKg: 5, typicalPerKg: 5 },
      bird: { minPerKg: 10, maxPerKg: 30, typicalPerKg: 15 },
      rabbit: { minPerKg: 5, maxPerKg: 20, typicalPerKg: 10 },
    },
    defaultUnit: 'mg',
    tabletStrength: 22.7,
    safetyWarnings: {
      cat: [
        'CRITICAL: Strictly 5 mg/kg/day maximum. Higher doses cause retinal degeneration and permanent blindness.',
      ],
      bird: ['Use injectable form diluted for oral administration.'],
    },
    contraindications: {
      cat: ['DO NOT exceed 5 mg/kg — risk of permanent blindness.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'phenobarbital',
    name: 'Phenobarbital',
    genericName: 'phenobarbital',
    drugClass: 'Anticonvulsant / Barbiturate',
    dosageBySpecies: {
      dog: { minPerKg: 2, maxPerKg: 5, typicalPerKg: 2.5 },
      cat: { minPerKg: 2, maxPerKg: 4, typicalPerKg: 2.5 },
    },
    defaultUnit: 'mg',
    tabletStrength: 30,
    safetyWarnings: {
      dog: ['Monitor serum phenobarbital levels. Risk of hepatotoxicity with long-term use.'],
      cat: ['Monitor serum levels. May cause facial pruritus and sedation.'],
    },
    contraindications: {},
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
  {
    id: 'doxycycline',
    name: 'Doxycycline',
    genericName: 'doxycycline hyclate',
    drugClass: 'Antibiotic (Tetracycline)',
    dosageBySpecies: {
      dog: { minPerKg: 5, maxPerKg: 10, typicalPerKg: 5 },
      cat: { minPerKg: 5, maxPerKg: 10, typicalPerKg: 5 },
      bird: { minPerKg: 25, maxPerKg: 50, typicalPerKg: 25 },
      rabbit: { minPerKg: 2.5, maxPerKg: 4, typicalPerKg: 2.5 },
    },
    defaultUnit: 'mg',
    tabletStrength: 100,
    safetyWarnings: {
      dog: ['Always administer with water to prevent esophageal stricture.'],
      cat: [
        'NEVER give as dry tablet — risk of esophageal stricture.',
        'Always follow immediately with water or food.',
      ],
      bird: ['Formulate as medicated water or food for avian administration.'],
    },
    contraindications: {
      cat: ['Dry tablet administration without water is contraindicated.'],
    },
    vetVerified: true,
    lastUpdated: '2024-01-01',
  },
];

export function getDrugDatabase(): DrugRecord[] {
  return DRUG_DATABASE;
}

export function getDrugById(id: string): DrugRecord | undefined {
  return DRUG_DATABASE.find((d) => d.id === id);
}

export function lookupDrug(drugId: string, species: Species): DrugLookupResult | null {
  const drug = getDrugById(drugId);
  if (!drug) return null;

  const range = drug.dosageBySpecies[species] ?? null;
  const warnings = [...(drug.safetyWarnings[species] ?? [])];
  const contraindications = drug.contraindications[species] ?? [];

  if (!range) {
    warnings.push(`${drug.name} has no established dosage range for ${species}.`);
  }

  return { drug, range, warnings, contraindications };
}

export function getDrugsForSpecies(species: Species): DrugRecord[] {
  return DRUG_DATABASE.filter((d) => d.dosageBySpecies[species] !== undefined);
}

export interface DrugSearchResult {
  drug: DrugRecord;
  /** Suggested dose amounts (in `unit`) for the drug's tablet strength. */
  dosageOptions: string[];
  unit: DoseUnit;
  /** Suggested dosing intervals in hours between doses. */
  frequencyOptions: number[];
}

const DEFAULT_FREQUENCY_OPTIONS = [8, 12, 24];

function dosageOptionsFor(drug: DrugRecord): string[] {
  const strength = drug.tabletStrength;
  if (strength === undefined) return [];
  const options = [strength, strength / 2, strength * 2].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return Array.from(new Set(options.map((value) => `${Number(value.toFixed(2))}${drug.defaultUnit}`)));
}

/**
 * Offline autocomplete over the bundled drug database. Matches on brand name,
 * generic name and drug class, ranked by name prefix, then name substring.
 */
export function searchDrugs(query: string, limit = 8): DrugSearchResult[] {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return [];

  const scored = DRUG_DATABASE.map((drug) => {
    const name = drug.name.toLowerCase();
    const generic = drug.genericName.toLowerCase();
    let score = -1;
    if (name.startsWith(term)) score = 0;
    else if (generic.startsWith(term)) score = 1;
    else if (name.includes(term)) score = 2;
    else if (generic.includes(term)) score = 3;
    else if (drug.drugClass.toLowerCase().includes(term)) score = 4;
    return { drug, score };
  })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.drug.name.localeCompare(b.drug.name));

  return scored.slice(0, limit).map(({ drug }) => ({
    drug,
    dosageOptions: dosageOptionsFor(drug),
    unit: drug.defaultUnit,
    frequencyOptions: DEFAULT_FREQUENCY_OPTIONS,
  }));
}

export function getSafetyWarnings(drugId: string, species: Species, dosePerKg: number): string[] {
  const result = lookupDrug(drugId, species);
  if (!result) return [`Unknown drug: ${drugId}`];

  const warnings = [...result.warnings, ...result.contraindications];

  if (result.range) {
    if (dosePerKg > result.range.maxPerKg * 2) {
      warnings.unshift(
        `CRITICAL: ${dosePerKg} mg/kg is more than double the maximum safe dose (${result.range.maxPerKg} mg/kg). Severe toxicity risk.`,
      );
    } else if (dosePerKg > result.range.maxPerKg) {
      warnings.unshift(
        `WARNING: ${dosePerKg} mg/kg exceeds the maximum safe dose of ${result.range.maxPerKg} mg/kg.`,
      );
    } else if (dosePerKg < result.range.minPerKg) {
      warnings.unshift(
        `NOTE: ${dosePerKg} mg/kg is below the minimum effective dose of ${result.range.minPerKg} mg/kg.`,
      );
    }
  }

  return warnings;
}

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';

export async function fetchDrugInfo(
  drugId: string,
  species?: Species,
): Promise<DrugLookupResult | null> {
  try {
    const url = species
      ? `${API_URL}/drugs/${encodeURIComponent(drugId)}?species=${encodeURIComponent(species)}`
      : `${API_URL}/drugs/${encodeURIComponent(drugId)}`;
    const { data } = await axios.get<DrugLookupResult>(url);
    return data;
  } catch {
    return species ? lookupDrug(drugId, species) : null;
  }
}

export async function fetchAllDrugsForSpecies(species: Species): Promise<DrugRecord[]> {
  try {
    const { data } = await axios.get<DrugRecord[]>(
      `${API_URL}/drugs?species=${encodeURIComponent(species)}`,
    );
    return data;
  } catch {
    return getDrugsForSpecies(species);
  }
}
