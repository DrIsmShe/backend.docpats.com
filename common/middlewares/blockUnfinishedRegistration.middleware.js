// server/common/middlewares/blockUnfinishedRegistration.middleware.js
//
// Forces provisional users to complete their registration before they
// can access ANYTHING else on DocPats.
//
// How it works:
//   - Reads req.session.userId
//   - If no session → pass through (auth middleware downstream will
//     decide what to do; we only act on AUTHENTICATED provisional users)
//   - Loads the user (cached in req.session._mustCompleteCheck to avoid
//     hitting User collection on every request — invalidated by the
//     completion endpoint via req.session._mustCompleteCheck = false)
//   - If user.mustCompleteRegistration === true → 403 with code
//     "provisional_must_complete" unless the request is to one of the
//     ALLOWLISTED paths (the completion endpoint itself, logout, /me,
//     and the i18n bundle so the form can render).
//
// PLACEMENT in middleware chain:
//   1. cookieParser
//   2. sessionMiddleware
//   3. THIS middleware ←
//   4. ... everything else
//
// The check is a single Mongo lookup PER session (cached). Negligible
// overhead for non-provisional users.

import User from "../models/Auth/users.js";
import logger from "../logger.js";

const log = logger.child({ module: "middleware/block-unfinished" });

// Paths that a provisional user IS allowed to hit. Anything else → 403.
// Match by `req.path` prefix — order doesn't matter, allowlist is OR'd.
// Paths that a provisional user IS allowed to hit. Anything else → 403.
// Match by `req.path` prefix — order doesn't matter, allowlist is OR'd.
//
// IMPORTANT: DocPats mounts auth on /auth (without /api prefix) — see
// common/routes/index.js. The completion endpoint URL is therefore
// /auth/complete-provisional-registration. We list /api/auth/* variants
// too in case of future reverse-proxy rewrites or staging environments.
const ALLOWLISTED_PREFIXES = [
  // ─── Provisional activation endpoints (2-step OTP flow) ───
  // All sub-paths under /auth/complete-provisional-registration must
  // pass through unblocked — they're the ONLY way out of provisional state.
  "/auth/complete-provisional-registration",
  "/api/auth/complete-provisional-registration",

  // ─── Other auth endpoints the provisional user might need ───
  "/auth/logout",
  "/auth/reset-password",
  "/auth/otp-for-reset-password",
  "/auth/change-password",
  "/auth/Must-Change-Password-true",
  "/auth/confirmation",

  // ─── Read their own minimal profile to render the UI ───
  "/common-for-user",

  // ─── Static assets / i18n bundles ───
  "/uploads",
  "/i18n",
  "/locales",

  // ─── Healthcheck ───
  "/healthz",
];
function isAllowlisted(reqPath) {
  return ALLOWLISTED_PREFIXES.some((p) => reqPath.startsWith(p));
}

/**
 * Express middleware.
 * Adds a "force complete provisional registration" gate AFTER session
 * load and BEFORE business routes.
 */
export async function blockUnfinishedRegistration(req, res, next) {
  // No session → not authenticated → not our problem
  const userId = req.session?.userId;
  if (!userId) return next();

  // Already cleared in this session — skip the DB lookup
  if (req.session._mustCompleteCheck === false) {
    return next();
  }

  // First request after login: check the user document
  if (req.session._mustCompleteCheck === undefined) {
    try {
      const user = await User.findById(userId)
        .select("mustCompleteRegistration isProvisional isAnonymized")
        .lean();

      if (!user) {
        // Stale session — let downstream handle (probably 401 from auth)
        req.session._mustCompleteCheck = false;
        return next();
      }

      if (user.isAnonymized) {
        // Wipe session and reject
        log.warn(
          { userId: String(userId) },
          "Anonymized user attempted access — destroying session",
        );
        return req.session.destroy(() => {
          res.status(401).json({
            error: "Account is no longer valid",
            code: "account_anonymized",
          });
        });
      }

      // Cache the result for the rest of this session's lifetime
      req.session._mustCompleteCheck = Boolean(user.mustCompleteRegistration);
    } catch (err) {
      log.error(
        { err: err.message, userId: String(userId) },
        "blockUnfinishedRegistration DB lookup failed — failing open",
      );
      // Failing open — better availability than security here, because
      // false positives lock real users out. The activation endpoint
      // itself re-checks the flag in the service layer.
      req.session._mustCompleteCheck = false;
      return next();
    }
  }

  // At this point: req.session._mustCompleteCheck is boolean
  if (req.session._mustCompleteCheck === true) {
    if (isAllowlisted(req.path)) {
      return next();
    }
    return res.status(403).json({
      error:
        "Provisional account — please change your email and password to continue",
      code: "provisional_must_complete",
      // Where the frontend should redirect:
      redirectTo: "/complete-registration",
    });
  }

  next();
}

export default blockUnfinishedRegistration;
