// server/modules/auth/controllers/completeProvisional.controller.js
//
// HTTP entry points for the 3 endpoints of provisional activation:
//   POST /auth/complete-provisional-registration/request  → request OTP
//   POST /auth/complete-provisional-registration/confirm  → submit OTP
//   POST /auth/complete-provisional-registration/resend   → resend OTP
//
// All endpoints require an authenticated session (req.session.userId).
// State persists on the User document (activationOtp / pendingNewEmail*
// / pendingNewPasswordHash) — see provisionalOtp.service.js for the
// storage model.
//
// AUDIT — direct recordActionAsync (not middleware) because we already
// have the resourceId (userId) from the session up front, and we want
// to record domain-specific actions:
//   - user.provisional.activation_requested  (request OK)
//   - user.provisional.activated             (confirm OK)
//   - user.provisional.activation_otp_failed (confirm with bad/expired OTP)
//   - user.provisional.activation_resent     (resend OK)

import {
  requestActivationOtp,
  confirmActivationOtp,
  resendActivationOtp,
} from "../services/provisionalOtp.service.js";
import { completeProvisionalSchema } from "../validators/completeProvisional.schema.js";
import auditService from "../../audit/services/audit.service.js";
import {
  ValidationError,
  UnauthorizedError,
} from "../../../common/utils/errors.js";

// ─── Audit helpers (same pattern as patient.controller.js) ───────────

function extractActor(req) {
  if (req.actor?.userId) return req.actor;
  if (req.user) {
    const userId =
      req.user._id?.toString?.() ||
      req.user.userId?.toString?.() ||
      req.userId?.toString?.();
    if (userId) {
      return {
        userId,
        email: req.user.email || req.session?.email || null,
        role: req.user.role || req.session?.role || null,
      };
    }
  }
  if (req.session?.userId) {
    return {
      userId: String(req.session.userId),
      email:
        req.session.email || req.session.userEmail || req.user?.email || null,
      role: req.session.role || req.session.userRole || null,
    };
  }
  return null;
}

function extractContext(req, statusCode) {
  return {
    ipAddress:
      req.ip ||
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.connection?.remoteAddress ||
      null,
    userAgent: req.headers?.["user-agent"] || null,
    sessionId: req.sessionID || null,
    requestId: req.id || null,
    httpMethod: req.method,
    httpPath: req.originalUrl || req.url,
    statusCode,
  };
}

/**
 * Map a service-layer error code to an HTTP status.
 * Keeps the contract we already documented for the frontend.
 */
function mapErrorToHttpStatus(err) {
  const code = err?.code || err?.details?.code;
  if (code === "otp_expired") return 410;
  if (code === "too_many_attempts" || code === "resend_cooldown") return 429;
  if (code === "no_pending") return 409;
  if (code === "otp_invalid") return 400;
  return err?.statusCode || 500;
}

// ─── Controllers ─────────────────────────────────────────────────────

/**
 * POST /auth/complete-provisional-registration/request
 * Body: { newEmail, newPassword }
 */
export async function requestController(req, res, next) {
  const actor = extractActor(req);
  const userId = req.session?.userId;

  if (!userId) {
    return next(new UnauthorizedError("Not authenticated"));
  }

  try {
    const parsed = completeProvisionalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", {
        issues: parsed.error.issues,
      });
    }

    const result = await requestActivationOtp({
      userId,
      newEmail: parsed.data.newEmail,
      newPassword: parsed.data.newPassword,
    });

    if (actor) {
      auditService.recordActionAsync({
        actor,
        action: "user.provisional.activation_requested",
        resourceType: "user-account",
        resourceId: String(userId),
        outcome: "success",
        metadata: { emailChanged: true },
        context: extractContext(req, 200),
      });
    }

    res.status(200).json(result);
  } catch (err) {
    if (actor) {
      try {
        auditService.recordActionAsync({
          actor,
          action: "user.provisional.activation_requested",
          resourceType: "user-account",
          resourceId: String(userId),
          outcome: err?.statusCode === 403 ? "denied" : "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          metadata: { emailChanged: false },
          context: extractContext(req, mapErrorToHttpStatus(err)),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] complete-provisional request failure record failed:",
          auditErr.message,
        );
      }
    }
    if (err?.statusCode == null) err.statusCode = mapErrorToHttpStatus(err);
    next(err);
  }
}

