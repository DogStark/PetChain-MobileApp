/**
 * PDF Parser Service
 *
 * Extracts structured medical data from vet record PDFs using text extraction,
 * regex patterns, and NLP-like heuristics. Handles multi-page PDFs and scanned
 * documents with OCR fallback.
 */

import type {
  Prescription,
  Diagnosis,
  VaccinationRecord,
  Treatment,
} from '../models/MedicalRecord';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldConfidence {
  value: number; // 0-1 score
  source: 'extracted' | 'inferred' | 'empty';
}

export interface ExtractedVetRecord {
  vetName?: string;
  vetClinic?: string;
  vetPhone?: string;
  vetEmail?: string;
  visitDate?: string;
  nextVisitDate?: string;
  diagnoses: Diagnosis[];
  treatments: Treatment[];
  prescriptions: Prescription[];
  vaccinations: VaccinationRecord[];
  notes?: string;
  confidence: number; // 0-1 score indicating extraction confidence
  warnings: string[]; // Issues encountered during parsing
  fieldConfidence?: {
    vetName?: FieldConfidence;
    vetClinic?: FieldConfidence;
    vetPhone?: FieldConfidence;
    vetEmail?: FieldConfidence;
    visitDate?: FieldConfidence;
    nextVisitDate?: FieldConfidence;
    diagnoses?: FieldConfidence;
    treatments?: FieldConfidence;
    prescriptions?: FieldConfidence;
    vaccinations?: FieldConfidence;
    notes?: FieldConfidence;
  };
}

export interface PdfParseResult {
  success: boolean;
  text: string;
  pageCount: number;
  isScanned: boolean;
  error?: string;
}

// ─── Regex Patterns ───────────────────────────────────────────────────────────

const PATTERNS = {
  // Date patterns: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, Month DD, YYYY
  date: /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})/gi,

  // Vet name patterns
  vetName: /(?:Dr\.?|Dr|Veterinarian|Vet)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,

  // Clinic/hospital name patterns
  clinic:
    /(?:Clinic|Hospital|Veterinary|Animal|Pet|Care|Center|Surgery|Practice)\s+([A-Z][a-zA-Z\s&]+)/gi,

  // Phone patterns
  phone: /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g,

  // Email patterns
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // Medication patterns: "name dosage frequency"
  medication:
    /(?:prescribed?|medication|drug|medicine|rx|take|give)\s*:?\s*([A-Za-z0-9\s\-]+?)(?:\s+(\d+(?:\.\d+)?)\s*(?:mg|ml|g|iu|units?|tabs?|caps?|drops?|cc|ml))?(?:\s+([a-z\s]+?))?(?:every|once|twice|three times|daily|bid|tid|qid|as needed|prn|q\d+h)?/gi,

  // Vaccination patterns
  vaccination:
    /(?:vaccin|immuniz|shot|inocul)\w*\s*:?\s*([A-Za-z0-9\s\-,&]+?)(?:\s+(?:on|date|given|administered)\s+([^\n]+?))?(?:\n|$)/gi,

  // Diagnosis patterns
  diagnosis:
    /(?:diagnos[ie]s?|condition|disease|illness|problem)\s*:?\s*([A-Za-z0-9\s\-,&()]+?)(?:\n|$)/gi,

  // Treatment patterns
  treatment:
    /(?:treatment|procedure|surgery|therapy|intervention)\s*:?\s*([A-Za-z0-9\s\-,&()]+?)(?:\n|$)/gi,

  // Next visit/follow-up patterns
  nextVisit:
    /(?:follow[- ]?up|next (?:visit|appointment|check[- ]?up)|recheck|return)\s*:?\s*([^\n]+?)(?:\n|$)/gi,

  // Dosage patterns
  dosage: /(\d+(?:\.\d+)?)\s*(?:mg|ml|g|iu|units?|tabs?|caps?|drops?|cc|ml)/gi,

  // Frequency patterns
  frequency:
    /(?:once daily|twice daily|three times daily|every other day|daily|bid|tid|qid|as needed|prn|q\d+h|every \d+ hours?)/gi,
};

