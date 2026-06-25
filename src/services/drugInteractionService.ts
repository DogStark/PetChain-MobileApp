/**
 * Drug Interaction Checker — Issue #335
 *
 * Checks for known interactions between veterinary medications.
 * Caches results locally for offline use. Vets can override warnings.
 */

import * as SecureStore from 'expo-secure-store';

import { getDrugById, type Species } from '../../backend/services/drugDatabaseService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type InteractionSeverity = 'mild' | 'moderate' | 'severe' | 'contraindicated';

export interface DrugInteraction {
  drugA: string;
  drugB: string;
  severity: InteractionSeverity;
  description: string;
  recommendation: string;
}

export interface InteractionCheckResult {
  hasInteractions: boolean;
  interactions: DrugInteraction[];
  overriddenBy?: string; // vet name/id who overrode
  overrideJustification?: string;
}

export interface VetOverride {
  drugA: string;
  drugB: string;
  vetId: string;
  justification: string;
  timestamp: string;
}

// ─── Known interaction database ───────────────────────────────────────────────

const KNOWN_INTERACTIONS: DrugInteraction[] = [
  {
    drugA: 'carprofen',
    drugB: 'prednisone',
    severity: 'severe',
    description:
      'Concurrent NSAID and corticosteroid use significantly increases risk of GI ulceration and perforation.',
    recommendation: 'Avoid concurrent use. If necessary, use GI protectants and monitor closely.',
  },
  {
    drugA: 'meloxicam',
    drugB: 'prednisone',
    severity: 'severe',
    description:
      'Concurrent NSAID and corticosteroid use significantly increases risk of GI ulceration.',
    recommendation: 'Avoid concurrent use. Consider alternative pain management.',
  },
  {
    drugA: 'carprofen',
    drugB: 'meloxicam',
    severity: 'severe',
    description: 'Concurrent use of two NSAIDs greatly increases risk of GI and renal toxicity.',
    recommendation: 'Never use two NSAIDs concurrently.',
  },
  {
    drugA: 'phenobarbital',
    drugB: 'metronidazole',
    severity: 'moderate',
    description: 'Metronidazole may increase phenobarbital levels, raising risk of CNS toxicity.',
    recommendation: 'Monitor phenobarbital serum levels closely if co-administered.',
  },
  {
    drugA: 'enrofloxacin',
    drugB: 'doxycycline',
    severity: 'mild',
    description:
      'Combining two broad-spectrum antibiotics may increase risk of resistance and GI upset.',
    recommendation: 'Use only when culture results justify dual therapy.',
  },
  {
    drugA: 'amoxicillin',
    drugB: 'doxycycline',
    severity: 'mild',
    description:
      'Bacteriostatic (doxycycline) may reduce efficacy of bactericidal (amoxicillin) antibiotics.',
    recommendation: 'Avoid concurrent use unless specifically indicated.',
  },
  {
    drugA: 'carprofen',
    drugB: 'enrofloxacin',
    severity: 'contraindicated',
    description:
      'Concurrent NSAID and fluoroquinolone use in renally compromised patients carries a high risk of acute kidney injury.',
    recommendation:
      'Do NOT administer concurrently. Discontinue one agent before starting the other. Consult a veterinarian immediately.',
  },
];

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_KEY = 'com.petchain.drug.interactions.cache';
const OVERRIDE_KEY = 'com.petchain.drug.interactions.overrides';

async function getCachedInteractions(): Promise<DrugInteraction[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    if (!raw) return null;
    const { data, expiresAt } = JSON.parse(raw) as { data: DrugInteraction[]; expiresAt: number };
    if (Date.now() > expiresAt) return null;
    return data;
  } catch {
    return null;
  }
}

