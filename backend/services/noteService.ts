import crypto from 'crypto';

import * as StellarSdk from '@stellar/stellar-sdk';

import config from '../config';
import { query } from '../src/db';

export type ClinicalNoteAttachment = {
  type: 'measurement' | 'photo';
  label: string;
  value: string;
  metadata?: Record<string, string>;
};

export type ClinicalNoteAccessControl = {
  role: 'owner' | 'vet' | 'clinic' | 'guest';
  entityId: string;
  permission: 'read' | 'comment' | 'edit';
};

export interface ClinicalNotePayload {
  vetId: string;
  petId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  attachments?: ClinicalNoteAttachment[];
  accessControls?: ClinicalNoteAccessControl[];
}

export interface ClinicalNoteRecord extends ClinicalNotePayload {
  id: string;
  stellar_tx_hash?: string | null;
  status: 'draft' | 'anchored';
  created_at: string;
  updated_at: string;
}

export interface ClinicalNoteShareInfo {
  id: string;
  pet_id: string;
  vet_id: string;
  access_controls: ClinicalNoteAccessControl[];
  stellar_tx_hash?: string | null;
  status: 'draft' | 'anchored';
  created_at: string;
  updated_at: string;
}

export class NoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteValidationError';
  }
}

export class NoteAnchoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteAnchoringError';
  }
}

export interface NoteAnchorOptions {
  sourceSecret?: string;
  network?: 'testnet' | 'mainnet';
}

