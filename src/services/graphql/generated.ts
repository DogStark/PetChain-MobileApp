/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  DateTime: { input: string; output: string };
};

export type Appointment = {
  __typename?: 'Appointment';
  createdAt: Scalars['DateTime']['output'];
  date: Scalars['String']['output'];
  durationMinutes?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  pet?: Maybe<Pet>;
  petId: Scalars['ID']['output'];
  status: AppointmentStatus;
  time: Scalars['String']['output'];
  type: AppointmentType;
  updatedAt: Scalars['DateTime']['output'];
  vet?: Maybe<User>;
  vetId: Scalars['ID']['output'];
};

export enum AppointmentStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Confirmed = 'CONFIRMED',
  NoShow = 'NO_SHOW',
  Pending = 'PENDING',
  Rescheduled = 'RESCHEDULED',
}

export enum AppointmentType {
  Dental = 'DENTAL',
  Diagnostic = 'DIAGNOSTIC',
  Emergency = 'EMERGENCY',
  FollowUp = 'FOLLOW_UP',
  Grooming = 'GROOMING',
  NutritionConsultation = 'NUTRITION_CONSULTATION',
  RoutineCheckup = 'ROUTINE_CHECKUP',
  SpecialistReferral = 'SPECIALIST_REFERRAL',
  Surgery = 'SURGERY',
  Vaccination = 'VACCINATION',
}

export type CreateAppointmentInput = {
  date: Scalars['String']['input'];
  durationMinutes?: InputMaybe<Scalars['Int']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  petId: Scalars['ID']['input'];
  time: Scalars['String']['input'];
  type: AppointmentType;
  vetId: Scalars['ID']['input'];
};

export type CreateMedicalRecordInput = {
  diagnosis?: InputMaybe<Scalars['String']['input']>;
  nextVisitDate?: InputMaybe<Scalars['DateTime']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  petId: Scalars['ID']['input'];
  treatment?: InputMaybe<Scalars['String']['input']>;
  type: MedicalRecordType;
  vetId: Scalars['ID']['input'];
  visitDate: Scalars['DateTime']['input'];
};

export type CreateMedicationInput = {
  dosage: Scalars['String']['input'];
  durationDays: Scalars['Int']['input'];
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  frequency: MedicationFrequency;
  instructions?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  petId: Scalars['ID']['input'];
  startDate: Scalars['DateTime']['input'];
};

export type CreatePetInput = {
  breed?: InputMaybe<Scalars['String']['input']>;
  dateOfBirth?: InputMaybe<Scalars['DateTime']['input']>;
  microchipId?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  photoUrl?: InputMaybe<Scalars['String']['input']>;
  species: Species;
};

export type MedicalRecord = {
  __typename?: 'MedicalRecord';
  createdAt: Scalars['DateTime']['output'];
  diagnosis?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  nextVisitDate?: Maybe<Scalars['DateTime']['output']>;
  notes?: Maybe<Scalars['String']['output']>;
  pet?: Maybe<Pet>;
  petId: Scalars['ID']['output'];
  treatment?: Maybe<Scalars['String']['output']>;
  type: MedicalRecordType;
  updatedAt: Scalars['DateTime']['output'];
  vet?: Maybe<User>;
  vetId: Scalars['ID']['output'];
  visitDate: Scalars['DateTime']['output'];
};

export enum MedicalRecordType {
  Checkup = 'checkup',
  Other = 'other',
  Surgery = 'surgery',
  Treatment = 'treatment',
  Vaccination = 'vaccination',
}

export type Medication = {
  __typename?: 'Medication';
  createdAt: Scalars['DateTime']['output'];
  dosage: Scalars['String']['output'];
  durationDays: Scalars['Int']['output'];
  endDate?: Maybe<Scalars['DateTime']['output']>;
  frequency: MedicationFrequency;
  id: Scalars['ID']['output'];
  instructions?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  pet?: Maybe<Pet>;
  petId: Scalars['ID']['output'];
  startDate: Scalars['DateTime']['output'];
  status: MedicationStatus;
  updatedAt: Scalars['DateTime']['output'];
};

