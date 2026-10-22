export type PermissionType = 'camera' | 'notifications' | 'location' | 'calendar';

export interface PermissionRationale {
  title: string;
  description: string;
  icon: string;
  benefits: string[];
  deniedMessage: string;
}

export const PERMISSION_RATIONALES: Record<PermissionType, PermissionRationale> = {
  camera: {
    title: 'Camera Access',
    description:
      "PetChain needs camera access to scan your pet's QR code and instantly retrieve their medical records.",
    icon: '📷',
    benefits: [
      'Scan pet QR codes for instant record access',
      'Quickly share records with your vet',
      'No manual data entry required',
    ],
    deniedMessage:
      'Camera access is required to scan QR codes. Please enable it in your device settings.',
  },
  notifications: {
    title: 'Notification Access',
    description:
      "PetChain uses notifications to remind you about your pet's medications, upcoming vet appointments, and vaccination due dates.",
    icon: '🔔',
    benefits: [
      'Medication reminders so you never miss a dose',
      'Appointment alerts before vet visits',
      'Vaccination due date reminders',
    ],
    deniedMessage:
      'Notifications are disabled. You can enable them in your device settings to receive important pet health reminders.',
  },
  location: {
    title: 'Location Access',
    description:
      'PetChain uses your location to help you find nearby veterinary clinics and emergency pet services.',
    icon: '📍',
    benefits: [
      'Find nearby vet clinics instantly',
      'Locate emergency pet services',
      'Get directions to appointments',
    ],
    deniedMessage:
      'Location access is required to find nearby clinics. Please enable it in your device settings.',
  },
  calendar: {
    title: 'Calendar Access',
    description:
      'PetChain uses your calendar only when you choose to export appointments, so vet visits show up alongside the rest of your day.',
    icon: '📅',
    benefits: [
      'Vet visits appear in your own calendar app',
      'Reminders before each appointment',
      'Remove or revoke any synced entry at any time',
    ],
    deniedMessage:
      'Calendar access is off, so appointments cannot be exported. You can enable it in your device settings.',
  },
};
