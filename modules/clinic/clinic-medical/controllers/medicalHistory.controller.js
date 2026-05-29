// modules/clinic/clinic-medical/controllers/medicalHistory.controller.js
//
// HTTP controllers for clinic-medical encounter endpoints.
// Sprint 2 Phase 2B.
//
// Thin wrappers: parse → validate → call service → respond.
// Errors are caught by global error handler (AppError instances are
// translated to HTTP via toErrorResponse).

import * as svc from "../services/medicalHistory.service.js";
import {
  createEncounterSchema,
  updateEncounterSchema,
  signEncounterSchema,
  amendEncounterSchema,
  listEncountersQuerySchema,
} from "../validators/medicalHistory.schemas.js";
import {
  UnprocessableError,
  toErrorResponse,
} from "../../../../common/utils/errors.js";

/**
 * Helper: validate body with Zod schema. Returns parsed data or
 * throws UnprocessableError with field details.
 */
function parse(schema, source, label = "request body") {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.flatten();
    throw new UnprocessableError(`Invalid ${label}`, details);
  }
  return result.data;
}

/**
 * Helper: handle errors → status + JSON.
 * Uses toErrorResponse from common/utils/errors.js (handles AppError,
 * mongoose ValidationError, CastError, duplicate-key, and unknown errors).
 */
function handleError(res, err) {
  const { status, body } = toErrorResponse(err);
  return res.status(status).json(body);
}

// ─── POST /encounters ─────────────────────────────────────────────────
// Patient is in URL (e.g. /patients/:patientId/encounters) and was
// resolved by resolveClinicPatient → req.clinicPatient.

export async function createEncounter(req, res) {
  try {
    const body = parse(
      createEncounterSchema,
      req.body,
      "encounter create body",
    );
    const result = await svc.createEncounter({
      patient: req.clinicPatient,
      body,
    });
    return res.status(201).json({ success: true, encounter: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── GET /encounters/:encounterId ─────────────────────────────────────
// resolveEncounter → req.medicalRecord
// checkConsent       → req.consentDecision

export async function getEncounter(req, res) {
  try {
    const result = await svc.getEncounter({
      record: req.medicalRecord,
      consentDecision: req.consentDecision || null,
      role: req.tenantContext?.role || null,
    });
    return res.json({ success: true, encounter: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── GET /patients/:patientId/encounters ──────────────────────────────
// List endpoint scoped to patient.

export async function listEncounters(req, res) {
  try {
    const query = parse(listEncountersQuerySchema, req.query, "list query");
    const result = await svc.listEncountersForPatient({
      patient: req.clinicPatient,
      query,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── PATCH /encounters/:encounterId ───────────────────────────────────

export async function updateEncounter(req, res) {
  try {
    const body = parse(updateEncounterSchema, req.body, "update body");
    const result = await svc.updateEncounter({
      record: req.medicalRecord,
      body,
    });
    return res.json({ success: true, encounter: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── PATCH /encounters/:encounterId/sign ──────────────────────────────

export async function signEncounter(req, res) {
  try {
    const body = parse(signEncounterSchema, req.body || {}, "sign body");
    const result = await svc.signEncounter({
      record: req.medicalRecord,
      body,
    });
    return res.json({ success: true, encounter: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── PATCH /encounters/:encounterId/amend ─────────────────────────────

export async function amendEncounter(req, res) {
  try {
    const body = parse(amendEncounterSchema, req.body, "amend body");
    const result = await svc.amendEncounter({
      record: req.medicalRecord,
      body,
    });
    return res.json({ success: true, encounter: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── DELETE /encounters/:encounterId ──────────────────────────────────

export async function deleteEncounter(req, res) {
  try {
    const result = await svc.deleteEncounter({
      record: req.medicalRecord,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}