export enum MedicationFrequency {
  AsNeeded = 'as_needed',
  EveryOtherDay = 'every_other_day',
  OnceDaily = 'once_daily',
  ThreeTimesDaily = 'three_times_daily',
  TwiceDaily = 'twice_daily',
  Weekly = 'weekly',
}

export enum MedicationStatus {
  Active = 'active',
  Completed = 'completed',
  Discontinued = 'discontinued',
  Paused = 'paused',
}

export type Mutation = {
  __typename?: 'Mutation';
  createAppointment: Appointment;
  createMedicalRecord: MedicalRecord;
  createMedication: Medication;
  createPet: Pet;
  deletePet: Scalars['Boolean']['output'];
  triggerSos: SosAlert;
  updateAppointment: Appointment;
  updateMedication: Medication;
  updatePet: Pet;
};

export type MutationCreateAppointmentArgs = {
  input: CreateAppointmentInput;
};

export type MutationCreateMedicalRecordArgs = {
  input: CreateMedicalRecordInput;
};

export type MutationCreateMedicationArgs = {
  input: CreateMedicationInput;
};

export type MutationCreatePetArgs = {
  input: CreatePetInput;
};

export type MutationDeletePetArgs = {
  id: Scalars['ID']['input'];
};

export type MutationTriggerSosArgs = {
  input: TriggerSosInput;
};

export type MutationUpdateAppointmentArgs = {
  id: Scalars['ID']['input'];
  input: UpdateAppointmentInput;
};

export type MutationUpdateMedicationArgs = {
  id: Scalars['ID']['input'];
  input: UpdateMedicationInput;
};

export type MutationUpdatePetArgs = {
  id: Scalars['ID']['input'];
  input: UpdatePetInput;
};

export type Pet = {
  __typename?: 'Pet';
  appointments: Array<Appointment>;
  breed?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  dateOfBirth?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  medicalRecords: Array<MedicalRecord>;
  medications: Array<Medication>;
  microchipId?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  owner?: Maybe<User>;
  ownerId: Scalars['ID']['output'];
  photoUrl?: Maybe<Scalars['String']['output']>;
  species: Species;
  updatedAt: Scalars['DateTime']['output'];
};

export type Query = {
  __typename?: 'Query';
  appointment?: Maybe<Appointment>;
  me: User;
  medicalRecord?: Maybe<MedicalRecord>;
  medication?: Maybe<Medication>;
  myAppointments: Array<Appointment>;
  myPets: Array<Pet>;
  pet?: Maybe<Pet>;
  petAppointments: Array<Appointment>;
  petMedicalRecords: Array<MedicalRecord>;
  petMedications: Array<Medication>;
  user?: Maybe<User>;
  users: Array<User>;
};

export type QueryAppointmentArgs = {
  id: Scalars['ID']['input'];
};

export type QueryMedicalRecordArgs = {
  id: Scalars['ID']['input'];
};

export type QueryMedicationArgs = {
  id: Scalars['ID']['input'];
};

export type QueryPetArgs = {
  id: Scalars['ID']['input'];
};

export type QueryPetAppointmentsArgs = {
  petId: Scalars['ID']['input'];
};

export type QueryPetMedicalRecordsArgs = {
  petId: Scalars['ID']['input'];
};

export type QueryPetMedicationsArgs = {
  petId: Scalars['ID']['input'];
};

export type QueryUserArgs = {
  id: Scalars['ID']['input'];
};

export type SosAlert = {
  __typename?: 'SosAlert';
  id: Scalars['ID']['output'];
  latitude?: Maybe<Scalars['Float']['output']>;
  longitude?: Maybe<Scalars['Float']['output']>;
  message: Scalars['String']['output'];
  petId?: Maybe<Scalars['ID']['output']>;
  triggeredAt: Scalars['DateTime']['output'];
  userId: Scalars['ID']['output'];
};

export enum Species {
  Bird = 'bird',
  Cat = 'cat',
  Dog = 'dog',
  Other = 'other',
  Rabbit = 'rabbit',
}

