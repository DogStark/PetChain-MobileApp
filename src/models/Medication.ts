export interface PrescriberInfo {
  name?: string;
  contact?: string;
  clinic?: string;
}

export interface PharmacyInfo {
  name?: string;
  phone?: string;
  address?: string;
}

export type MedicationStatus = 'active' | 'paused' | 'completed' | 'discontinued';

export interface Medication {
  id: string;
  petId: string;
  name: string;
  dosage: string;
  frequency: number; // hours between doses
  startDate: string; // ISO date string
  endDate?: string; // ISO date string
  instructions?: string;
  prescriberInfo?: PrescriberInfo;
  pharmacyInfo?: PharmacyInfo;
  totalPills?: number;
  remainingPills?: number;
  refillDate?: string;
  status?: MedicationStatus;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateMedicationInput extends Omit<Medication, 'id' | 'createdAt' | 'updatedAt'> {
  status?: MedicationStatus;
}

export type UpdateMedicationInput = Partial<
  Omit<Medication, 'id' | 'petId' | 'createdAt' | 'updatedAt'>
>;