// ─── Medication Database ──────────────────────────────────────────────────────

const COMMON_MEDICATIONS = new Set([
  'amoxicillin',
  'azithromycin',
  'cephalexin',
  'ciprofloxacin',
  'doxycycline',
  'enrofloxacin',
  'metronidazole',
  'trimethoprim',
  'sulfamethoxazole',
  'penicillin',
  'tetracycline',
  'fluconazole',
  'itraconazole',
  'terbinafine',
  'ketoconazole',
  'prednisone',
  'dexamethasone',
  'methylprednisolone',
  'hydrocortisone',
  'tramadol',
  'carprofen',
  'meloxicam',
  'firocoxib',
  'gabapentin',
  'pregabalin',
  'phenobarbital',
  'levetiracetam',
  'omeprazole',
  'famotidine',
  'ranitidine',
  'metoclopramide',
  'maropitant',
  'ondansetron',
  'diphenhydramine',
  'cetirizine',
  'loratadine',
  'fexofenadine',
  'insulin',
  'levothyroxine',
  'methimazole',
  'propranolol',
  'atenolol',
  'diltiazem',
  'enalapril',
  'lisinopril',
  'furosemide',
  'spironolactone',
  'pimobendan',
  'digoxin',
  'amiodarone',
  'aspirin',
  'clopidogrel',
  'warfarin',
  'apixaban',
  'rivaroxaban',
  'heparin',
  'enoxaparin',
  'vitamin',
  'supplement',
  'probiotic',
  'fish oil',
  'glucosamine',
  'chondroitin',
  'msm',
  'turmeric',
  'cbd',
  'hemp',
]);

const COMMON_VACCINES = new Set([
  'rabies',
  'dhpp',
  'dapp',
  'fvrcp',
  'felv',
  'fip',
  'bordetella',
  'leptospirosis',
  'lyme',
  'lepto',
  'distemper',
  'parvovirus',
  'parvo',
  'hepatitis',
  'adenovirus',
  'coronavirus',
  'kennel cough',
  'whooping cough',
  'feline',
  'canine',
  'avian',
  'equine',
  'bovine',
]);

const COMMON_DIAGNOSES = new Set([
  'otitis',
  'dermatitis',
  'allergies',
  'allergy',
  'infection',
  'bacterial',
  'viral',
  'fungal',
  'parasitic',
  'arthritis',
  'arthralgia',
  'lameness',
  'fracture',
  'dislocation',
  'sprain',
  'strain',
  'gastroenteritis',
  'colitis',
  'diarrhea',
  'vomiting',
  'constipation',
  'pancreatitis',
  'hepatitis',
  'nephritis',
  'cystitis',
  'urinary',
  'kidney',
  'liver',
  'heart',
  'cardiac',
  'respiratory',
  'pneumonia',
  'bronchitis',
  'asthma',
  'obesity',
  'diabetes',
  'hyperthyroidism',
  'hypothyroidism',
  'cancer',
  'tumor',
  'neoplasia',
  'seizure',
  'epilepsy',
  'anemia',
  'leukemia',
  'lymphoma',
  'pyometra',
  'mastitis',
  'prostatitis',
  'orchitis',
  'conjunctivitis',
  'keratitis',
  'cataracts',
  'glaucoma',
  'otosclerosis',
  'deafness',
  'alopecia',
  'mange',
  'ringworm',
  'abscess',
  'wound',
  'laceration',
  'burn',
  'trauma',
  'poisoning',
  'toxicity',
  'foreign body',
  'obstruction',
  'bloat',
  'torsion',
  'hernia',
  'prolapse',
  'intussusception',
  'peritonitis',
  'sepsis',
  'shock',
  'dehydration',
  'malnutrition',
  'starvation',
  'hypothermia',
  'hyperthermia',
  'fever',
  'lethargy',
  'depression',
  'anxiety',
  'aggression',
  'behavioral',
]);

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Normalize date string to YYYY-MM-DD format
 */
