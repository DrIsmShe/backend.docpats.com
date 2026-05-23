// server/jobs/cleanupExpiredProvisional.js
//
// Weekly cleanup of expired provisional User accounts.
//
// Provisional accounts have a 3-year TTL (set in provisional.service.js).
// Once `provisionalExpiresAt < now` AND the user hasn't activated, this
// job anonymizes the User document via wipeProvisionalUser():
//   - PII fields overwritten with REDACTED placeholders
//   - email/name hashes rotated (search no longer matches)
//   - password rotated to random unrecoverable value
//   - isAnonymized: true, anonymizedReason: "expired"
//   - _id preserved (ClinicPatient.linkedUserId FKs stay valid)
//
// Schedule: every Sunday at 03:30 server time.
//   - Sundays = low traffic in clinic context
//   - 03:30 = 30 min after the existing notifications cleanup at 03:00,
//     so they don't overlap or contend for DB connections.
//
// Concurrency guard: `isRunning` flag prevents overlap if a previous
// run somehow stretched past a week.
//
// Audit: each wipe writes a `user.provisional.expired` action with
// outcome="success" or outcome="failure". The audit actor is the
// SYSTEM (no human triggered this) — recorded with userId="system",
// role="system" so HIPAA forensics can distinguish automated wipes
// from clinic-triggered ones.

import User from "../common/models/Auth/users.js";
import { wipeProvisionalUser } from "../modules/clinic/clinic-patients/services/provisional.service.js";
import auditService from "../modules/audit/services/audit.service.js";
import logger from "../common/logger.js";

const log = logger.child({ module: "jobs/cleanup-expired-provisional" });

// Process at most this many wipes per run. If the queue grows beyond
// this (which would mean ~1000 expirations in one week — never going to
// happen at our scale), the rest waits until next Sunday. Prevents
// runaway DB load if something goes wrong upstream.
const BATCH_SIZE = 1000;

// System-actor identity for audit. Matches what we'd want HIPAA
// auditors to see: "the system itself did this, no clinic/user
// triggered it manually".
const SYSTEM_ACTOR = {
  userId: "system",
  email: null,
  role: "system",
};

// Concurrency guard at module scope — survives between cron ticks.
let isRunning = false;

/**
 * One run of the cleanup. Idempotent: re-running mid-execution finds
 * fewer candidates each time. Returns a summary for logging.
 */
export async function cleanupExpiredProvisional() {
  if (isRunning) {
    log.warn("Previous cleanup still in progress, skipping this tick");
    return { skipped: true };
  }
  isRunning = true;

  const startedAt = new Date();
  const stats = {
    found: 0,
    wiped: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Find candidates: provisional + expired + not yet anonymized.
    // Using lean() because we only need _id — the actual wipe call
    // fetches the full document itself.
    const expired = await User.find({
      isProvisional: true,
      isAnonymized: { $ne: true },
      provisionalExpiresAt: { $lt: startedAt },
    })
      .select("_id provisionalCreatedBy")
      .limit(BATCH_SIZE)
      .lean();

    stats.found = expired.length;

    if (expired.length === 0) {
      log.info("No expired provisional users found, nothing to do");
      return stats;
    }

    log.info(
      { count: expired.length },
      "Found expired provisional users — starting wipe",
    );

    // Process sequentially. Could parallelize with Promise.allSettled,
    // but: (1) volume is low (max ~hundreds/week at scale),
    //      (2) sequential is gentler on the DB,
    //      (3) easier to reason about audit ordering.
    for (const candidate of expired) {
      const userId = String(candidate._id);
      const clinicId = candidate.provisionalCreatedBy
        ? String(candidate.provisionalCreatedBy)
        : null;

      try {
        await wipeProvisionalUser(userId, "expired");
        stats.wiped += 1;

        // Audit success
        auditService.recordActionAsync({
          actor: SYSTEM_ACTOR,
          action: "user.provisional.expired",
          resourceType: "user-account",
          resourceId: userId,
          outcome: "success",
          metadata: {
            provisionalCreatedBy: clinicId,
            cronRunStartedAt: startedAt.toISOString(),
          },
          context: {
            ipAddress: null,
            userAgent: "cron/cleanupExpiredProvisional",
            sessionId: null,
            requestId: null,
            httpMethod: null,
            httpPath: null,
            statusCode: null,
          },
        });
      } catch (err) {
        stats.failed += 1;
        stats.errors.push({ userId, error: err.message });
        log.error(
          { userId, err: err.message },
          "Failed to wipe expired provisional user",
        );

        // Audit failure — security signal that something is wrong
        try {
          auditService.recordActionAsync({
            actor: SYSTEM_ACTOR,
            action: "user.provisional.expired",
            resourceType: "user-account",
            resourceId: userId,
            outcome: "failure",
            failureReason: err?.message?.slice(0, 500) || "unknown",
            metadata: {
              provisionalCreatedBy: clinicId,
              cronRunStartedAt: startedAt.toISOString(),
            },
            context: {
              ipAddress: null,
              userAgent: "cron/cleanupExpiredProvisional",
              sessionId: null,
              requestId: null,
              httpMethod: null,
              httpPath: null,
              statusCode: null,
            },
          });
        } catch (auditErr) {
          // Audit failure on top of wipe failure — log and move on.
          log.error(
            { userId, err: auditErr.message },
            "Failed to record audit for failed wipe",
          );
        }
      }
    }

    const durationMs = Date.now() - startedAt.getTime();
    log.info(
      {
        found: stats.found,
        wiped: stats.wiped,
        failed: stats.failed,
        durationMs,
      },
      "Provisional cleanup complete",
    );

    return stats;
  } finally {
    isRunning = false;
  }
}

export default cleanupExpiredProvisional;
