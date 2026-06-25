/**
 * Frontend multisig service — wraps backend API calls for joint pet ownership.
 * All Stellar SDK operations happen server-side; this service handles the
 * co-signing request flow, status polling, and key rotation from the mobile app.
 */
import apiClient from './apiClient';
import { sendAlertNotification, transferVaccinationNotifications } from './notificationService';
import type {
  JointOwnershipResponse,
  PendingTransactionResponse,
  CreateJointOwnershipRequest,
  SignTransactionRequest,
  InitiateOwnershipTransferRequest,
  InitiateRecordDeletionRequest,
  InviteCoOwnerRequest,
  KeyRotationRequest,
  CoOwnerResponse,
} from '../../backend/types/api';
import { MULTISIG_ENDPOINTS } from '../../backend/types/api';

// ─── Error ────────────────────────────────────────────────────────────────────

export class MultisigServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'MultisigServiceError';
  }
}

function toMultisigError(error: unknown): MultisigServiceError {
  if (error instanceof MultisigServiceError) return error;
  if (error instanceof Error) {
    const axiosErr = error as any;
    if (axiosErr.isAxiosError) {
      const status = axiosErr.response?.status;
      const msg =
        axiosErr.response?.data?.error?.message ||
        axiosErr.response?.data?.message ||
        axiosErr.message;
      return new MultisigServiceError(msg, `HTTP_${status ?? 'UNKNOWN'}`, status);
    }
    return new MultisigServiceError(error.message, 'UNKNOWN_ERROR');
  }
  return new MultisigServiceError('Unexpected multisig error', 'UNKNOWN_ERROR');
}

// ─── Re-export types for screens ─────────────────────────────────────────────

export type {
  JointOwnershipResponse,
  PendingTransactionResponse,
  CoOwnerResponse,
  CreateJointOwnershipRequest,
  InviteCoOwnerRequest,
  KeyRotationRequest,
};

// ─── Joint Ownership ──────────────────────────────────────────────────────────

/** Create a new joint ownership multisig account for a pet */
export async function createJointOwnership(
  data: CreateJointOwnershipRequest,
): Promise<JointOwnershipResponse> {
  try {
    const response = await apiClient.post<JointOwnershipResponse>(
      MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_CREATE,
      data,
    );
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Get joint ownership details by ID */
export async function getJointOwnership(id: string): Promise<JointOwnershipResponse> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_GET.replace(':id', encodeURIComponent(id));
    const response = await apiClient.get<JointOwnershipResponse>(endpoint);
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Get joint ownership for a specific pet */
export async function getJointOwnershipByPet(
  petId: string,
): Promise<JointOwnershipResponse | null> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_BY_PET.replace(
      ':petId',
      encodeURIComponent(petId),
    );
    const response = await apiClient.get<JointOwnershipResponse>(endpoint);
    return response.data;
  } catch (error: any) {
    if (
      error?.response?.status === 404 ||
      (error instanceof MultisigServiceError && error.status === 404)
    ) {
      return null;
    }
    throw toMultisigError(error);
  }
}

/** Invite a new co-owner to a jointly-owned pet */
export async function inviteCoOwner(data: InviteCoOwnerRequest): Promise<{ inviteId: string }> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_INVITE.replace(
      ':id',
      encodeURIComponent(data.jointOwnershipId),
    );
    const response = await apiClient.post<{ inviteId: string }>(endpoint, data);
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Accept a co-owner invite */
export async function acceptCoOwnerInvite(inviteId: string): Promise<void> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_ACCEPT_INVITE.replace(
      ':inviteId',
      encodeURIComponent(inviteId),
    );
    await apiClient.post(endpoint);
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Decline a co-owner invite */
export async function declineCoOwnerInvite(inviteId: string): Promise<void> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_DECLINE_INVITE.replace(
      ':inviteId',
      encodeURIComponent(inviteId),
    );
    await apiClient.post(endpoint);
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Get pending co-owner invites for the current user */
export async function getPendingInvites(): Promise<
  Array<{
    id: string;
    petId: string;
    petName: string;
    invitedByName: string;
    expiresAt: string;
    createdAt: string;
  }>