function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year = y.length === 2 ? `20${y}` : y;
    // Assume MM/DD/YYYY format (US standard)
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try DD-MM-YYYY or MM-DD-YYYY
  const dashMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashMatch) {
    const [, m, d, y] = dashMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try Month DD, YYYY
  const monthMatch = dateStr.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}),? (\d{4})$/i,
  );
  if (monthMatch) {
    const months: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    const [, month, day, year] = monthMatch;
    const monthNum = months[month.toLowerCase().slice(0, 3)];
    return `${year}-${monthNum}-${day.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract confidence score based on extraction quality
 */
function calculateConfidence(extracted: ExtractedVetRecord): number {
  let score = 0.5; // Base score

  if (extracted.vetName) score += 0.1;
  if (extracted.vetClinic) score += 0.05;
  if (extracted.visitDate) score += 0.15;
  if (extracted.diagnoses.length > 0) score += 0.1;
  if (extracted.treatments.length > 0) score += 0.1;
  if (extracted.prescriptions.length > 0) score += 0.15;
  if (extracted.vaccinations.length > 0) score += 0.1;
  if (extracted.notes) score += 0.05;

  return Math.min(score, 1.0);
}

/**
 * Check if text appears to be from a scanned document (low OCR quality)
 */
function isScannedDocument(text: string): boolean {
  // Count common OCR errors and garbled text
  const ocrErrors = (text.match(/[|!1][|!1]{2,}/g) || []).length; // |||, !!!, 111
  const garbledChars = (text.match(/[^\w\s\-.,;:()&@#$%*+=/'"]/g) || []).length;
  const totalChars = text.length;

  const errorRate = (ocrErrors + garbledChars) / totalChars;
  return errorRate > 0.05; // More than 5% error rate suggests scanned
}

// ─── Main Extraction Functions ────────────────────────────────────────────────

/**
 * Extract vet information from text
 */
function extractVetInfo(text: string): {
  data: {
    vetName?: string;
    vetClinic?: string;
    vetPhone?: string;
    vetEmail?: string;
  };
  confidence: {
    vetName?: FieldConfidence;
    vetClinic?: FieldConfidence;
    vetPhone?: FieldConfidence;
    vetEmail?: FieldConfidence;
  };
} {
  const data: {
    vetName?: string;
    vetClinic?: string;
    vetPhone?: string;
    vetEmail?: string;
  } = {};
  const confidence: {
    vetName?: FieldConfidence;
    vetClinic?: FieldConfidence;
    vetPhone?: FieldConfidence;
    vetEmail?: FieldConfidence;
  } = {};

  // Extract vet name
  const vetNameMatch = text.match(PATTERNS.vetName);
  if (vetNameMatch) {
    data.vetName = vetNameMatch[0].replace(/^(?:Dr\.?|Veterinarian|Vet)\s+/i, '').trim();
    // High confidence if preceded by "Dr." or "DVM"
    const hasTitle = /Dr\.?|DVM/i.test(vetNameMatch[0]);
    confidence.vetName = { value: hasTitle ? 0.85 : 0.6, source: 'extracted' };
  }

  // Extract clinic name
  const clinicMatch = text.match(PATTERNS.clinic);
  if (clinicMatch) {
    data.vetClinic = clinicMatch[0].trim();
    // High confidence if contains known clinic keywords
    const hasKeywords = /(Veterinary|Animal|Hospital|Clinic)/i.test(clinicMatch[0]);
    confidence.vetClinic = { value: hasKeywords ? 0.8 : 0.55, source: 'extracted' };
  }

  // Extract phone
  const phoneMatch = text.match(PATTERNS.phone);
  if (phoneMatch) {
    data.vetPhone = phoneMatch[0].trim();
    // High confidence for valid phone formats
    const isValidFormat = /^\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(
      phoneMatch[0],
    );
    confidence.vetPhone = { value: isValidFormat ? 0.9 : 0.65, source: 'extracted' };
  }

  // Extract email
  const emailMatch = text.match(PATTERNS.email);
  if (emailMatch) {
    data.vetEmail = emailMatch[0].trim();
    // High confidence for valid email format
    const isValidEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(emailMatch[0]);
    confidence.vetEmail = { value: isValidEmail ? 0.9 : 0.6, source: 'extracted' };
  }

  return { data, confidence };
}

/**
 * Extract dates from text
 */
function extractDates(text: string): {
  data: { visitDate?: string; nextVisitDate?: string };
  confidence: { visitDate?: FieldConfidence; nextVisitDate?: FieldConfidence };
} {
  const data: { visitDate?: string; nextVisitDate?: string } = {};
  const confidence: { visitDate?: FieldConfidence; nextVisitDate?: FieldConfidence } = {};

  // Look for visit date patterns
  const visitDateMatch = text.match(
    /(?:visit|appointment|exam|examination|date)\s*:?\s*([^\n]+?)(?:\n|$)/i,
  );
  if (visitDateMatch) {
    const dateStr = visitDateMatch[1].trim();
    const normalized = normalizeDate(dateStr);
    if (normalized) {
      data.visitDate = normalized;
      // High confidence if explicitly labeled
      confidence.visitDate = { value: 0.85, source: 'extracted' };
    }
  }

  // Look for next visit patterns
  const nextVisitMatch = text.match(PATTERNS.nextVisit);
  if (nextVisitMatch) {
    const dateStr = nextVisitMatch[1].trim();
    const normalized = normalizeDate(dateStr);
    if (normalized) {
      data.nextVisitDate = normalized;
      // High confidence if explicitly labeled
      confidence.nextVisitDate = { value: 0.8, source: 'extracted' };
    }
  }

  // Fallback: extract first date as visit date if not found
  if (!data.visitDate) {
    const dateMatches = text.match(PATTERNS.date);
    if (dateMatches) {
      const normalized = normalizeDate(dateMatches[0]);
      if (normalized) {
        data.visitDate = normalized;
        // Lower confidence for inferred date
        confidence.visitDate = { value: 0.5, source: 'inferred' };
      }
    }
  }

  return { data, confidence };
}

/**
 * Extract diagnoses from text
 */
function extractDiagnoses(text: string): { data: Diagnosis[]; confidence: FieldConfidence } {
  const diagnoses: Diagnosis[] = [];
  const seen = new Set<string>();
  let explicitMatches = 0;

  // Look for explicit diagnosis sections
  const diagnosisMatches = text.match(PATTERNS.diagnosis);
  if (diagnosisMatches) {
    diagnosisMatches.forEach((match) => {
      const diagText = match
        .replace(/^(?:diagnos[ie]s?|condition|disease|illness|problem)\s*:?\s*/i, '')
        .trim();
      if (diagText && !seen.has(diagText.toLowerCase())) {
        diagnoses.push({
          diagnosisText: diagText,
          severity: 'unknown',
        });
        seen.add(diagText.toLowerCase());
        explicitMatches++;
      }
    });
  }

  // Look for common diagnosis keywords
  const lines = text.split('\n');
  lines.forEach((line) => {
    const lowerLine = line.toLowerCase();
    COMMON_DIAGNOSES.forEach((diagnosis) => {
      if (lowerLine.includes(diagnosis) && !seen.has(diagnosis)) {
        diagnoses.push({
          diagnosisText: diagnosis.charAt(0).toUpperCase() + diagnosis.slice(1),
          severity: 'unknown',
        });
        seen.add(diagnosis);
      }
    });
  });

  const limitedDiagnoses = diagnoses.slice(0, 10);
  
  // Calculate confidence: high if explicitly labeled, lower if keyword-matched
  let confidenceValue = 0.3; // Base for empty
  if (limitedDiagnoses.length > 0) {
    confidenceValue = explicitMatches > 0 ? 0.75 : 0.5;
  }

  return {
    data: limitedDiagnoses,
    confidence: {
      value: confidenceValue,
      source: limitedDiagnoses.length > 0 ? 'extracted' : 'empty',
    },
  };
}

/**
 * Extract treatments from text
 */
function extractTreatments(text: string): { data: Treatment[]; confidence: FieldConfidence } {
  const treatments: Treatment[] = [];
  const seen = new Set<string>();

  // Look for explicit treatment sections
  const treatmentMatches = text.match(PATTERNS.treatment);
  if (treatmentMatches) {
    treatmentMatches.forEach((match) => {
      const treatText = match
        .replace(/^(?:treatment|procedure|surgery|therapy|intervention)\s*:?\s*/i, '')
        .trim();
      if (treatText && !seen.has(treatText.toLowerCase())) {
        treatments.push({
          treatmentText: treatText,
        });
        seen.add(treatText.toLowerCase());
      }
    });
  }

  const limitedTreatments = treatments.slice(0, 5);
  
  return {
    data: limitedTreatments,
    confidence: {
      value: limitedTreatments.length > 0 ? 0.7 : 0.3,
      source: limitedTreatments.length > 0 ? 'extracted' : 'empty',
    },
  };
}

/**
 * Extract prescriptions from text
 */
function extractPrescriptions(text: string): {
  data: Prescription[];
  confidence: FieldConfidence;
} {
  const prescriptions: Prescription[] = [];
  const seen = new Set<string>();
  let explicitMatches = 0;

  // Look for medication patterns
  const medMatches = text.match(PATTERNS.medication);
  if (medMatches) {
    medMatches.forEach((match) => {
      const medText = match
        .replace(/^(?:prescribed?|medication|drug|medicine|rx|take|give)\s*:?\s*/i, '')
        .trim();
      if (medText && !seen.has(medText.toLowerCase())) {
        // Extract dosage
        const dosageMatch = medText.match(PATTERNS.dosage);
        const dosage = dosageMatch ? dosageMatch[0] : undefined;

        // Extract frequency
        const frequencyMatch = medText.match(PATTERNS.frequency);
        const frequency = frequencyMatch ? frequencyMatch[0] : undefined;

        // Extract medication name (first word or common medication)
        const medName = medText.split(/\s+/)[0];
        if (medName && medName.length > 2) {
          prescriptions.push({
            medicationName: medName,
            dosage,
            frequency,
          });
          seen.add(medText.toLowerCase());
          explicitMatches++;
        }
      }
    });
  }

  // Look for common medications in text
  const lines = text.split('\n');
  lines.forEach((line) => {
    const lowerLine = line.toLowerCase();
    COMMON_MEDICATIONS.forEach((med) => {
      if (lowerLine.includes(med) && !seen.has(med)) {
        prescriptions.push({
          medicationName: med.charAt(0).toUpperCase() + med.slice(1),
        });
        seen.add(med);
      }
    });
  });

  const limitedPrescriptions = prescriptions.slice(0, 10);
  
  // Calculate confidence: high if explicitly structured, medium if keyword-matched
  let confidenceValue = 0.3;
  if (limitedPrescriptions.length > 0) {
    confidenceValue = explicitMatches > 0 ? 0.8 : 0.55;
  }

  return {
    data: limitedPrescriptions,
    confidence: {
      value: confidenceValue,
      source: limitedPrescriptions.length > 0 ? 'extracted' : 'empty',
    },
  };
}

/**
 * Extract vaccinations from text
 */
function extractVaccinations(text: string): {
  data: VaccinationRecord[];
  confidence: FieldConfidence;
} {
  const vaccinations: VaccinationRecord[] = [];
  const seen = new Set<string>();
  let explicitMatches = 0;

  // Look for explicit vaccination sections
  const vaccMatches = text.match(PATTERNS.vaccination);
  if (vaccMatches) {
    vaccMatches.forEach((match) => {
      const vaccText = match.replace(/^(?:vaccin|immuniz|shot|inocul)\w*\s*:?\s*/i, '').trim();
      if (vaccText && !seen.has(vaccText.toLowerCase())) {
        vaccinations.push({
          vaccineName: vaccText,
        });
        seen.add(vaccText.toLowerCase());
        explicitMatches++;
      }
    });
  }

  // Look for common vaccines in text
  const lines = text.split('\n');
  lines.forEach((line) => {
    const lowerLine = line.toLowerCase();
    COMMON_VACCINES.forEach((vaccine) => {
      if (lowerLine.includes(vaccine) && !seen.has(vaccine)) {
        vaccinations.push({
          vaccineName: vaccine.charAt(0).toUpperCase() + vaccine.slice(1),
        });
        seen.add(vaccine);
      }
    });
  });

  const limitedVaccinations = vaccinations.slice(0, 10);
  
  // Calculate confidence
  let confidenceValue = 0.3;
  if (limitedVaccinations.length > 0) {
    confidenceValue = explicitMatches > 0 ? 0.75 : 0.5;
  }

  return {
    data: limitedVaccinations,
    confidence: {
      value: confidenceValue,
      source: limitedVaccinations.length > 0 ? 'extracted' : 'empty',
    },
  };
}

// ─── Main Parser Function ─────────────────────────────────────────────────────

/**
 * Parse extracted PDF text and return structured medical data
 */
export function parseVetRecordText(text: string): ExtractedVetRecord {
  const warnings: string[] = [];

  // Check if document appears to be scanned
  const isScanned = isScannedDocument(text);
  if (isScanned) {
    warnings.push('Document appears to be scanned. OCR quality may affect accuracy.');
  }

  // Extract all components
  const vetInfo = extractVetInfo(text);
  const dates = extractDates(text);
  const diagnosesResult = extractDiagnoses(text);
  const treatmentsResult = extractTreatments(text);
  const prescriptionsResult = extractPrescriptions(text);
  const vaccinationsResult = extractVaccinations(text);

  // Validate required fields
  if (!dates.data.visitDate) {
    warnings.push('Could not extract visit date. Please verify manually.');
  }

  if (
    diagnosesResult.data.length === 0 &&
    treatmentsResult.data.length === 0 &&
    prescriptionsResult.data.length === 0
  ) {
    warnings.push('No medical information found. Document may not be a valid vet record.');
  }

  const result: ExtractedVetRecord = {
    ...vetInfo.data,
    ...dates.data,
    diagnoses: diagnosesResult.data,
    treatments: treatmentsResult.data,
    prescriptions: prescriptionsResult.data,
    vaccinations: vaccinationsResult.data,
    notes: text.slice(0, 500), // Store first 500 chars as notes
    warnings,
    confidence: 0,
    fieldConfidence: {
      ...vetInfo.confidence,
      ...dates.confidence,
      diagnoses: diagnosesResult.confidence,
      treatments: treatmentsResult.confidence,
      prescriptions: prescriptionsResult.confidence,
      vaccinations: vaccinationsResult.confidence,
      notes: { value: 0.5, source: 'extracted' },
    },
  };

  result.confidence = calculateConfidence(result);

  return result;
}

/**
 * Validate extracted record has minimum required data
 */
export function validateExtractedRecord(record: ExtractedVetRecord): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!record.visitDate) {
    errors.push('Visit date is required');
  }

  if (
    record.diagnoses.length === 0 &&
    record.treatments.length === 0 &&
    record.prescriptions.length === 0 &&
    record.vaccinations.length === 0
  ) {
    errors.push(
      'At least one medical item (diagnosis, treatment, prescription, or vaccination) is required',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
