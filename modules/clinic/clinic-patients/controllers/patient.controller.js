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

import * as service from "../services/patient.service.js";
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

// ─── POST /patients ───────────────────────────────────────────────────

export async function createPatient(req, res, next) {
  try {
    const input = parse(createPatientSchema, req.body, "patient data");
    const patient = await service.createPatient(input);
    res.status(201).json({ patient });
  } catch (err) {
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
