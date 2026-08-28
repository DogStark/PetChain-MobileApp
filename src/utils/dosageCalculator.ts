import type { Species } from '../models/Pet';

export type DoseUnit = 'mg' | 'ml' | 'tablets';
export type DosageSafetyLevel = 'safe' | 'low' | 'high' | 'critical';

export interface DosageRange {
  minPerKg: number;
  maxPerKg: number;
  typicalPerKg: number;
}

export interface DrugRecord {
  id: string;
  name: string;
  drugClass: string;
  dosageBySpecies: Partial<Record<Species, DosageRange>>;
  defaultUnit: DoseUnit;
  concentration?: number;
  tabletStrength?: number;
  safetyWarnings: Partial<Record<Species, string[]>>;
  contraindications: Partial<Record<Species, string[]>>;
}

export interface DosageInput {
  weightKg: number;
  dosePerKg: number;
  targetUnit: DoseUnit;
  concentration?: number;
  tabletStrength?: number;
}

export interface DosageResult {
  dose: number;
  unit: DoseUnit;
  doseInMg: number;
  safetyLevel: DosageSafetyLevel;
  warnings: string[];
  rangeMin?: number;
  rangeMax?: number;
}

export const DRUG_DATABASE: DrugRecord[] = [
  {
    id: 'amoxicillin',
    name: 'Amoxicillin',
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
  },
  {
    id: 'metronidazole',
    name: 'Metronidazole',
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
  },
  {
    id: 'carprofen',
    name: 'Carprofen',
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
  },
  {
    id: 'meloxicam',
    name: 'Meloxicam',
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
  },
  {
    id: 'prednisone',
    name: 'Prednisone',
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
  },
  {
    id: 'enrofloxacin',
    name: 'Enrofloxacin',
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
  },
  {
    id: 'phenobarbital',
    name: 'Phenobarbital',
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
  },
  {
    id: 'doxycycline',
    name: 'Doxycycline',
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
  },
];

function round(n: number, decimals = 3): number {
  return parseFloat(n.toFixed(decimals));
}

export function calculateDoseInMg(weightKg: number, dosePerKg: number): number {
  if (weightKg <= 0 || dosePerKg <= 0) return 0;
  return weightKg * dosePerKg;
}

export function convertFromMg(
  amountMg: number,
  targetUnit: DoseUnit,
  concentration?: number,
  tabletStrength?: number,
): number {
  if (targetUnit === 'mg') return amountMg;
  if (targetUnit === 'ml') {
    if (!concentration || concentration <= 0) {
      throw new Error('Concentration (mg/ml) is required for milliliter conversion.');
    }
    return amountMg / concentration;
  }
  if (!tabletStrength || tabletStrength <= 0) {
    throw new Error('Tablet strength (mg/tablet) is required for tablet conversion.');
  }
  return amountMg / tabletStrength;
}

export function convertToMg(
  amount: number,
  fromUnit: DoseUnit,
  concentration?: number,
  tabletStrength?: number,
): number {
  if (fromUnit === 'mg') return amount;
  if (fromUnit === 'ml') {
    if (!concentration || concentration <= 0) {
      throw new Error('Concentration (mg/ml) is required for milliliter conversion.');
    }
    return amount * concentration;
  }
  if (!tabletStrength || tabletStrength <= 0) {
    throw new Error('Tablet strength (mg/tablet) is required for tablet conversion.');
  }
  return amount * tabletStrength;
}

export function assessDoseSafety(
  dosePerKg: number,
  range: DosageRange,
): { level: DosageSafetyLevel; warnings: string[] } {
  if (dosePerKg <= 0) {
    return { level: 'critical', warnings: ['Dose must be greater than zero.'] };
  }

  if (dosePerKg > range.maxPerKg * 2) {
    return {
      level: 'critical',
      warnings: [
        `Dose of ${dosePerKg.toFixed(2)} mg/kg is critically high (>${(range.maxPerKg * 2).toFixed(2)} mg/kg). Severe toxicity risk.`,
      ],
    };
  }

  if (dosePerKg > range.maxPerKg) {
    return {
      level: 'high',
      warnings: [
        `Dose of ${dosePerKg.toFixed(2)} mg/kg exceeds the maximum safe dose of ${range.maxPerKg} mg/kg.`,
      ],
    };
  }

  if (dosePerKg < range.minPerKg) {
    return {
      level: 'low',
      warnings: [
        `Dose of ${dosePerKg.toFixed(2)} mg/kg is below the minimum effective dose of ${range.minPerKg} mg/kg. Treatment may be sub-therapeutic.`,
      ],
    };
  }

  return { level: 'safe', warnings: [] };
}

export function computeDosage(input: DosageInput, range?: DosageRange): DosageResult {
  const { weightKg, dosePerKg, targetUnit, concentration, tabletStrength } = input;

  if (weightKg <= 0) {
    return {
      dose: 0,
      unit: targetUnit,
      doseInMg: 0,
      safetyLevel: 'critical',
      warnings: ['Weight must be greater than zero.'],
    };
  }
  if (dosePerKg <= 0) {
    return {
      dose: 0,
      unit: targetUnit,
      doseInMg: 0,
      safetyLevel: 'critical',
      warnings: ['Dose per kg must be greater than zero.'],
    };
  }

  const doseInMg = calculateDoseInMg(weightKg, dosePerKg);

  let dose: number;
  try {
    dose = convertFromMg(doseInMg, targetUnit, concentration, tabletStrength);
  } catch (err) {
    return {
      dose: 0,
      unit: targetUnit,
      doseInMg: round(doseInMg),
      safetyLevel: 'critical',
      warnings: [(err as Error).message],
    };
  }

  let safetyLevel: DosageSafetyLevel = 'safe';
  const warnings: string[] = [];

  if (range) {
    const safety = assessDoseSafety(dosePerKg, range);
    safetyLevel = safety.level;
    warnings.push(...safety.warnings);
  }

  const result: DosageResult = {
    dose: round(dose),
    unit: targetUnit,
    doseInMg: round(doseInMg),
    safetyLevel,
    warnings,
  };

  if (range) {
    const minMg = range.minPerKg * weightKg;
    const maxMg = range.maxPerKg * weightKg;
    try {
      result.rangeMin = round(convertFromMg(minMg, targetUnit, concentration, tabletStrength));
      result.rangeMax = round(convertFromMg(maxMg, targetUnit, concentration, tabletStrength));
    } catch {
      // omit range if unit conversion fails
    }
  }

  return result;
}

export function lookupDrug(
  drugId: string,
  species: Species,
): {
  drug: DrugRecord;
  range: DosageRange | null;
  warnings: string[];
  contraindications: string[];
} | null {
  const drug = DRUG_DATABASE.find((d) => d.id === drugId);
  if (!drug) return null;

  return {
    drug,
    range: drug.dosageBySpecies[species] ?? null,
    warnings: drug.safetyWarnings[species] ?? [],
    contraindications: drug.contraindications[species] ?? [],
  };
}

export function getDrugsForSpecies(species: Species): DrugRecord[] {
  return DRUG_DATABASE.filter((d) => d.dosageBySpecies[species] !== undefined);
}
