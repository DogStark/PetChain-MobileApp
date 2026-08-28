/**
 * OpenAPI schema definitions for Medical Record endpoints.
 */

export const medicalRecordSchemas = {
  MedicalRecord: {
    type: 'object',
    required: ['id', 'petId', 'vetId', 'type', 'visitDate', 'createdAt', 'updatedAt'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      petId: { $ref: '#/components/schemas/UUID' },
      vetId: { $ref: '#/components/schemas/UUID' },
      type: {
        type: 'string',
        enum: ['checkup', 'vaccination', 'surgery', 'treatment', 'other'],
        example: 'vaccination',
      },
      diagnosis: { type: 'string', example: 'Healthy — routine annual checkup' },
      treatment: { type: 'string', example: 'Administered DHPP booster vaccine' },
      notes: { type: 'string', example: 'Pet is in excellent health. Weight stable.' },
      visitDate: { $ref: '#/components/schemas/ISODate' },
      nextVisitDate: { $ref: '#/components/schemas/ISODate' },

      // Rich nested data
      diagnosisDetails: { $ref: '#/components/schemas/Diagnosis' },
      treatmentDetails: { $ref: '#/components/schemas/Treatment' },
      prescriptions: {
        type: 'array',
        items: { $ref: '#/components/schemas/Prescription' },
      },
      vaccinations: {
        type: 'array',
        items: { $ref: '#/components/schemas/VaccinationRecord' },
      },
      documents: {
        type: 'array',
        items: { $ref: '#/components/schemas/MedicalDocument' },
      },
      veterinarian: { $ref: '#/components/schemas/Veterinarian' },

      // Blockchain fields
      hash: {
        type: 'string',
        example: 'a3f5c8d2e1b4...',
        description: 'SHA-256 hash of the record payload',
      },
      txHash: {
        type: 'string',
        example: 'stellar-tx-hash-abc123',
        description: 'Stellar transaction hash',
      },
      isBlockchainVerified: { type: 'boolean', example: true },
      blockchainVerifiedAt: { $ref: '#/components/schemas/ISODateTime' },

      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  Diagnosis: {
    type: 'object',
    required: ['diagnosisText'],
    properties: {
      diagnosisText: { type: 'string', example: 'Mild seasonal allergies' },
      code: {
        type: 'string',
        example: 'L30.9',
        description: 'ICD-10 or veterinary diagnosis code',
      },
      severity: {
        type: 'string',
        enum: ['mild', 'moderate', 'severe', 'unknown'],
        example: 'mild',
      },
    },
  },

  Treatment: {
    type: 'object',
    required: ['treatmentText'],
    properties: {
      treatmentText: { type: 'string', example: 'Antihistamine prescribed for 2 weeks' },
      procedureName: { type: 'string', example: 'Allergy skin test' },
      outcome: { type: 'string', example: 'Resolved — follow-up in 30 days' },
    },
  },

  Prescription: {
    type: 'object',
    required: ['medicationName'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      medicationName: { type: 'string', example: 'Apoquel' },
      dosage: { type: 'string', example: '16mg' },
      route: {
        type: 'string',
        example: 'oral',
        description: 'Administration route (oral, topical, injection)',
      },
      frequency: { type: 'string', example: 'once_daily' },
      startDate: { $ref: '#/components/schemas/ISODate' },
      endDate: { $ref: '#/components/schemas/ISODate' },
      instructions: { type: 'string', example: 'Give with food' },
    },
  },

  VaccinationRecord: {
    type: 'object',
    required: ['vaccineName'],
    properties: {
      vaccineName: { type: 'string', example: 'DHPP' },
      administeredAt: { $ref: '#/components/schemas/ISODate' },
      nextDueDate: { $ref: '#/components/schemas/ISODate' },
      manufacturer: { type: 'string', example: 'Merck Animal Health' },
      batchNumber: { type: 'string', example: 'LOT-2024-001' },
      dose: { type: 'string', example: '1ml' },
    },
  },

  MedicalDocument: {
    type: 'object',
    required: ['id', 'name', 'mimeType', 'type', 'url'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', example: 'blood-panel-results.pdf' },
      mimeType: { type: 'string', example: 'application/pdf' },
      type: { type: 'string', enum: ['pdf', 'image', 'other'], example: 'pdf' },
      url: {
        type: 'string',
        format: 'uri',
        example: 'https://storage.petchain.app/docs/blood-panel.pdf',
      },
      sizeBytes: { type: 'integer', example: 204800 },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  Veterinarian: {
    type: 'object',
    required: ['id', 'name', 'email'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      name: { type: 'string', example: 'Dr. Sarah Johnson' },
      email: { type: 'string', format: 'email', example: 'dr.johnson@vetclinic.com' },
      phone: { type: 'string', example: '+14155559876' },
      licenseNumber: { type: 'string', example: 'VET-CA-12345' },
      clinic: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Downtown Animal Hospital' },
          address: { type: 'string', example: '123 Main St, San Francisco, CA 94102' },
          phone: { type: 'string', example: '+14155550100' },
        },
      },
    },
  },

  CreateMedicalRecordRequest: {
    type: 'object',
    required: ['petId', 'vetId', 'type', 'visitDate'],
    properties: {
      petId: { $ref: '#/components/schemas/UUID' },
      vetId: { $ref: '#/components/schemas/UUID' },
      type: {
        type: 'string',
        enum: ['checkup', 'vaccination', 'surgery', 'treatment', 'other'],
        example: 'vaccination',
      },
      diagnosis: { type: 'string', example: 'Healthy — routine annual checkup' },
      treatment: { type: 'string', example: 'Administered DHPP booster vaccine' },
      notes: { type: 'string', example: 'Pet is in excellent health.' },
      visitDate: { $ref: '#/components/schemas/ISODate' },
      nextVisitDate: { $ref: '#/components/schemas/ISODate' },
      diagnosisDetails: { $ref: '#/components/schemas/Diagnosis' },
      treatmentDetails: { $ref: '#/components/schemas/Treatment' },
      prescriptions: { type: 'array', items: { $ref: '#/components/schemas/Prescription' } },
      vaccinations: { type: 'array', items: { $ref: '#/components/schemas/VaccinationRecord' } },
      documents: { type: 'array', items: { $ref: '#/components/schemas/MedicalDocument' } },
    },
  },

  UpdateMedicalRecordRequest: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['checkup', 'vaccination', 'surgery', 'treatment', 'other'] },
      diagnosis: { type: 'string' },
      treatment: { type: 'string' },
      notes: { type: 'string' },
      visitDate: { $ref: '#/components/schemas/ISODate' },
      nextVisitDate: { $ref: '#/components/schemas/ISODate' },
      diagnosisDetails: { $ref: '#/components/schemas/Diagnosis' },
      treatmentDetails: { $ref: '#/components/schemas/Treatment' },
      prescriptions: { type: 'array', items: { $ref: '#/components/schemas/Prescription' } },
      vaccinations: { type: 'array', items: { $ref: '#/components/schemas/VaccinationRecord' } },
      documents: { type: 'array', items: { $ref: '#/components/schemas/MedicalDocument' } },
    },
  },
} as const;
