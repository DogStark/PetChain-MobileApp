/**
 * Generic API response wrapper for successful responses
 */
export interface ApiResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

/**
 * Generic API error response
 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    stack?: string;
  };
  timestamp: string;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T = any> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
  timestamp: string;
}

/**
 * Pagination request parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Authentication - Login Request
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Authentication - Login Response
 */
export interface LoginResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  token: string;
  refreshToken?: string;
  expiresIn: number;
}

/**
 * Authentication - Register Request
 */
export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
  phone?: string;
  role?: string;
}

/**
 * Authentication - Register Response
 */
export interface RegisterResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  token: string;
  refreshToken?: string;
}

/**
 * Authentication - Refresh Token Request
 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * Authentication - Refresh Token Response
 */
export interface RefreshTokenResponse {
  token: string;
  refreshToken?: string;
  expiresIn: number;
}

/**
 * User - Get User Response
 */
export interface GetUserResponse {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  pets: Array<{
    id: string;
    name?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  isEmailVerified: boolean;
  lastLoginAt?: string;
}

/**
 * User - Update User Request
 */
export interface UpdateUserRequest {
  name?: string;
  phone?: string;
  role?: string;
}

/**
 * User - Update User Response
 */
export interface UpdateUserResponse {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  updatedAt: string;
}

/**
 * User - List Users Request
 */
export interface ListUsersRequest extends PaginationParams {
  role?: string;
  search?: string;
}

/**
 * Pet - Create Pet Request
 */
export interface CreatePetRequest {
  name: string;
  species: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  ownerId: string;
}

/**
 * Pet - Create Pet Response
 */
export interface CreatePetResponse {
  id: string;
  name: string;
  species: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pet - Get Pet Response
 */
export interface GetPetResponse {
  id: string;
  name: string;
  species: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  ownerId: string;
  owner?: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Pet - Update Pet Request
 */
export interface UpdatePetRequest {
  name?: string;
  species?: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
}

/**
 * Server-confirmed permission for resolving profile edits.
 */
export interface PetEditPermissionResponse {
  canEdit: boolean;
  reason?: string;
  revision?: string;
}

/**
 * Pet - List Pets Request
 */
export interface ListPetsRequest extends PaginationParams {
  ownerId?: string;
  species?: string;
  search?: string;
}

/**
 * Medical Record - Create Medical Record Request
 */
export interface CreateMedicalRecordRequest {
  petId: string;
  vetId: string;
  type: 'checkup' | 'vaccination' | 'surgery' | 'treatment' | 'other';
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visitDate: string;
  nextVisitDate?: string;
}

/**
 * Medical Record - Create Medical Record Response
 */
export interface CreateMedicalRecordResponse {
  id: string;
  petId: string;
  vetId: string;
  type: string;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visitDate: string;
  nextVisitDate?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Medical Record - Get Medical Record Response
 */
export interface GetMedicalRecordResponse {
  id: string;
  petId: string;
  vetId: string;
  vet?: {
    id: string;
    name: string;
    email: string;
  };
  type: string;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visitDate: string;
  nextVisitDate?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Medical Record - List Medical Records Request
 */
export interface ListMedicalRecordsRequest extends PaginationParams {
  petId?: string;
  vetId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * API Endpoint paths
 */
export const API_ENDPOINTS = {
  // Authentication
  AUTH_LOGIN: '/auth/login',
  AUTH_REGISTER: '/auth/register',
  AUTH_REFRESH: '/auth/refresh',
  AUTH_LOGOUT: '/auth/logout',
  AUTH_VERIFY_EMAIL: '/auth/verify-email',
  AUTH_FORGOT_PASSWORD: '/auth/forgot-password',
  AUTH_RESET_PASSWORD: '/auth/reset-password',

  // Users
  USERS_LIST: '/users',
  USERS_GET: '/users/:id',
  USERS_CREATE: '/users',
  USERS_UPDATE: '/users/:id',
  USERS_DELETE: '/users/:id',
  USERS_ME: '/users/me',

  // Pets
  PETS_LIST: '/pets',
  PETS_GET: '/pets/:id',
  PETS_CREATE: '/pets',
  PETS_UPDATE: '/pets/:id',
  PETS_DELETE: '/pets/:id',
  PETS_EDIT_PERMISSION: '/pets/:id/edit-permission',
  PETS_BY_OWNER: '/pets/owner/:ownerId',

  // Medical Records
  MEDICAL_RECORDS_LIST: '/medical-records',
  MEDICAL_RECORDS_GET: '/medical-records/:id',
  MEDICAL_RECORDS_CREATE: '/medical-records',
  MEDICAL_RECORDS_UPDATE: '/medical-records/:id',
  MEDICAL_RECORDS_DELETE: '/medical-records/:id',
  MEDICAL_RECORDS_BY_PET: '/medical-records/pet/:petId',
} as const;

/**
 * HTTP Methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * API Request configuration
 */
export interface ApiRequestConfig {
  method: HttpMethod;
  endpoint: string;
  params?: Record<string, any>;
  data?: any;
  headers?: Record<string, string>;
}

/**
 * Type guard to check if response is an error
 */
export function isApiError(response: ApiResponse | ApiError): response is ApiError {
  return response.success === false;
}

/**
 * Type guard to check if response is paginated
 */
export function isPaginatedResponse<T>(
  response: ApiResponse<T> | PaginatedResponse<T>
): response is PaginatedResponse<T> {
  return 'pagination' in response;
}
