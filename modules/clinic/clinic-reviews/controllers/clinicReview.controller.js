import reviewService from "../../clinic/clinic-reviews/services/review.service.js";

function requirePatient(req, res) {
  if (!req.session?.userId) {
    res
      .status(401)
      .json({ authenticated: false, message: "Not authenticated" });
    return null;
  }
  if (req.session.role !== "patient") {
    res.status(403).json({ message: "Patient role required" });
    return null;
  }
  return req.session.userId;
}

export async function submitMyReview(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;
  const { clinicId, rating, text } = req.body || {};
  try {
    const review = await reviewService.upsertMyReview({
      userId,
      clinicId,
      rating,
      text,
    });
    res.status(200).json({ review });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) console.error("[clinicReview.submitMyReview]", err);
    res.status(code).json({ error: err.message || "Failed to submit review" });
  }
}

export async function getMyReview(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;
  const { clinicId } = req.params;
  try {
    const review = await reviewService.getMyReview({ userId, clinicId });
    res.status(200).json({ review });
  } catch (err) {
    console.error("[clinicReview.getMyReview]", err);
    res.status(500).json({ error: "Failed to load review" });
  }
}

export default { submitMyReview, getMyReview };