export class NoteService {
  validateSoapNotePayload(payload: ClinicalNotePayload): void {
    const required = ['vetId', 'petId', 'subjective', 'objective', 'assessment', 'plan'] as const;

    for (const field of required) {
      const value = payload[field]?.toString().trim();
      if (!value) {
        throw new NoteValidationError(`${field} is required and cannot be empty`);
      }
    }

    if (payload.attachments !== undefined) {
      if (!Array.isArray(payload.attachments)) {
        throw new NoteValidationError('attachments must be an array');
      }
      payload.attachments.forEach((attachment, index) => {
        if (!attachment || typeof attachment !== 'object') {
          throw new NoteValidationError(`attachments[${index}] must be an object`);
        }
        if (!attachment.type || !['measurement', 'photo'].includes(attachment.type)) {
          throw new NoteValidationError(
            `attachments[${index}].type must be either 'measurement' or 'photo'`,
          );
        }
        if (!attachment.label?.trim() || !attachment.value?.trim()) {
          throw new NoteValidationError(
            `attachments[${index}] must include a non-empty label and value`,
          );
        }
      });
    }

    if (payload.accessControls !== undefined) {
      if (!Array.isArray(payload.accessControls)) {
        throw new NoteValidationError('accessControls must be an array');
      }
      payload.accessControls.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          throw new NoteValidationError(`accessControls[${index}] must be an object`);
        }
        if (!entry.entityId?.trim()) {
          throw new NoteValidationError(`accessControls[${index}].entityId is required`);
        }
        if (!entry.role || !['owner', 'vet', 'clinic', 'guest'].includes(entry.role)) {
          throw new NoteValidationError(
            `accessControls[${index}].role must be one of owner, vet, clinic, or guest`,
          );
        }
        if (!entry.permission || !['read', 'comment', 'edit'].includes(entry.permission)) {
          throw new NoteValidationError(
            `accessControls[${index}].permission must be one of read, comment, or edit`,
          );
        }
      });
    }
  }

  async createClinicalNote(
    payload: ClinicalNotePayload,
    options: NoteAnchorOptions = {},
  ): Promise<ClinicalNoteRecord> {
    this.validateSoapNotePayload(payload);

    const normalized = this.normalizePayload(payload);
    await this.ensurePetExists(normalized.petId);
    await this.ensureVetExists(normalized.vetId);

    const inserted = await query(
      `INSERT INTO clinical_notes
          (vet_id, pet_id, subjective, objective, assessment, plan, attachments, access_controls, stellar_tx_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', NOW(), NOW())
       RETURNING id, vet_id, pet_id, subjective, objective, assessment, plan, attachments, access_controls, stellar_tx_hash, status, created_at, updated_at`,
      [
        normalized.vetId,
        normalized.petId,
        normalized.subjective,
        normalized.objective,
        normalized.assessment,
        normalized.plan,
        JSON.stringify(normalized.attachments),
        JSON.stringify(normalized.accessControls),
        null,
      ],
    );

    const note = inserted.rows[0] as ClinicalNoteRecord;
    const anchor = await this.anchorClinicalNote(note.id, normalized, options);

    const updated = await query(
      `UPDATE clinical_notes
       SET stellar_tx_hash = $1, status = 'anchored', updated_at = NOW()
       WHERE id = $2
       RETURNING id, vet_id, pet_id, subjective, objective, assessment, plan, attachments, access_controls, stellar_tx_hash, status, created_at, updated_at`,
      [anchor.stellarTxHash, note.id],
    );

    return updated.rows[0] as ClinicalNoteRecord;
  }

  async getClinicalNoteShareInfo(noteId: string): Promise<ClinicalNoteShareInfo> {
    if (!noteId?.trim()) {
      throw new NoteValidationError('noteId is required');
    }

    const result = await query(
      `SELECT id, pet_id, vet_id, access_controls, stellar_tx_hash, status, created_at, updated_at
       FROM clinical_notes
       WHERE id = $1`,
      [noteId.trim()],
    );

    if (!result.rows[0]) {
      throw new Error('Clinical note not found');
    }

    return result.rows[0] as ClinicalNoteShareInfo;
  }

  async anchorClinicalNote(
    noteId: string,
    payload: ClinicalNotePayload,
    options: NoteAnchorOptions = {},
  ): Promise<{ stellarTxHash: string; noteHash: string }> {
    const sourceSecret = options.sourceSecret ?? process.env.STELLAR_SOURCE_SECRET;
    if (!sourceSecret || !sourceSecret.trim()) {
      throw new NoteAnchoringError('Stellar source secret is not configured');
    }

    const network = options.network ?? (config.isProd ? 'mainnet' : 'testnet');
    const server = this.getServer(network);
    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret.trim());
    const account = await server.loadAccount(keypair.publicKey());
    const baseFee = Number(await server.fetchBaseFee());
    const noteHash = this.compileNoteHash(payload);

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: String(Math.max(baseFee, Number(StellarSdk.BASE_FEE))),
      networkPassphrase: this.getNetworkPassphrase(network),
    })
      .addMemo(StellarSdk.Memo.hash(Buffer.from(noteHash, 'hex')))
      .addOperation(
        StellarSdk.Operation.manageData({
          name: `clinical_note:${noteId}`.slice(0, 64),
          value: noteHash,
        }),
      )
      .setTimeout(90)
      .build();

    transaction.sign(keypair);

    try {
      const result = await server.submitTransaction(transaction);
      if (!result.hash) {
        throw new NoteAnchoringError('Stellar anchor transaction completed without a hash');
      }
      return { stellarTxHash: result.hash, noteHash };
    } catch (error) {
      throw new NoteAnchoringError(
        error instanceof Error ? error.message : 'Failed to submit transaction to Stellar ledger',
      );
    }
  }

  compileNoteHash(payload: ClinicalNotePayload): string {
    const notePayload = {
      vetId: payload.vetId.trim(),
      petId: payload.petId.trim(),
      subjective: payload.subjective.trim(),
      objective: payload.objective.trim(),
      assessment: payload.assessment.trim(),
      plan: payload.plan.trim(),
      attachments: payload.attachments ?? [],
      accessControls: payload.accessControls ?? [],
    };

    return crypto.createHash('sha256').update(stableStringify(notePayload)).digest('hex');
  }

  private normalizePayload(payload: ClinicalNotePayload): ClinicalNotePayload {
    return {
      vetId: payload.vetId.trim(),
      petId: payload.petId.trim(),
      subjective: payload.subjective.trim(),
      objective: payload.objective.trim(),
      assessment: payload.assessment.trim(),
      plan: payload.plan.trim(),
      attachments: (payload.attachments ?? []).map((attachment) => ({
        type: attachment.type,
        label: attachment.label.trim(),
        value: attachment.value.trim(),
        metadata: attachment.metadata ?? {},
      })),
      accessControls: (payload.accessControls ?? []).map((entry) => ({
        role: entry.role,
        entityId: entry.entityId.trim(),
        permission: entry.permission,
      })),
    };
  }

  private async ensurePetExists(petId: string): Promise<void> {
    const result = await query('SELECT 1 FROM pets WHERE id = $1', [petId]);
    if (!result.rows.length) {
      throw new NoteValidationError('petId must reference an existing pet');
    }
  }

  private async ensureVetExists(vetId: string): Promise<void> {
    const result = await query('SELECT 1 FROM users WHERE id = $1 AND role = $2', [vetId, 'vet']);
    if (!result.rows.length) {
      throw new NoteValidationError('vetId must reference an existing vet user');
    }
  }

  private getServer(network: 'testnet' | 'mainnet'): StellarSdk.Horizon.Server {
    return new StellarSdk.Horizon.Server(
      network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org',
    );
  }

  private getNetworkPassphrase(network: 'testnet' | 'mainnet'): string {
    return network === 'mainnet' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export const noteService = new NoteService();
export default noteService;
