export enum EmergencyContactType {
  PERSONAL_VET = 'PERSONAL_VET',
  EMERGENCY_CLINIC = 'EMERGENCY_CLINIC',
  POISON_CONTROL = 'POISON_CONTROL',
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Emergency contact for urgent pet care support.
 */
export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  type: EmergencyContactType;
  address: string;
  coordinates: Coordinates;
}

/**
 * Veterinary clinic details used for nearby emergency care.
 */
export interface VetClinic {
  id: string;
  name: string;
  phone: string;
  address: string;
  coordinates: Coordinates;
  hours: string;
  emergencyAvailable: boolean;
}