/**
 * POST /auth/complete-provisional-registration/confirm
 * Body: { otp }
 *
 * On successful activation we MUST invalidate the session-level cache
 * used by blockUnfinishedRegistration.middleware. That middleware
 * remembers `mustCompleteRegistration` in req.session._mustCompleteCheck
 * to avoid hitting the User collection on every request. If we don't
 * flip it here, the next request from this same session will still see
 * the stale cached `true` and bounce the user back to /complete-
 * registration with HTTP 403 — even though the database has already
 * cleared the flag. (See blockUnfinishedRegistration comment block:
 * "invalidated by the completion endpoint via
 *  req.session._mustCompleteCheck = false".)
 *
 * 22 May 2026 fix — without this, activation appears to work but the
 * very next page load loops back to the activation screen.
 */
export async function confirmController(req, res, next) {
  const actor = extractActor(req);
  const userId = req.session?.userId;

  if (!userId) {
    return next(new UnauthorizedError("Not authenticated"));
  }

  try {
    const otp = req.body?.otp;
    if (typeof otp !== "string") {
      throw new ValidationError("OTP is required", { field: "otp" });
    }

    const result = await confirmActivationOtp({ userId, otp });

    // ─── Invalidate the blockUnfinishedRegistration session cache ───
    // The user just cleared mustCompleteRegistration in the database.
    // Flip the cached flag so subsequent requests on this session
    // don't get blocked. Wrapped in a try/catch so a session write
    // failure (very rare with express-session + MongoStore) can't
    // mask the successful activation from the user.
    try {
      if (req.session) {
        req.session._mustCompleteCheck = false;
        // express-session writes on response end automatically, but
        // we also call save() to flush eagerly — the next request
        // might race the response and read a stale cookie otherwise.
        if (typeof req.session.save === "function") {
          await new Promise((resolve) => {
            req.session.save((err) => {
              if (err) {
                console.warn(
                  "[complete-provisional] session.save after activation failed:",
                  err.message,
                );
              }
              resolve();
            });
          });
        }
      }
    } catch (sessionErr) {
      console.warn(
        "[complete-provisional] failed to invalidate session cache:",
        sessionErr.message,
      );
      // Continue — activation already succeeded in the DB. Worst case
      // the user gets bounced once more and a fresh session lookup
      // will pick up the new false from the DB.
    }

    if (actor) {
      auditService.recordActionAsync({
        actor,
        action: "user.provisional.activated",
        resourceType: "user-account",
        resourceId: String(userId),
        outcome: "success",
        metadata: { emailChanged: true, passwordChanged: true },
        context: extractContext(req, 200),
      });
    }

    res.status(200).json(result);
  } catch (err) {
    if (actor) {
      try {
        auditService.recordActionAsync({
          actor,
          action: "user.provisional.activation_otp_failed",
          resourceType: "user-account",
          resourceId: String(userId),
          outcome: err?.statusCode === 403 ? "denied" : "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          metadata: {
            errorCode: err?.code || err?.details?.code || null,
          },
          context: extractContext(req, mapErrorToHttpStatus(err)),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] complete-provisional confirm failure record failed:",
          auditErr.message,
        );
      }
    }
    if (err?.statusCode == null) err.statusCode = mapErrorToHttpStatus(err);
    next(err);
  }
}

/**
 * POST /auth/complete-provisional-registration/resend
 * Body: {}
 */
export async function resendController(req, res, next) {
  const actor = extractActor(req);
  const userId = req.session?.userId;

  if (!userId) {
    return next(new UnauthorizedError("Not authenticated"));
  }

  try {
    const result = await resendActivationOtp({ userId });

    if (actor) {
      auditService.recordActionAsync({
        actor,
        action: "user.provisional.activation_resent",
        resourceType: "user-account",
        resourceId: String(userId),
        outcome: "success",
        metadata: {},
        context: extractContext(req, 200),
      });
    }

    res.status(200).json(result);
  } catch (err) {
    if (actor) {
      try {
        auditService.recordActionAsync({
          actor,
          action: "user.provisional.activation_resent",
          resourceType: "user-account",
          resourceId: String(userId),
          outcome: err?.statusCode === 403 ? "denied" : "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          metadata: {
            errorCode: err?.code || err?.details?.code || null,
          },
          context: extractContext(req, mapErrorToHttpStatus(err)),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] complete-provisional resend failure record failed:",
          auditErr.message,
        );
      }
    }
    if (err?.statusCode == null) err.statusCode = mapErrorToHttpStatus(err);
    next(err);
  }
}

export default {
  requestController,
  confirmController,
  resendController,
};
