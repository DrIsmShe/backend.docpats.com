import reviewService from "../../clinic-reviews/services/review.service.js";
import { getClinicPublicFeedback } from "../../clinic-reviews/services/publicFeedback.service.js";
import { ForbiddenError } from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import { can } from "../../../../common/auth/can.js";

function assertCanModerate(clinicIdParam) {
  const currentClinicId = getCurrentClinicId();
  if (String(currentClinicId) !== String(clinicIdParam)) {
    throw new ForbiddenError("Cannot moderate another clinic's reviews");
  }
  if (!can("review", "write")) {
    throw new ForbiddenError("review.write permission required");
  }
}

export async function listReviews(req, res, next) {
  try {
    const { id } = req.params;
    assertCanModerate(id);
    const { status, limit, skip } = req.query;
    const result = await reviewService.listClinicReviews({
      clinicId: id,
      status: status || null,
      limit: limit ? parseInt(limit, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function moderateReview(req, res, next) {
  try {
    const { id, reviewId } = req.params;
    assertCanModerate(id);
    const { action, note } = req.body || {};
    const result = await reviewService.moderateReview({
      clinicId: id,
      reviewId,
      action,
      moderatorUserId: getCurrentUserId(),
      note,
    });
    res.json({ review: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/clinic/clinics/:id/public-feedback
 *
 * Отзывы врачам и комментарии, которые видны на публичных страницах клиники.
 * Только чтение: сущности принадлежат врачу и общему обсуждению, а не клинике
 * (подробности — в publicFeedback.service.js). Поэтому и право требуется на
 * чтение, а не на запись, в отличие от модерации отзывов о клинике.
 */
export async function listPublicFeedback(req, res, next) {
  try {
    const { id } = req.params;

    if (String(getCurrentClinicId()) !== String(id)) {
      throw new ForbiddenError("Cannot read another clinic's feedback");
    }
    if (!can("review", "read")) {
      throw new ForbiddenError("review.read permission required");
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const result = await getClinicPublicFeedback({
      clinicId: id,
      limit: Number.isFinite(limit) ? Math.min(limit, 200) : 100,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export default { listReviews, moderateReview, listPublicFeedback };
