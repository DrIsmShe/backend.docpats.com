// server/modules/clinic/clinic-patients/controllers/patient.controller.js
//
// HTTP layer for ClinicPatient module.
//
// Responsibilities:
//   1. Parse + validate input with zod schemas
//   2. Call into patient.service
//   3. Map service errors → next(err)
//
// Permission checks happen inside the service via require() — controller
// doesn't duplicate them. zod errors are thrown as ValidationError.
//
// AUDIT — special case for createPatient:
//   All other patient endpoints use auditMiddleware (see patient.routes.js).
//   createPatient is the exception: the new patient._id is only known
//   AFTER service.createPatient resolves, so we cannot use middleware's
//   resourceIdFrom (it would fire with resourceId=null and trigger the
//   strict invariant in audit.service.js).
//
//   Pattern mirrors WebSocket events in socket.gateway.js — direct call
//   to auditService.recordActionAsync after the operation, with actor +
//   context extracted from req using the same logic as auditMiddleware.
//   On failure (caught error) we record outcome="failure" so denied/
//   broken create attempts are visible in audit log.

import * as service from "../services/patient.service.js";
import auditService from "../../../audit/services/audit.service.js";
import {
  createPatientSchema,
  updatePatientSchema,
  searchPatientsSchema,
  listPatientsSchema,
  linkPatientSchema,
  patientIdParamSchema,
  searchUsersSchema,
} from "../validators/patient.schemas.js";
import { ValidationError } from "../../../../common/utils/errors.js";

/**
 * Internal: parse + throw a clean ValidationError on bad input.
 */
function parse(schema, source, label) {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new ValidationError(`Invalid ${label}`, {
      issues: result.error.issues,
    });
  }
  return result.data;
}

/* ═══════════ AUDIT HELPERS ═══════════
   Mirror the extraction logic from auditMiddleware.js. Kept inline
   (not imported) because auditMiddleware doesn't export these helpers —
   they're internal there. Duplication is intentional and small.
   If middleware's extractors evolve, update here too.
*/

/**
 * Same logic as extractActorFromReq in auditMiddleware.js.
 * Supports req.user (authMiddleware-populated) AND clinic session-only
 * auth (req.session.userId / req.session.employeeId).
 */
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

  if (req.session?.employeeId) {
    return {
      userId: String(req.session.employeeId),
      email: req.session.employeeEmail || null,
      role: req.session.employeeRole || null,
    };
  }

  return null;
}

/**
 * Same logic as extractContextFromReq in auditMiddleware.js.
 * statusCode is passed explicitly because we call this BEFORE res.send,
 * unlike middleware which reads it in res.on("finish").
 */
function extractContext(req, statusCode) {
  if (req.context) {
    return {
      ...req.context,
      httpMethod: req.method,
      httpPath: req.originalUrl || req.url,
      statusCode,
    };
  }

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

// ─── POST /patients ───────────────────────────────────────────────────
//
// Audit is recorded HERE, not via middleware — see file header comment.
// We capture the real patient._id as resourceId, satisfying the strict
// invariant in audit.service.js for create actions.
//
// Both success and failure paths write audit:
//   success → outcome="success", resourceId=newPatient._id
//   failure → outcome="failure", failureReason=err.message, resourceId=null
//             (validation/permission failures happen before the patient
//             exists, so there's no resourceId to capture — this is OK
//             for failure cases because the audit invariant only requires
//             resourceId on success-path create actions per HIPAA forensics
//             needs. We still record the failed attempt for security
//             monitoring under recordActionAsync which swallows the
//             invariant warning.)
//
// PHI safety — metadata mirrors the original middleware's metaFrom:
//   only structural flags (hasPhone/hasEmail/etc) and gender (low
//   sensitivity). NEVER decrypted values, names, phones, emails, DoB.

export async function createPatient(req, res, next) {
  const actor = extractActor(req);
  const baseMetadata = {
    hasPhone: Boolean(req.body?.phone),
    hasEmail: Boolean(req.body?.email),
    hasDateOfBirth: Boolean(req.body?.dateOfBirth),
    hasNotes: Boolean(req.body?.notes),
    gender: req.body?.gender || null,
  };

  try {
    const input = parse(createPatientSchema, req.body, "patient data");
    const patient = await service.createPatient(input);

    // Audit AFTER successful creation — resourceId is real now.
    if (actor) {
      auditService.recordActionAsync({
        actor,
        action: "clinic.patient.create",
        resourceType: "clinic-patient",
        resourceId: String(patient._id),
        outcome: "success",
        metadata: baseMetadata,
        context: extractContext(req, 201),
      });
    }

    res.status(201).json({ patient });
  } catch (err) {
    // Record the failed attempt. resourceId is null here because the
    // patient was never created. recordActionAsync swallows the
    // resourceId-required warning for failures via outcome="failure"
    // metadata, which is acceptable for security-monitoring purposes
    // (we just need to see that user X tried to create a patient and
    // failed). The strict invariant in audit.service.js still throws
    // synchronously, so we wrap in try/catch defensively.
    if (actor) {
      try {
        auditService.recordActionAsync({
          actor,
          action: "clinic.patient.create",
          resourceType: "clinic-patient",
          resourceId: null,
          outcome: "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          metadata: baseMetadata,
          context: extractContext(req, err?.statusCode || 500),
        });
      } catch (auditErr) {
        console.warn("[audit] create-failure record failed:", auditErr.message);
      }
    }
    next(err);
  }
}

// ─── GET /patients ────────────────────────────────────────────────────

export async function listPatients(req, res, next) {
  try {
    const query = parse(listPatientsSchema, req.query, "list query");
    const result = await service.listPatients(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /patients/search ─────────────────────────────────────────────

export async function searchPatients(req, res, next) {
  try {
    const query = parse(searchPatientsSchema, req.query, "search query");
    const result = await service.searchPatients(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /patients/:id ────────────────────────────────────────────────

export async function getPatient(req, res, next) {
  try {
    const { id } = parse(patientIdParamSchema, req.params, "patient id");
    const patient = await service.getPatientById(id);
    res.json({ patient });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /patients/:id ──────────────────────────────────────────────

export async function updatePatient(req, res, next) {
  try {
    const { id } = parse(patientIdParamSchema, req.params, "patient id");
    const input = parse(updatePatientSchema, req.body, "update data");
    const patient = await service.updatePatient(id, input);
    res.json({ patient });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /patients/:id ─────────────────────────────────────────────

export async function deletePatient(req, res, next) {
  try {
    const { id } = parse(patientIdParamSchema, req.params, "patient id");
    const result = await service.deletePatient(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── POST /patients/:id/link ──────────────────────────────────────────

export async function linkPatient(req, res, next) {
  try {
    const { id } = parse(patientIdParamSchema, req.params, "patient id");
    const { userId } = parse(linkPatientSchema, req.body, "link data");
    const patient = await service.linkToUser(id, userId);
    res.json({ patient });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /patients/:id/link ────────────────────────────────────────

export async function unlinkPatient(req, res, next) {
  try {
    const { id } = parse(patientIdParamSchema, req.params, "patient id");
    const patient = await service.unlinkFromUser(id);
    res.json({ patient });
  } catch (err) {
    next(err);
  }
}

// ─── GET /patients/users/search ───────────────────────────────────────
//
// Search DocPats User accounts to link a patient to. Two modes:
//   ?mode=email&email=...
//   ?mode=dob&dateOfBirth=YYYY-MM-DD&firstName=...&lastName=...

export async function searchUsers(req, res, next) {
  try {
    const query = parse(searchUsersSchema, req.query, "user search query");
    const result = await service.searchUsersForLink(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
