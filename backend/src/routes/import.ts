import express from 'express';

import { ok, sendError } from '../../server/response';
import { importCsvRecords } from '../../services/csvImportService';

const router = express.Router();

// POST /import/csv
router.post('/csv', async (req, res) => {
  const csv = req.body?.csv;
  if (!csv || typeof csv !== 'string') {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Request must include `csv` string in JSON body',
    );
  }

  try {
    const result = await importCsvRecords(csv);
    return res.status(200).json(ok(result));
  } catch (err: any) {
    return sendError(res, 500, 'IMPORT_ERROR', String(err?.message || err));
  }
});

export default router;
