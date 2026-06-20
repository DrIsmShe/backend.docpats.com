import reviewService from "../../clinic-reviews/services/review.service.js";
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

export default { listReviews, moderateReview };