> {
  try {
    const response = await apiClient.get(MULTISIG_ENDPOINTS.JOINT_OWNERSHIP_PENDING_INVITES);
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

// ─── Pending Transactions ─────────────────────────────────────────────────────

/** Get all pending co-sign requests for the current user */
export async function getPendingTransactions(
  multisigAccountId?: string,
): Promise<PendingTransactionResponse[]> {
  try {
    const params = multisigAccountId ? { multisigAccountId } : {};
    const response = await apiClient.get<PendingTransactionResponse[]>(
      MULTISIG_ENDPOINTS.MULTISIG_TRANSACTIONS_PENDING,
      { params },
    );
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Get all transactions (any status) for a multisig account */
export async function getAllTransactions(
  multisigAccountId: string,
): Promise<PendingTransactionResponse[]> {
  try {
    const response = await apiClient.get<PendingTransactionResponse[]>(
      MULTISIG_ENDPOINTS.MULTISIG_TRANSACTIONS_LIST,
      { params: { multisigAccountId } },
    );
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/**
 * Sign a pending transaction.
 * The signedTransactionXdr is the base64 XDR of the transaction signed
 * with the user's Stellar keypair (done client-side or via secure enclave).
 */
export async function signTransaction(
  data: SignTransactionRequest,
): Promise<PendingTransactionResponse> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.MULTISIG_TRANSACTION_SIGN.replace(
      ':id',
      encodeURIComponent(data.transactionId),
    );
    const response = await apiClient.post<PendingTransactionResponse>(endpoint, data);
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Reject a pending transaction */
export async function rejectTransaction(
  transactionId: string,
  signerPublicKey: string,
): Promise<PendingTransactionResponse> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.MULTISIG_TRANSACTION_REJECT.replace(
      ':id',
      encodeURIComponent(transactionId),
    );
    const response = await apiClient.post<PendingTransactionResponse>(endpoint, {
      signerPublicKey,
    });
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

// ─── Critical Operations ──────────────────────────────────────────────────────

/** Initiate an ownership transfer — creates a pending multisig transaction */
export async function initiateOwnershipTransfer(
  data: InitiateOwnershipTransferRequest,
): Promise<PendingTransactionResponse> {
  try {
    const response = await apiClient.post<PendingTransactionResponse>(
      MULTISIG_ENDPOINTS.MULTISIG_OWNERSHIP_TRANSFER,
      data,
    );
    await sendAlertNotification(
      '🔑 Ownership Transfer Requested',
      'A co-owner has requested to transfer pet ownership. Your signature is required.',
      { type: 'cosign_request', transactionId: response.data.id },
    );
    // Cancel scheduled vaccination reminders on the current owner's device
    // and signal the backend to re-push them to the new owner.
    await transferVaccinationNotifications(data.petId, data.newOwnerUserId);
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

/** Initiate a record deletion — creates a pending multisig transaction */
export async function initiateRecordDeletion(
  data: InitiateRecordDeletionRequest,
): Promise<PendingTransactionResponse> {
  try {
    const response = await apiClient.post<PendingTransactionResponse>(
      MULTISIG_ENDPOINTS.MULTISIG_RECORD_DELETION,
      data,
    );
    await sendAlertNotification(
      '🗑️ Record Deletion Requested',
      'A co-owner has requested to delete a medical record. Your signature is required.',
      { type: 'cosign_request', transactionId: response.data.id },
    );
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

// ─── Key Rotation ─────────────────────────────────────────────────────────────

/** Request a signing key rotation — creates a pending signer_management transaction */
export async function requestKeyRotation(
  data: KeyRotationRequest,
): Promise<PendingTransactionResponse> {
  try {
    const response = await apiClient.post<PendingTransactionResponse>(
      MULTISIG_ENDPOINTS.MULTISIG_KEY_ROTATION,
      data,
    );
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

// ─── Account Status ───────────────────────────────────────────────────────────

/** Get the on-chain status of a multisig account */
export async function getMultisigAccountStatus(multisigAccountId: string): Promise<{
  publicKey: string;
  signers: Array<{ publicKey: string; weight: number }>;
  thresholds: { low: number; medium: number; high: number };
  balanceXlm: string;
}> {
  try {
    const endpoint = MULTISIG_ENDPOINTS.MULTISIG_ACCOUNT_STATUS.replace(
      ':multisigAccountId',
      encodeURIComponent(multisigAccountId),
    );
    const response = await apiClient.get(endpoint);
    return response.data;
  } catch (error) {
    throw toMultisigError(error);
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

/**
 * Send a local push notification to all co-owners when a new co-sign request arrives.
 * In production this would be triggered server-side via FCM/APNs.
 */
export async function notifyCoSignRequest(
  operationType: PendingTransactionResponse['operationType'],
  description: string,
  transactionId: string,
): Promise<void> {
  const titles: Record<PendingTransactionResponse['operationType'], string> = {
    ownership_transfer: '🔑 Co-sign Required: Ownership Transfer',
    record_deletion: '🗑️ Co-sign Required: Record Deletion',
    signer_management: '👤 Co-sign Required: Signer Change',
  };
  await sendAlertNotification(titles[operationType], description, {
    type: 'cosign_request',
    transactionId,
    operationType,
  });
}

const multisigService = {
  createJointOwnership,
  getJointOwnership,
  getJointOwnershipByPet,
  inviteCoOwner,
  acceptCoOwnerInvite,
  declineCoOwnerInvite,
  getPendingInvites,
  getPendingTransactions,
  getAllTransactions,
  signTransaction,
  rejectTransaction,
  initiateOwnershipTransfer,
  initiateRecordDeletion,
  requestKeyRotation,
  getMultisigAccountStatus,
  notifyCoSignRequest,
};

export default multisigService;