async function cacheInteractions(interactions: DrugInteraction[]): Promise<void> {
  try {
    const payload = { data: interactions, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // non-fatal
  }
}

async function getStoredOverrides(): Promise<VetOverride[]> {
  try {
    const raw = await SecureStore.getItemAsync(OVERRIDE_KEY);
    return raw ? (JSON.parse(raw) as VetOverride[]) : [];
  } catch {
    return [];
  }
}

// ─── Core logic ───────────────────────────────────────────────────────────────

function normalise(name: string): string {
  return name.toLowerCase().trim();
}

function findInteraction(drugA: string, drugB: string): DrugInteraction | undefined {
  const a = normalise(drugA);
  const b = normalise(drugB);
  return KNOWN_INTERACTIONS.find(
    (i) =>
      (normalise(i.drugA) === a && normalise(i.drugB) === b) ||
      (normalise(i.drugA) === b && normalise(i.drugB) === a),
  );
}

/**
 * Check if adding `newDrug` to `existingDrugs` causes any interactions.
 * Falls back to local database when offline.
 */
export async function checkDrugInteractions(
  newDrug: string,
  existingDrugs: string[],
  _species?: Species,
): Promise<InteractionCheckResult> {
  const cached = await getCachedInteractions();
  const interactionDb = cached ?? KNOWN_INTERACTIONS;

  if (!cached) {
    await cacheInteractions(KNOWN_INTERACTIONS);
  }

  const interactions: DrugInteraction[] = [];

  for (const existing of existingDrugs) {
    const a = normalise(newDrug);
    const b = normalise(existing);
    const hit = interactionDb.find(
      (i) =>
        (normalise(i.drugA) === a && normalise(i.drugB) === b) ||
        (normalise(i.drugA) === b && normalise(i.drugB) === a),
    );
    if (hit) interactions.push(hit);
  }

  // Also check by drug class (NSAID + corticosteroid)
  const newDrugRecord = getDrugById(normalise(newDrug));
  if (newDrugRecord) {
    for (const existing of existingDrugs) {
      const existingRecord = getDrugById(normalise(existing));
      if (!existingRecord) continue;
      const isNSAID = (r: typeof newDrugRecord) => r.drugClass.includes('NSAID');
      const isCorticosteroid = (r: typeof newDrugRecord) => r.drugClass.includes('Corticosteroid');
      if (
        (isNSAID(newDrugRecord) && isCorticosteroid(existingRecord)) ||
        (isCorticosteroid(newDrugRecord) && isNSAID(existingRecord))
      ) {
        const alreadyFound = interactions.some(
          (i) =>
            (normalise(i.drugA) === normalise(newDrug) &&
              normalise(i.drugB) === normalise(existing)) ||
            (normalise(i.drugA) === normalise(existing) &&
              normalise(i.drugB) === normalise(newDrug)),
        );
        if (!alreadyFound) {
          interactions.push({
            drugA: newDrug,
            drugB: existing,
            severity: 'severe',
            description: 'NSAID combined with corticosteroid increases GI ulceration risk.',
            recommendation: 'Avoid concurrent use. Consult vet.',
          });
        }
      }
    }
  }

  return { hasInteractions: interactions.length > 0, interactions };
}

/**
 * Record a vet override for a known interaction.
 */
export async function recordVetOverride(override: Omit<VetOverride, 'timestamp'>): Promise<void> {
  const overrides = await getStoredOverrides();
  overrides.push({ ...override, timestamp: new Date().toISOString() });
  await SecureStore.setItemAsync(OVERRIDE_KEY, JSON.stringify(overrides));
}

/**
 * Check if a specific interaction has been overridden by a vet.
 */
export async function isInteractionOverridden(
  drugA: string,
  drugB: string,
): Promise<VetOverride | null> {
  const overrides = await getStoredOverrides();
  return (
    overrides.find(
      (o) =>
        (normalise(o.drugA) === normalise(drugA) && normalise(o.drugB) === normalise(drugB)) ||
        (normalise(o.drugA) === normalise(drugB) && normalise(o.drugB) === normalise(drugA)),
    ) ?? null
  );
}

/**
 * Get severity label for display.
 */
export function getSeverityLabel(severity: InteractionSeverity): string {
  return {
    mild: '⚠️ Mild',
    moderate: '🟠 Moderate',
    severe: '🔴 Severe',
    contraindicated: '🚫 Contraindicated',
  }[severity];
}

export { findInteraction };
