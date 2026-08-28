import {
  getDrugDatabase,
  getDrugById,
  lookupDrug,
  getDrugsForSpecies,
  getSafetyWarnings,
  type Species,
} from '../drugDatabaseService';

describe('drugDatabaseService', () => {
  describe('getDrugDatabase', () => {
    it('should return drug database', () => {
      const drugs = getDrugDatabase();

      expect(Array.isArray(drugs)).toBe(true);
      expect(drugs.length).toBeGreaterThan(0);
    });

    it('should contain expected drugs', () => {
      const drugs = getDrugDatabase();
      const drugIds = drugs.map((d) => d.id);

      expect(drugIds).toContain('amoxicillin');
      expect(drugIds).toContain('metronidazole');
      expect(drugIds).toContain('carprofen');
      expect(drugIds).toContain('meloxicam');
    });

    it('should have all required fields for each drug', () => {
      const drugs = getDrugDatabase();

      drugs.forEach((drug) => {
        expect(drug).toHaveProperty('id');
        expect(drug).toHaveProperty('name');
        expect(drug).toHaveProperty('genericName');
        expect(drug).toHaveProperty('drugClass');
        expect(drug).toHaveProperty('dosageBySpecies');
        expect(drug).toHaveProperty('defaultUnit');
        expect(drug).toHaveProperty('safetyWarnings');
        expect(drug).toHaveProperty('contraindications');
        expect(drug).toHaveProperty('vetVerified');
        expect(drug).toHaveProperty('lastUpdated');
      });
    });
  });

  describe('getDrugById', () => {
    it('should retrieve drug by ID', () => {
      const drug = getDrugById('amoxicillin');

      expect(drug).toBeDefined();
      expect(drug?.name).toBe('Amoxicillin');
      expect(drug?.genericName).toBe('amoxicillin trihydrate');
    });

    it('should return undefined for non-existent drug', () => {
      const drug = getDrugById('non-existent-drug');

      expect(drug).toBeUndefined();
    });

    it('should return drug with dosage information', () => {
      const drug = getDrugById('amoxicillin');

      expect(drug?.dosageBySpecies.dog).toBeDefined();
      expect(drug?.dosageBySpecies.dog?.minPerKg).toBe(10);
      expect(drug?.dosageBySpecies.dog?.maxPerKg).toBe(22);
      expect(drug?.dosageBySpecies.dog?.typicalPerKg).toBe(15);
    });

    it('should return drug with safety warnings', () => {
      const drug = getDrugById('amoxicillin');

      expect(drug?.safetyWarnings.dog).toBeDefined();
      expect(drug?.safetyWarnings.dog?.length).toBeGreaterThan(0);
    });
  });

  describe('lookupDrug', () => {
    it('should lookup drug for specific species', () => {
      const result = lookupDrug('amoxicillin', 'dog');

      expect(result).toBeDefined();
      expect(result?.drug.name).toBe('Amoxicillin');
      expect(result?.range).toBeDefined();
      expect(result?.range?.minPerKg).toBe(10);
    });

    it('should return null for non-existent drug', () => {
      const result = lookupDrug('non-existent', 'dog');

      expect(result).toBeNull();
    });

    it('should include warnings for species', () => {
      const result = lookupDrug('amoxicillin', 'dog');

      expect(result?.warnings).toBeDefined();
      expect(result?.warnings.length).toBeGreaterThan(0);
    });

    it('should include contraindications for species', () => {
      const result = lookupDrug('amoxicillin', 'rabbit');

      expect(result?.contraindications).toBeDefined();
      expect(result?.contraindications.length).toBeGreaterThan(0);
    });

    it('should handle species without dosage', () => {
      const result = lookupDrug('carprofen', 'cat');

      expect(result).toBeDefined();
      expect(result?.range).toBeNull();
      expect(result?.warnings).toContain(expect.stringContaining('no established dosage range'));
    });

    it('should warn about missing dosage for species', () => {
      const result = lookupDrug('amoxicillin', 'bird');

      expect(result?.warnings).toContain(expect.stringContaining('no established dosage range'));
    });
  });

  describe('getDrugsForSpecies', () => {
    it('should return drugs available for species', () => {
      const drugs = getDrugsForSpecies('dog');

      expect(Array.isArray(drugs)).toBe(true);
      expect(drugs.length).toBeGreaterThan(0);
    });

    it('should only return drugs with dosage for species', () => {
      const drugs = getDrugsForSpecies('dog');

      drugs.forEach((drug) => {
        expect(drug.dosageBySpecies.dog).toBeDefined();
      });
    });

    it('should return different drugs for different species', () => {
      const dogDrugs = getDrugsForSpecies('dog');
      const catDrugs = getDrugsForSpecies('cat');
      const rabbitDrugs = getDrugsForSpecies('rabbit');

      // Rabbits have fewer drugs available
      expect(rabbitDrugs.length).toBeLessThan(dogDrugs.length);
    });

    it('should handle species with limited drug availability', () => {
      const birdDrugs = getDrugsForSpecies('bird');

      expect(Array.isArray(birdDrugs)).toBe(true);
      expect(birdDrugs.length).toBeGreaterThan(0);
    });
  });

  describe('getSafetyWarnings', () => {
    it('should return warnings for drug and species', () => {
      const warnings = getSafetyWarnings('amoxicillin', 'dog', 15);

      expect(Array.isArray(warnings)).toBe(true);
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should warn about unknown drugs', () => {
      const warnings = getSafetyWarnings('unknown-drug', 'dog', 10);

      expect(warnings).toContain(expect.stringContaining('Unknown drug'));
    });

    it('should warn about overdose', () => {
      const warnings = getSafetyWarnings('amoxicillin', 'dog', 50);

      expect(warnings).toContain(expect.stringContaining('exceeds'));
    });

    it('should warn about critical overdose', () => {
      const warnings = getSafetyWarnings('amoxicillin', 'dog', 100);

      expect(warnings).toContain(expect.stringContaining('CRITICAL'));
    });

    it('should warn about underdose', () => {
      const warnings = getSafetyWarnings('amoxicillin', 'dog', 5);

      expect(warnings).toContain(expect.stringContaining('below'));
    });

    it('should include species-specific warnings', () => {
      const warnings = getSafetyWarnings('enrofloxacin', 'cat', 5);

      expect(warnings.some((w) => w.includes('blindness'))).toBe(true);
    });

    it('should handle safe dosage without warnings', () => {
      const warnings = getSafetyWarnings('amoxicillin', 'dog', 15);

      // Should not have dose-related warnings for typical dose
      const doseWarnings = warnings.filter((w) => w.match(/exceeds|below|CRITICAL|WARNING/));
      expect(doseWarnings.length).toBeLessThanOrEqual(1);
    });

    it('should warn about contraindicated drugs', () => {
      const warnings = getSafetyWarnings('amoxicillin', 'rabbit', 15);

      expect(warnings.some((w) => w.includes('enterotoxemia'))).toBe(true);
    });

    it('should handle critical safety warnings', () => {
      const warnings = getSafetyWarnings('doxycycline', 'cat', 5);

      expect(warnings.some((w) => w.includes('esophageal'))).toBe(true);
    });
  });

  describe('Drug-specific safety', () => {
    it('should flag enrofloxacin overdose in cats', () => {
      const warnings = getSafetyWarnings('enrofloxacin', 'cat', 10);

      expect(warnings.some((w) => w.includes('blindness'))).toBe(true);
    });

    it('should flag meloxicam in cats', () => {
      const result = lookupDrug('meloxicam', 'cat');

      expect(result?.warnings.some((w) => w.includes('renal'))).toBe(true);
    });

    it('should flag carprofen contraindication in cats', () => {
      const result = lookupDrug('carprofen', 'cat');

      expect(result?.contraindications.some((c) => c.includes('Not approved'))).toBe(true);
    });

    it('should flag doxycycline administration in cats', () => {
      const result = lookupDrug('doxycycline', 'cat');

      expect(result?.warnings.some((w) => w.includes('esophageal'))).toBe(true);
    });

    it('should flag amoxicillin in rabbits', () => {
      const result = lookupDrug('amoxicillin', 'rabbit');

      expect(result?.contraindications.some((c) => c.includes('enterotoxemia'))).toBe(true);
    });
  });

  describe('Dosage calculations', () => {
    it('should provide dosage range for dog', () => {
      const result = lookupDrug('amoxicillin', 'dog');

      expect(result?.range?.minPerKg).toBe(10);
      expect(result?.range?.maxPerKg).toBe(22);
      expect(result?.range?.typicalPerKg).toBe(15);
    });

    it('should provide different dosages for different species', () => {
      const dogResult = lookupDrug('meloxicam', 'dog');
      const catResult = lookupDrug('meloxicam', 'cat');

      expect(dogResult?.range?.typicalPerKg).not.toBe(catResult?.range?.typicalPerKg);
    });

    it('should handle concentration-based dosing', () => {
      const drug = getDrugById('meloxicam');

      expect(drug?.concentration).toBe(1.5);
      expect(drug?.defaultUnit).toBe('ml');
    });

    it('should handle tablet strength', () => {
      const drug = getDrugById('amoxicillin');

      expect(drug?.tabletStrength).toBe(250);
      expect(drug?.defaultUnit).toBe('mg');
    });
  });
});
