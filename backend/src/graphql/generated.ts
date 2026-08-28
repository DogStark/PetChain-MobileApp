import {
  type GraphQLResolveInfo,
  type GraphQLScalarType,
  type GraphQLScalarTypeConfig,
} from 'graphql';

import { type GraphQLContext } from './context';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
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

export type AppointmentStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'CONFIRMED'
  | 'NO_SHOW'
  | 'PENDING'
  | 'RESCHEDULED';

export type AppointmentType =
  | 'DENTAL'
  | 'DIAGNOSTIC'
  | 'EMERGENCY'
  | 'FOLLOW_UP'
  | 'GROOMING'
  | 'NUTRITION_CONSULTATION'
  | 'ROUTINE_CHECKUP'
  | 'SPECIALIST_REFERRAL'
  | 'SURGERY'
  | 'VACCINATION';

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

export type MedicalRecordType = 'checkup' | 'other' | 'surgery' | 'treatment' | 'vaccination';

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

export type MedicationFrequency =
  | 'as_needed'
  | 'every_other_day'
  | 'once_daily'
  | 'three_times_daily'
  | 'twice_daily'
  | 'weekly';

export type MedicationStatus = 'active' | 'completed' | 'discontinued' | 'paused';

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

export type Species = 'bird' | 'cat' | 'dog' | 'other' | 'rabbit';

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

export type UserRole = 'admin' | 'owner' | 'vet';

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;

export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<
  TResult,
  TParent = Record<PropertyKey, never>,
  TContext = Record<PropertyKey, never>,
  TArgs = Record<PropertyKey, never>,
> =
  | ResolverFn<TResult, TParent, TContext, TArgs>
  | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<
  TResult,
  TKey extends string,
  TParent,
  TContext,
  TArgs,
> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<
  TResult,
  TKey extends string,
  TParent = Record<PropertyKey, never>,
  TContext = Record<PropertyKey, never>,
  TArgs = Record<PropertyKey, never>,
> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<
  TTypes,
  TParent = Record<PropertyKey, never>,
  TContext = Record<PropertyKey, never>,
> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo,
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<
  T = Record<PropertyKey, never>,
  TContext = Record<PropertyKey, never>,
> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<
  TResult = Record<PropertyKey, never>,
  TParent = Record<PropertyKey, never>,
  TContext = Record<PropertyKey, never>,
  TArgs = Record<PropertyKey, never>,
> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => TResult | Promise<TResult>;

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  Appointment: ResolverTypeWrapper<Appointment>;
  AppointmentStatus: AppointmentStatus;
  AppointmentType: AppointmentType;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CreateAppointmentInput: CreateAppointmentInput;
  CreateMedicalRecordInput: CreateMedicalRecordInput;
  CreateMedicationInput: CreateMedicationInput;
  CreatePetInput: CreatePetInput;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  MedicalRecord: ResolverTypeWrapper<MedicalRecord>;
  MedicalRecordType: MedicalRecordType;
  Medication: ResolverTypeWrapper<Medication>;
  MedicationFrequency: MedicationFrequency;
  MedicationStatus: MedicationStatus;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Pet: ResolverTypeWrapper<Pet>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  SosAlert: ResolverTypeWrapper<SosAlert>;
  Species: Species;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Subscription: ResolverTypeWrapper<Record<PropertyKey, never>>;
  SyncStatus: ResolverTypeWrapper<SyncStatus>;
  TriggerSosInput: TriggerSosInput;
  UpdateAppointmentInput: UpdateAppointmentInput;
  UpdateMedicationInput: UpdateMedicationInput;
  UpdatePetInput: UpdatePetInput;
  User: ResolverTypeWrapper<User>;
  UserRole: UserRole;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Appointment: Appointment;
  Boolean: Scalars['Boolean']['output'];
  CreateAppointmentInput: CreateAppointmentInput;
  CreateMedicalRecordInput: CreateMedicalRecordInput;
  CreateMedicationInput: CreateMedicationInput;
  CreatePetInput: CreatePetInput;
  DateTime: Scalars['DateTime']['output'];
  Float: Scalars['Float']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  MedicalRecord: MedicalRecord;
  Medication: Medication;
  Mutation: Record<PropertyKey, never>;
  Pet: Pet;
  Query: Record<PropertyKey, never>;
  SosAlert: SosAlert;
  String: Scalars['String']['output'];
  Subscription: Record<PropertyKey, never>;
  SyncStatus: SyncStatus;
  TriggerSosInput: TriggerSosInput;
  UpdateAppointmentInput: UpdateAppointmentInput;
  UpdateMedicationInput: UpdateMedicationInput;
  UpdatePetInput: UpdatePetInput;
  User: User;
}>;

