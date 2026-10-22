import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import noteService, {
  type ClinicalNotePayload,
  NoteAnchoringError,
  NoteValidationError,
} from '../../services/noteService';

const router = express.Router();
router.use(authenticateJWT);

router.post(
  '/',
  authorizeRoles(UserRole.ADMIN, UserRole.VET),
  async (req: AuthenticatedRequest, res) => {
    const body = req.body as ClinicalNotePayload & {
      sourceSecret?: string;
      network?: 'testnet' | 'mainnet';
    };

    try {
      const note = await noteService.createClinicalNote(body, {
        sourceSecret: body.sourceSecret,
        network: body.network,
      });
      return res.status(201).json(ok(note, 'Clinical note created and anchored.'));
    } catch (error) {
      if (error instanceof NoteValidationError) {
        return sendError(res, 400, 'VALIDATION_ERROR', error.message);
      }
      if (error instanceof NoteAnchoringError) {
        return sendError(res, 502, 'STELLAR_ANCHOR_FAILED', error.message);
      }
      return sendError(
        res,
        500,
        'CLINICAL_NOTE_ERROR',
        error instanceof Error ? error.message : 'Failed to create clinical note',
      );
    }
  },
);

router.get(
  '/:id/share',
  authorizeRoles(UserRole.ADMIN, UserRole.VET),
  async (req: AuthenticatedRequest, res) => {
    const noteId = req.params.id?.trim();
    if (!noteId) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Note ID is required');
    }

    try {
      const shareInfo = await noteService.getClinicalNoteShareInfo(noteId);
      return res.json(ok(shareInfo));
    } catch (error) {
      if (error instanceof NoteValidationError) {
        return sendError(res, 400, 'VALIDATION_ERROR', error.message);
      }
      return sendError(
        res,
        500,
        'SHARE_INFO_ERROR',
        error instanceof Error ? error.message : 'Unable to load access controls',
      );
    }
  },
);

export default router;
