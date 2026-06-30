import { query } from '../db';
import { isLikelySpam } from './moderationService';

export async function createReview(vetId: string, userId: string, rating: number, text: string) {
  // Check for verified appointment
  const aptCheck = await query(
    `SELECT id FROM appointments WHERE vet_id = $1 AND owner_id = $2 AND status = 'COMPLETED' LIMIT 1`,
    [vetId, userId]
  );
  if ((aptCheck.rowCount ?? 0) === 0) {
    throw new Error('Must have a completed appointment with this vet to leave a review.');
  }

  // Moderation
  const isSpam = isLikelySpam(text);
  // Optional: profanity check if isLikelySpam doesn't cover all profanity
  // Since moderationService is simple, we use it for our auto-moderation
  const status = isSpam ? 'pending_moderation' : 'approved';

  const res = await query(
    `INSERT INTO reviews (vet_id, user_id, rating, text, status, created_at, helpful_votes, not_helpful_votes)
     VALUES ($1, $2, $3, $4, $5, NOW(), 0, 0) RETURNING *`,
    [vetId, userId, rating, text, status]
  );
  return res.rows[0];
}

export async function getReviews(vetId: string, page: number = 1) {
  const limit = 20;
  const offset = (page - 1) * limit;
  const res = await query(
    `SELECT * FROM reviews WHERE vet_id = $1 AND status = 'approved' ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [vetId, limit, offset]
  );
  return res.rows;
}

export async function flagReview(reviewId: string, reason: string) {
  const res = await query(
    `UPDATE reviews SET status = 'flagged', flag_reason = $1 WHERE id = $2 RETURNING *`,
    [reason, reviewId]
  );
  return res.rows[0];
}

export async function voteReview(reviewId: string, isHelpful: boolean) {
  const column = isHelpful ? 'helpful_votes' : 'not_helpful_votes';
  const res = await query(
    `UPDATE reviews SET ${column} = ${column} + 1 WHERE id = $1 RETURNING *`,
    [reviewId]
  );
  return res.rows[0];
}