export type AppointmentResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['Appointment'] = ResolversParentTypes['Appointment'],
> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  durationMinutes?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pet?: Resolver<Maybe<ResolversTypes['Pet']>, ParentType, ContextType>;
  petId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['AppointmentStatus'], ParentType, ContextType>;
  time?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['AppointmentType'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  vet?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  vetId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export interface DateTimeScalarConfig
  extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type MedicalRecordResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['MedicalRecord'] = ResolversParentTypes['MedicalRecord'],
> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  diagnosis?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nextVisitDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pet?: Resolver<Maybe<ResolversTypes['Pet']>, ParentType, ContextType>;
  petId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  treatment?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['MedicalRecordType'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  vet?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  vetId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  visitDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type MedicationResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['Medication'] = ResolversParentTypes['Medication'],
> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  dosage?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  durationDays?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  endDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  frequency?: Resolver<ResolversTypes['MedicationFrequency'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  instructions?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pet?: Resolver<Maybe<ResolversTypes['Pet']>, ParentType, ContextType>;
  petId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  startDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['MedicationStatus'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type MutationResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation'],
> = ResolversObject<{
  createAppointment?: Resolver<
    ResolversTypes['Appointment'],
    ParentType,
    ContextType,
    RequireFields<MutationCreateAppointmentArgs, 'input'>
  >;
  createMedicalRecord?: Resolver<
    ResolversTypes['MedicalRecord'],
    ParentType,
    ContextType,
    RequireFields<MutationCreateMedicalRecordArgs, 'input'>
  >;
  createMedication?: Resolver<
    ResolversTypes['Medication'],
    ParentType,
    ContextType,
    RequireFields<MutationCreateMedicationArgs, 'input'>
  >;
  createPet?: Resolver<
    ResolversTypes['Pet'],
    ParentType,
    ContextType,
    RequireFields<MutationCreatePetArgs, 'input'>
  >;
  deletePet?: Resolver<
    ResolversTypes['Boolean'],
    ParentType,
    ContextType,
    RequireFields<MutationDeletePetArgs, 'id'>
  >;
  triggerSos?: Resolver<
    ResolversTypes['SosAlert'],
    ParentType,
    ContextType,
    RequireFields<MutationTriggerSosArgs, 'input'>
  >;
  updateAppointment?: Resolver<
    ResolversTypes['Appointment'],
    ParentType,
    ContextType,
    RequireFields<MutationUpdateAppointmentArgs, 'id' | 'input'>
  >;
  updateMedication?: Resolver<
    ResolversTypes['Medication'],
    ParentType,
    ContextType,
    RequireFields<MutationUpdateMedicationArgs, 'id' | 'input'>
  >;
  updatePet?: Resolver<
    ResolversTypes['Pet'],
    ParentType,
    ContextType,
    RequireFields<MutationUpdatePetArgs, 'id' | 'input'>
  >;
}>;

export type PetResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['Pet'] = ResolversParentTypes['Pet'],
> = ResolversObject<{
  appointments?: Resolver<Array<ResolversTypes['Appointment']>, ParentType, ContextType>;
  breed?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  dateOfBirth?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  medicalRecords?: Resolver<Array<ResolversTypes['MedicalRecord']>, ParentType, ContextType>;
  medications?: Resolver<Array<ResolversTypes['Medication']>, ParentType, ContextType>;
  microchipId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  owner?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  ownerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  photoUrl?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  species?: Resolver<ResolversTypes['Species'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type QueryResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query'],
> = ResolversObject<{
  appointment?: Resolver<
    Maybe<ResolversTypes['Appointment']>,
    ParentType,
    ContextType,
    RequireFields<QueryAppointmentArgs, 'id'>
  >;
  me?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  medicalRecord?: Resolver<
    Maybe<ResolversTypes['MedicalRecord']>,
    ParentType,
    ContextType,
    RequireFields<QueryMedicalRecordArgs, 'id'>
  >;
  medication?: Resolver<
    Maybe<ResolversTypes['Medication']>,
    ParentType,
    ContextType,
    RequireFields<QueryMedicationArgs, 'id'>
  >;
  myAppointments?: Resolver<Array<ResolversTypes['Appointment']>, ParentType, ContextType>;
  myPets?: Resolver<Array<ResolversTypes['Pet']>, ParentType, ContextType>;
  pet?: Resolver<
    Maybe<ResolversTypes['Pet']>,
    ParentType,
    ContextType,
    RequireFields<QueryPetArgs, 'id'>
  >;
  petAppointments?: Resolver<
    Array<ResolversTypes['Appointment']>,
    ParentType,
    ContextType,
    RequireFields<QueryPetAppointmentsArgs, 'petId'>
  >;
  petMedicalRecords?: Resolver<
    Array<ResolversTypes['MedicalRecord']>,
    ParentType,
    ContextType,
    RequireFields<QueryPetMedicalRecordsArgs, 'petId'>
  >;
  petMedications?: Resolver<
    Array<ResolversTypes['Medication']>,
    ParentType,
    ContextType,
    RequireFields<QueryPetMedicationsArgs, 'petId'>
  >;
  user?: Resolver<
    Maybe<ResolversTypes['User']>,
    ParentType,
    ContextType,
    RequireFields<QueryUserArgs, 'id'>
  >;
  users?: Resolver<Array<ResolversTypes['User']>, ParentType, ContextType>;
}>;

export type SosAlertResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['SosAlert'] = ResolversParentTypes['SosAlert'],
> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  latitude?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  longitude?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  petId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  triggeredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type SubscriptionResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription'],
> = ResolversObject<{
  sosAlert?: SubscriptionResolver<ResolversTypes['SosAlert'], 'sosAlert', ParentType, ContextType>;
  syncStatus?: SubscriptionResolver<
    ResolversTypes['SyncStatus'],
    'syncStatus',
    ParentType,
    ContextType
  >;
}>;

export type SyncStatusResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['SyncStatus'] = ResolversParentTypes['SyncStatus'],
> = ResolversObject<{
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type UserResolvers<
  ContextType = GraphQLContext,
  ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User'],
> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isEmailVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lastLoginAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pets?: Resolver<Array<ResolversTypes['Pet']>, ParentType, ContextType>;
  phone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  role?: Resolver<ResolversTypes['UserRole'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type Resolvers<ContextType = GraphQLContext> = ResolversObject<{
  Appointment?: AppointmentResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  MedicalRecord?: MedicalRecordResolvers<ContextType>;
  Medication?: MedicationResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Pet?: PetResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  SosAlert?: SosAlertResolvers<ContextType>;
  Subscription?: SubscriptionResolvers<ContextType>;
  SyncStatus?: SyncStatusResolvers<ContextType>;
  User?: UserResolvers<ContextType>;
}>;