export type Subscription = {
  __typename?: 'Subscription';
  sosAlert: SosAlert;
  syncStatus: SyncStatus;
};

export type SyncStatus = {
  __typename?: 'SyncStatus';
  status: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  userId: Scalars['ID']['output'];
};

export type TriggerSosInput = {
  latitude?: InputMaybe<Scalars['Float']['input']>;
  longitude?: InputMaybe<Scalars['Float']['input']>;
  message: Scalars['String']['input'];
  petId?: InputMaybe<Scalars['ID']['input']>;
};

export type UpdateAppointmentInput = {
  date?: InputMaybe<Scalars['String']['input']>;
  durationMinutes?: InputMaybe<Scalars['Int']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<AppointmentStatus>;
  time?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<AppointmentType>;
};

export type UpdateMedicationInput = {
  dosage?: InputMaybe<Scalars['String']['input']>;
  durationDays?: InputMaybe<Scalars['Int']['input']>;
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  frequency?: InputMaybe<MedicationFrequency>;
  instructions?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
  status?: InputMaybe<MedicationStatus>;
};

export type UpdatePetInput = {
  breed?: InputMaybe<Scalars['String']['input']>;
  dateOfBirth?: InputMaybe<Scalars['DateTime']['input']>;
  microchipId?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  photoUrl?: InputMaybe<Scalars['String']['input']>;
  species?: InputMaybe<Species>;
};

export type User = {
  __typename?: 'User';
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isEmailVerified: Scalars['Boolean']['output'];
  lastLoginAt?: Maybe<Scalars['DateTime']['output']>;
  name: Scalars['String']['output'];
  pets: Array<Pet>;
  phone?: Maybe<Scalars['String']['output']>;
  role: UserRole;
  updatedAt: Scalars['DateTime']['output'];
};

export enum UserRole {
  Admin = 'admin',
  Owner = 'owner',
  Vet = 'vet',
}

export type GetMeQueryVariables = Exact<{ [key: string]: never }>;

export type GetMeQuery = { me: { id: string; email: string; name: string; role: UserRole } };

export type GetMyPetsQueryVariables = Exact<{ [key: string]: never }>;

export type GetMyPetsQuery = {
  myPets: Array<{
    id: string;
    name: string;
    species: Species;
    breed: string | null;
    ownerId: string;
  }>;
};

export type GetPetQueryVariables = Exact<{
  id: string | number;
}>;

export type GetPetQuery = {
  pet: {
    id: string;
    name: string;
    species: Species;
    breed: string | null;
    dateOfBirth: string | null;
    microchipId: string | null;
    photoUrl: string | null;
    ownerId: string;
    medicalRecords: Array<{
      id: string;
      type: MedicalRecordType;
      visitDate: string;
      diagnosis: string | null;
    }>;
    medications: Array<{
      id: string;
      name: string;
      dosage: string;
      frequency: MedicationFrequency;
      status: MedicationStatus;
    }>;
    appointments: Array<{
      id: string;
      date: string;
      time: string;
      type: AppointmentType;
      status: AppointmentStatus;
    }>;
  } | null;
};

export type CreatePetMutationVariables = Exact<{
  input: CreatePetInput;
}>;

export type CreatePetMutation = {
  createPet: { id: string; name: string; species: Species; breed: string | null; ownerId: string };
};

export type TriggerSosMutationVariables = Exact<{
  input: TriggerSosInput;
}>;

export type TriggerSosMutation = {
  triggerSos: { id: string; message: string; triggeredAt: string };
};

export type OnSosAlertSubscriptionVariables = Exact<{ [key: string]: never }>;

export type OnSosAlertSubscription = {
  sosAlert: {
    id: string;
    userId: string;
    petId: string | null;
    latitude: number | null;
    longitude: number | null;
    message: string;
    triggeredAt: string;
  };
};

export type OnSyncStatusSubscriptionVariables = Exact<{ [key: string]: never }>;

export type OnSyncStatusSubscription = {
  syncStatus: { userId: string; status: string; updatedAt: string };
};
