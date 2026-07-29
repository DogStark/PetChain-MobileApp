/**
 * Centralised API endpoint paths.
 *
 * Every backend path used by a service should live here rather than being
 * written inline, so that a route change is a one-line edit in a single file.
 *
 * Paths are **root-relative** and must not repeat the `/api` prefix — that is
 * already part of `config.api.baseUrl` (see `src/config/index.ts`), which the
 * API client prepends to each request.
 *
 * Parameterised routes are exposed as functions so callers never build paths by
 * string concatenation:
 *
 * ```ts
 * import { API_ENDPOINTS } from '../config/apiEndpoints';
 *
 * api.get(API_ENDPOINTS.pets.list);
 * api.get(API_ENDPOINTS.pets.byId(petId));
 * ```
 */

/** Percent-encodes a path segment so ids containing `/` or spaces stay safe. */
const seg = (value: string | number): string => encodeURIComponent(String(value));

export const API_ENDPOINTS = {
  // -------------------------------------------------------------------------
  // Auth & identity
  // -------------------------------------------------------------------------
  auth: {
    register: '/auth/register',
    login: '/auth/login',
    forgotPassword: '/auth/forgot-password',
    twoFactor: {
      setup: '/auth/2fa/setup',
      verifySetup: '/auth/2fa/verify-setup',
      verify: '/auth/2fa/verify',
      disable: '/auth/2fa/disable',
      backupVerify: '/auth/2fa/backup-verify',
      backupRegenerate: '/auth/2fa/backup-regenerate',
      recoveryRequest: '/auth/2fa/recovery/request',
      recoveryVerify: '/auth/2fa/recovery/verify',
    },
    oauth: {
      providers: '/auth/oauth/providers',
      pkceInit: '/auth/oauth/pkce-init',
      google: '/auth/oauth/google',
      apple: '/auth/oauth/apple',
      facebook: '/auth/oauth/facebook',
      link: '/auth/oauth/link',
      refresh: '/auth/oauth/refresh',
      revoke: '/auth/oauth/revoke',
    },
  },

  users: {
    me: '/users/me',
    list: '/users',
    create: '/users',
    byId: (userId: string) => `/users/${seg(userId)}`,
    update: (userId: string) => `/users/${seg(userId)}`,
  },

  // -------------------------------------------------------------------------
  // Pets
  // -------------------------------------------------------------------------
  pets: {
    list: '/pets',
    create: '/pets',
    byId: (petId: string) => `/pets/${seg(petId)}`,
    update: (petId: string) => `/pets/${seg(petId)}`,
    remove: (petId: string) => `/pets/${seg(petId)}`,
    byOwner: (ownerId: string) => `/pets/owner/${seg(ownerId)}`,
    medicalRecords: (petId: string) => `/pets/${seg(petId)}/medical-records`,
    /** Issue a QR identity tag for a pet. */
    createQrIdentity: (petId: string) => `/pets/${seg(petId)}/qr-identity`,
    /** Resolve a scanned QR code to its pet. */
    byQrCode: (qrCode: string) => `/pets/qr/${seg(qrCode)}`,
    /** Public identity lookup via a share token. */
    identity: (token: string) => `/pets/identity/${seg(token)}`,
    identityView: (token: string) => `/pets/identity/${seg(token)}/view`,
  },

  photos: {
    upload: '/photos',
    byPet: (petId: string) => `/photos/pet/${seg(petId)}`,
    byId: (photoId: string) => `/photos/${seg(photoId)}`,
    remove: (photoId: string) => `/photos/${seg(photoId)}`,
  },

  // -------------------------------------------------------------------------
  // Appointments & telemedicine
  // -------------------------------------------------------------------------
  appointments: {
    list: '/appointments',
    create: '/appointments',
    availability: '/appointments/availability',
    checkConflicts: '/appointments/check-conflicts',
    byId: (appointmentId: string) => `/appointments/${seg(appointmentId)}`,
    update: (appointmentId: string) => `/appointments/${seg(appointmentId)}`,
    cancel: (appointmentId: string) => `/appointments/${seg(appointmentId)}/cancel`,
    reschedule: (appointmentId: string) => `/appointments/${seg(appointmentId)}/reschedule`,
    remove: (appointmentId: string) => `/appointments/${seg(appointmentId)}`,
  },

  telemedicine: {
    root: '/telemedicine',
    availability: '/telemedicine/availability',
    createAppointment: '/telemedicine/appointments',
    pendingQuestionnaires: '/telemedicine/pending-questionnaires',
    questionnaire: (consultationId: string) => `/telemedicine/${seg(consultationId)}/questionnaire`,
    noShow: (consultationId: string) => `/telemedicine/${seg(consultationId)}/no-show`,
    reschedule: (consultationId: string) => `/telemedicine/${seg(consultationId)}/reschedule`,
  },

  // -------------------------------------------------------------------------
  // Clinical records
  // -------------------------------------------------------------------------
  medicalRecords: {
    list: '/medical-records',
    create: '/medical-records',
    search: '/medical-records/search',
    signedAttachmentUrl: '/medical-records/attachments/signed-url',
    byPet: (petId: string) => `/medical-records/pet/${seg(petId)}`,
    byId: (recordId: string) => `/medical-records/${seg(recordId)}`,
    update: (recordId: string) => `/medical-records/${seg(recordId)}`,
    anchor: (recordId: string) => `/medical-records/${seg(recordId)}/anchor`,
    anchorStatus: (recordId: string) => `/medical-records/${seg(recordId)}/anchor-status`,
  },

  medications: {
    list: '/medications',
    create: '/medications',
    byId: (medicationId: string) => `/medications/${seg(medicationId)}`,
    update: (medicationId: string) => `/medications/${seg(medicationId)}`,
    remove: (medicationId: string) => `/medications/${seg(medicationId)}`,
    createDosageApproval: '/medications/dosage-approvals',
    dosageApproval: (approvalId: string) => `/medications/dosage-approvals/${seg(approvalId)}`,
  },

  vaccinations: {
    schedules: '/vaccinations/schedules',
    administered: '/vaccinations/administered',
    anchorCertificate: '/vaccinations/certificates/anchor',
    reminders: (petId: string) => `/vaccinations/pets/${seg(petId)}/reminders`,
    certificate: (petId: string) => `/vaccinations/pets/${seg(petId)}/certificate`,
  },

  healthAlerts: {
    list: '/health-alerts',
    runDaily: '/health-alerts/run-daily',
    dismiss: (alertId: string) => `/health-alerts/${seg(alertId)}/dismiss`,
  },

  nutrition: {
    logs: '/nutrition/logs',
    logById: (logId: string) => `/nutrition/logs/${seg(logId)}`,
    createGoal: '/nutrition/goals',
    goalByPet: (petId: string) => `/nutrition/goals/${seg(petId)}`,
    calculateCalories: '/nutrition/calculate-calories',
    recommendations: '/nutrition/recommendations',
    dailySummary: '/nutrition/summary/daily',
    weeklyReport: '/nutrition/reports/weekly',
    searchFoods: '/nutrition/foods/search',
  },

  notes: {
    list: '/notes',
    create: '/notes',
  },

  // -------------------------------------------------------------------------
  // Documents & certificates
  // -------------------------------------------------------------------------
  documents: {
    list: '/documents',
    create: '/documents',
    byId: (documentId: string) => `/documents/${seg(documentId)}`,
    remove: (documentId: string) => `/documents/${seg(documentId)}`,
    versions: (documentId: string) => `/documents/${seg(documentId)}/versions`,
    restore: (documentId: string) => `/documents/${seg(documentId)}/restore`,
    quota: (ownerId: string) => `/documents/quota/${seg(ownerId)}`,
  },

  travelCertificates: {
    generate: '/travel-certificates/generate',
  },

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  notifications: {
    tokens: '/notifications/tokens',
    allTokens: '/notifications/tokens/all',
    subscriptions: '/notifications/subscriptions',
    subscriptionByTopic: (topic: string) => `/notifications/subscriptions/${seg(topic)}`,
    preferences: '/notifications/preferences',
    send: '/notifications/send',
    metrics: '/notifications/metrics',
    deadLetterQueue: '/notifications/dlq',
    timezone: '/notifications/timezone',
    vaccinationTransfer: '/notifications/vaccination-transfer',
  },

  reminders: {
    snooze: '/reminders/snooze',
  },

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------
  search: {
    root: '/search',
  },

  breeds: {
    list: '/breeds',
  },

  clinics: {
    list: '/clinics',
  },

  vets: {
    list: '/vets',
    create: '/vets',
    byId: (vetId: string) => `/vets/${seg(vetId)}`,
    messages: (vetId: string) => `/vets/messages/${seg(vetId)}`,
  },

  // -------------------------------------------------------------------------
  // Safety
  // -------------------------------------------------------------------------
  lostFound: {
    root: '/lost-found',
    reports: '/lost-found/reports',
    location: '/lost-found/location',
    notifyOwners: '/lost-found/notify-owners',
    matches: (reportId: string) => `/lost-found/reports/${seg(reportId)}/matches`,
  },

  emergency: {
    sessions: '/emergency/sessions',
    session: (shareToken: string) => `/emergency/sessions/${seg(shareToken)}`,
    sessionView: (shareToken: string) => `/emergency/sessions/${seg(shareToken)}/view`,
    sessionLocation: (shareToken: string) => `/emergency/sessions/${seg(shareToken)}/location`,
    cancelSession: (shareToken: string) => `/emergency/sessions/${seg(shareToken)}/cancel`,
  },

  // -------------------------------------------------------------------------
  // Payments & insurance
  // -------------------------------------------------------------------------
  payments: {
    plans: '/payments/plans',
    subscription: '/payments/subscription',
    initiate: '/payments/initiate',
    history: '/payments/history',
    confirm: (paymentId: string) => `/payments/${seg(paymentId)}/confirm`,
    stellar: {
      prepare: '/payments/stellar/prepare',
      submit: '/payments/stellar/submit',
      audits: '/payments/stellar/audits',
    },
  },

  insurance: {
    policies: '/insurance/policies',
    claims: '/insurance/claims',
    connect: '/insurance/connect',
  },

  referrals: {
    me: '/referrals/me',
    apply: '/referrals/apply',
  },

  reconciliation: {
    run: '/reconciliation/run',
    reports: '/reconciliation/reports',
    summary: '/reconciliation/summary',
    startScheduler: '/reconciliation/scheduler/start',
    stopScheduler: '/reconciliation/scheduler/stop',
  },

  // -------------------------------------------------------------------------
  // Blockchain
  // -------------------------------------------------------------------------
  blockchain: {
    storeRecord: '/blockchain/records/store',
    verifyRecord: '/blockchain/records/verify',
    anchor: '/anchor',
  },

  // -------------------------------------------------------------------------
  // Sync, activity & backups
  // -------------------------------------------------------------------------
  sync: {
    push: '/sync/push',
  },

  activity: {
    connect: '/activity/connect',
    sync: '/activity/sync',
  },

  cloudSync: {
    backup: '/cloud-sync/backup',
    restore: '/cloud-sync/restore',
  },

  backups: {
    me: '/backups/me',
  },

  // -------------------------------------------------------------------------
  // Observability & platform
  // -------------------------------------------------------------------------
  analytics: {
    events: '/analytics/events',
  },

  monitoring: {
    events: '/monitoring/events',
    crashes: '/monitoring/crashes',
    alerts: '/monitoring/alerts',
    startSession: '/monitoring/sessions/start',
    endSession: '/monitoring/sessions/end',
    crashFreeRate: '/monitoring/analytics/crash-free',
  },

  errors: {
    report: '/errors',
  },

  audit: {
    conflicts: '/audit/conflicts',
  },

  compliance: {
    consent: '/compliance/consent',
  },

  app: {
    versionCheck: '/app/version-check',
  },
} as const;

export type ApiEndpoints = typeof API_ENDPOINTS;
export type ApiDomain = keyof ApiEndpoints;

export default API_ENDPOINTS;
