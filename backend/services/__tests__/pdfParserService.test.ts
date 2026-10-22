import {
  parseVetRecordText,
  validateExtractedRecord,
  normalizeDate,
  calculateConfidence,
  isScannedDocument,
} from '../pdfParserService';

describe('pdfParserService', () => {
  describe('normalizeDate', () => {
    it('should normalize MM/DD/YYYY format', () => {
      const result = normalizeDate('12/25/2023');
      expect(result).toBe('2023-12-25');
    });

    it('should normalize DD/MM/YYYY format', () => {
      const result = normalizeDate('25/12/2023');
      expect(result).toBe('2023-12-25');
    });

    it('should normalize YYYY-MM-DD format', () => {
      const result = normalizeDate('2023-12-25');
      expect(result).toBe('2023-12-25');
    });

    it('should handle month names', () => {
      const result = normalizeDate('December 25, 2023');
      expect(result).toMatch(/2023-12-25/);
    });

    it('should return null for invalid dates', () => {
      const result = normalizeDate('invalid-date');
      expect(result).toBeNull();
    });

    it('should handle short month names', () => {
      const result = normalizeDate('Dec 25, 2023');
      expect(result).toMatch(/2023-12-25/);
    });
  });

  describe('calculateConfidence', () => {
    it('should calculate high confidence for complete record', () => {
      const record = {
        vetName: 'Dr. Smith',
        vetClinic: 'Animal Hospital',
        visitDate: '2023-12-25',
        diagnosis: ['Healthy'],
        treatments: [{ name: 'Checkup', dosage: 'N/A' }],
        prescriptions: [{ medication: 'Amoxicillin', dosage: '500mg' }],
        vaccinations: [{ name: 'Rabies', date: '2023-12-25' }],
      };

      const confidence = calculateConfidence(record);
      expect(confidence).toBeGreaterThan(0.8);
    });

    it('should calculate lower confidence for incomplete record', () => {
      const record = {
        vetName: 'Dr. Smith',
        vetClinic: undefined,
        visitDate: '2023-12-25',
        diagnosis: [],
        treatments: [],
        prescriptions: [],
        vaccinations: [],
      };

      const confidence = calculateConfidence(record);
      expect(confidence).toBeLessThan(0.8);
    });

    it('should return 0 for empty record', () => {
      const record = {
        vetName: undefined,
        vetClinic: undefined,
        visitDate: undefined,
        diagnosis: [],
        treatments: [],
        prescriptions: [],
        vaccinations: [],
      };

      const confidence = calculateConfidence(record);
      expect(confidence).toBe(0);
    });
  });

  describe('isScannedDocument', () => {
    it('should detect scanned documents by low text density', () => {
      const scannedText = 'a b c d e f g h i j k l m n o p q r s t u v w x y z';
      const result = isScannedDocument(scannedText);
      expect(result).toBe(true);
    });

    it('should detect digital documents by high text density', () => {
      const digitalText =
        'This is a comprehensive medical record from the veterinary clinic. The patient was examined on December 25, 2023. The diagnosis includes healthy status with no abnormalities detected.';
      const result = isScannedDocument(digitalText);
      expect(result).toBe(false);
    });

    it('should handle OCR artifacts', () => {
      const ocrText = 'D1agn0s1s: H34lthy st4tus w1th n0 4bn0rm4l1t1es';
      const result = isScannedDocument(ocrText);
      expect(result).toBe(true);
    });
  });

  describe('parseVetRecordText', () => {
    it('should parse complete vet record', () => {
      const text = `
        Veterinary Medical Record
        Clinic: Happy Paws Animal Hospital
        Veterinarian: Dr. Sarah Johnson
        Date: December 25, 2023
        
        Patient: Fluffy
        Species: Cat
        Breed: Persian
        
        Diagnosis: Healthy, minor ear infection
        Treatment: Ear cleaning, prescribed antibiotics
        Prescription: Amoxicillin 250mg twice daily for 10 days
        Vaccination: Rabies booster administered
      `;

      const result = parseVetRecordText(text);

      expect(result.vetName).toBe('Dr. Sarah Johnson');
      expect(result.vetClinic).toBe('Happy Paws Animal Hospital');
      expect(result.visitDate).toBeDefined();
      expect(result.diagnosis.length).toBeGreaterThan(0);
      expect(result.treatments.length).toBeGreaterThan(0);
      expect(result.prescriptions.length).toBeGreaterThan(0);
      expect(result.vaccinations.length).toBeGreaterThan(0);
    });

    it('should handle minimal vet record', () => {
      const text = `
        Date: 2023-12-25
        Diagnosis: Healthy
      `;

      const result = parseVetRecordText(text);

      expect(result.visitDate).toBeDefined();
      expect(result.diagnosis.length).toBeGreaterThan(0);
    });

    it('should extract multiple diagnoses', () => {
      const text = `
        Diagnosis: 
        1. Healthy status
        2. Minor ear infection
        3. Slight overweight
      `;

      const result = parseVetRecordText(text);

      expect(result.diagnosis.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract multiple prescriptions', () => {
      const text = `
        Prescriptions:
        - Amoxicillin 500mg twice daily
        - Ibuprofen 200mg once daily
        - Probiotic supplement daily
      `;

      const result = parseVetRecordText(text);

      expect(result.prescriptions.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract vaccination records', () => {
      const text = `
        Vaccinations Administered:
        - Rabies: 12/25/2023
        - DHPP: 12/25/2023
        - Bordetella: 12/25/2023
      `;

      const result = parseVetRecordText(text);

      expect(result.vaccinations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('validateExtractedRecord', () => {
    it('should validate complete record', () => {
      const record = {
        vetName: 'Dr. Smith',
        vetClinic: 'Animal Hospital',
        visitDate: '2023-12-25',
        diagnosis: ['Healthy'],
        treatments: [{ name: 'Checkup', dosage: 'N/A' }],
        prescriptions: [{ medication: 'Amoxicillin', dosage: '500mg' }],
        vaccinations: [{ name: 'Rabies', date: '2023-12-25' }],
      };

      const result = validateExtractedRecord(record);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should flag missing vet name', () => {
      const record = {
        vetName: undefined,
        vetClinic: 'Animal Hospital',
        visitDate: '2023-12-25',
        diagnosis: ['Healthy'],
        treatments: [],
        prescriptions: [],
        vaccinations: [],
      };

      const result = validateExtractedRecord(record);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('vet'));
    });

    it('should flag missing visit date', () => {
      const record = {
        vetName: 'Dr. Smith',
        vetClinic: 'Animal Hospital',
        visitDate: undefined,
        diagnosis: ['Healthy'],
        treatments: [],
        prescriptions: [],
        vaccinations: [],
      };

      const result = validateExtractedRecord(record);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('date'));
    });

    it('should flag missing diagnosis', () => {
      const record = {
        vetName: 'Dr. Smith',
        vetClinic: 'Animal Hospital',
        visitDate: '2023-12-25',
        diagnosis: [],
        treatments: [],
        prescriptions: [],
        vaccinations: [],
      };

      const result = validateExtractedRecord(record);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('diagnosis'));
    });

    it('should provide warnings for low confidence', () => {
      const record = {
        vetName: 'Dr. Smith',
        vetClinic: undefined,
        visitDate: '2023-12-25',
        diagnosis: ['Healthy'],
        treatments: [],
        prescriptions: [],
        vaccinations: [],
      };

      const result = validateExtractedRecord(record);

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    });
  });
});
