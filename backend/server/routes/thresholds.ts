import express from 'express';

const router = express.Router();

/**
 * GET thresholds for a pet
 */
router.get('/:petId', async (req, res) => {
  const { petId } = req.params;

  try {
    const thresholds = await req.db.query('SELECT * FROM health_thresholds WHERE pet_id = ?', [
      petId,
    ]);

    res.json(thresholds[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch thresholds' });
  }
});

/**
 * UPDATE thresholds for a pet
 */
router.put('/:petId', async (req, res) => {
  const { petId } = req.params;
  const userId = req.user?.id;

  const {
    weight_min,
    weight_max,
    temperature_min,
    temperature_max,
    heart_rate_min,
    heart_rate_max,
    activity_min,
    activity_max,
  } = req.body;

  try {
    // BASIC SAFETY VALIDATION
    if (temperature_min < 30 || temperature_max > 45) {
      return res.status(400).json({ error: 'Unsafe temperature range' });
    }

    if (heart_rate_min < 20 || heart_rate_max > 300) {
      return res.status(400).json({ error: 'Unsafe heart rate range' });
    }

    // Check existing
    const existing = await req.db.query('SELECT * FROM health_thresholds WHERE pet_id = ?', [
      petId,
    ]);

    if (existing.length === 0) {
      await req.db.query(
        `INSERT INTO health_thresholds 
        (pet_id, weight_min, weight_max, temperature_min, temperature_max,
         heart_rate_min, heart_rate_max, activity_min, activity_max, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          petId,
          weight_min,
          weight_max,
          temperature_min,
          temperature_max,
          heart_rate_min,
          heart_rate_max,
          activity_min,
          activity_max,
          userId,
        ],
      );
    } else {
      await req.db.query(
        `UPDATE health_thresholds SET
          weight_min=?,
          weight_max=?,
          temperature_min=?,
          temperature_max=?,
          heart_rate_min=?,
          heart_rate_max=?,
          activity_min=?,
          activity_max=?,
          updated_by=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE pet_id=?`,
        [
          weight_min,
          weight_max,
          temperature_min,
          temperature_max,
          heart_rate_min,
          heart_rate_max,
          activity_min,
          activity_max,
          userId,
          petId,
        ],
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update thresholds' });
  }
});

export default router;
