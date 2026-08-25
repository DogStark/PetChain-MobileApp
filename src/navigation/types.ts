import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { Pet } from '../models/Pet';
import type { CoSignPayload } from '../screens/PendingCoSignScreen';

// ─── Root Stack ───────────────────────────────────────────────────────────────
export type RootStackParamList = {
  Onboarding: undefined;
  Auth: undefined;
  Main: undefined;
  // Modals
  QRScanner: undefined;
  ManualEntry: undefined;
  // Future: Payment / Subscription
  Payment: { planId?: string };
  PendingCoSign: {
    payload: CoSignPayload;
    expectedSequence: number;
    onApprove: (payload: CoSignPayload) => void;
    onReject: (txId: string) => void;
  };
};

// ─── Main Tab ─────────────────────────────────────────────────────────────────
export type MainTabParamList = {
  PetList: undefined;
  Medications: undefined;
  Appointments: undefined;
  Community: undefined;
  Emergency: undefined;
  Profile: undefined;
};

// ─── Pet Stack (nested inside PetList tab) ────────────────────────────────────
export type PetStackParamList = {
  PetListScreen: undefined;
  PetDetail: { petId: string };
  PetHealthDashboard: { petId: string; petName?: string };
  PetHealthMetrics: { petId: string; petName?: string };
  PetForm: { pet?: Pet; ownerId?: string };
  MedicalRecordSearch: { petId: string };
  MedicalRecordViewer: { petId: string; petName?: string };
  PetShare: { petId: string; petName: string };
};

// ─── Screen prop helpers ──────────────────────────────────────────────────────
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

export type PetStackScreenProps<T extends keyof PetStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<PetStackParamList, T>,
  MainTabScreenProps<'PetList'>
>;

// ─── Deep link config ─────────────────────────────────────────────────────────
export const DEEP_LINK_PREFIX = ['petchain://', 'https://petchain.app'];
