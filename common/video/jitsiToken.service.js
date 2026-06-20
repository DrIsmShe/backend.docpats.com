// server/common/video/jitsiToken.service.js
//
// Mints short-lived JWTs that authorize a user to join ONE specific Jitsi
// room. This is the ONLY place in the project that produces a JWT — and it
// is NOT app authentication. The app stays session-based (express-session,
// req.session.userId). This JWT is purely a "door pass" that the self-hosted
// Jitsi server (prosody with AUTH_TYPE=jwt) checks before letting someone
// into a video room.
//
// Flow:
//   1. User is already logged in to DocPats via SESSION (unchanged).
//   2. The video-token endpoint verifies, BY SESSION, that this user is
//      allowed in the requested room (dialog participant / telemed session /
//      consilium member).
//   3. Only then does it call mintRoomToken() to issue this Jitsi pass.
//   4. The frontend hands the token to the Jitsi iframe, which joins the room.
//
// The secret here (JITSI_APP_SECRET) must equal JWT_APP_SECRET configured in
// the Jitsi server's .env. JITSI_APP_ID must equal Jitsi's JWT_APP_ID.
//
// Config (server .env):
//   JITSI_DOMAIN      e.g. "localhost:8443" (local) or "meet.docpats.com" (prod)
//   JITSI_APP_ID      must match Jitsi JWT_APP_ID   (we use "docpats")
//   JITSI_APP_SECRET  must match Jitsi JWT_APP_SECRET
//
// If JITSI_APP_SECRET is not set, mintRoomToken throws a clear error rather
// than producing an invalid token — a safe default so misconfiguration fails
// loudly instead of silently letting people into rooms.

import jwt from "jsonwebtoken";

// Token lifetime. Short on purpose — a pass to enter a call, not a session.
// 2 hours covers a long consultation while limiting replay if a token leaks.
const TOKEN_TTL_SECONDS = 2 * 60 * 60;

// Jitsi expects this audience/issuer convention. `aud` is "jitsi" by default
// in the docker-jitsi-meet JWT setup; `iss` is the app id.
const JITSI_AUDIENCE = "jitsi";

function getConfig() {
  const domain = process.env.JITSI_DOMAIN || "localhost:8443";
  const appId = process.env.JITSI_APP_ID || "docpats";
  const secret = process.env.JITSI_APP_SECRET;
  return { domain, appId, secret };
}

/**
 * Is Jitsi video configured on this server? Callers (the endpoint) can use
 * this to decide whether to offer the feature or return a clean "not
 * configured" response instead of a 500.
 */
export function isJitsiConfigured() {
  return Boolean(process.env.JITSI_APP_SECRET);
}

/**
 * Mint a Jitsi room-access JWT.
 *
 * @param {object} p
 * @param {string} p.room        Room name the token grants access to. Should
 *                               be a stable id from our domain, e.g.
 *                               "dialog-<id>", "telemed-<joinKey>",
 *                               "consilium-<id>". REQUIRED.
 * @param {string} p.userId      DocPats user id (goes into context.user.id).
 * @param {string} [p.displayName] Shown in the Jitsi UI.
 * @param {string} [p.email]     Optional, shown in Jitsi UI.
 * @param {boolean} [p.moderator=false] Whether this participant is a moderator
 *                               (doctors host; patients/guests do not).
 * @returns {{ token: string, domain: string, room: string, exp: number }}
 *
 * Throws Error("Jitsi is not configured") if JITSI_APP_SECRET is missing.
 * Throws Error("room is required") if room is empty.
 */
export function mintRoomToken({
  room,
  userId,
  displayName = null,
  email = null,
  moderator = false,
} = {}) {
  if (!room || typeof room !== "string") {
    throw new Error("room is required");
  }

  const { domain, appId, secret } = getConfig();
  if (!secret) {
    // Safe default: never emit an unsigned/invalid pass.
    throw new Error("Jitsi is not configured (JITSI_APP_SECRET missing)");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + TOKEN_TTL_SECONDS;

  // `sub` is the Jitsi tenant/domain. For the default docker-jitsi-meet JWT
  // setup, "*" (any subdomain) or the bare host both work; we use the bare
  // host derived from the domain (strip any :port).
  const sub = domain.split(":")[0];

  const payload = {
    iss: appId,
    aud: JITSI_AUDIENCE,
    sub,
    room, // exact room this pass is valid for
    iat: nowSec,
    exp,
    context: {
      user: {
        id: userId ? String(userId) : undefined,
        name: displayName || undefined,
        email: email || undefined,
        moderator: moderator ? "true" : "false",
      },
    },
  };

  const token = jwt.sign(payload, secret, { algorithm: "HS256" });

  return { token, domain, room, exp };
}

export default { mintRoomToken, isJitsiConfigured };
