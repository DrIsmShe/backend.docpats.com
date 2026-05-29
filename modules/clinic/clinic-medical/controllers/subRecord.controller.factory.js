// modules/clinic/clinic-medical/controllers/subRecord.controller.factory.js
//
// Controller factory for clinic-medical sub-records.
// Sprint 2 Phase 2C.
//
// Given a service (from buildSubRecordService) + create/update Zod schemas,
// produces thin HTTP controllers: create / get / list / update / remove.
//
// All five sub-models reuse this factory — only service + schemas differ.

import {
  UnprocessableError,
  toErrorResponse,
} from "../../../../common/utils/errors.js";
import { listSubRecordsQuerySchema } from "../validators/subRecords.schemas.js";

function parse(schema, source, label) {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new UnprocessableError(`Invalid ${label}`, result.error.flatten());
  }
  return result.data;
}

function handleError(res, err) {
  const { status, body } = toErrorResponse(err);
  return res.status(status).json(body);
}

/**
 * @param {object} opts
 * @param {object} opts.service        — built sub-record service
 * @param {ZodSchema} opts.createSchema
 * @param {ZodSchema} opts.updateSchema
 * @param {string} opts.label          — for error messages ("allergy" etc)
 * @returns {object} { create, get, list, update, remove } express handlers
 */
export function buildSubRecordController({
  service,
  createSchema,
  updateSchema,
  label,
}) {
  return {
    // POST /patients/:patientId/<resource>
    async create(req, res) {
      try {
        const body = parse(createSchema, req.body, `${label} create body`);
        const result = await service.create({
          patient: req.clinicPatient,
          body,
        });
        return res.status(201).json({ success: true, record: result });
      } catch (err) {
        return handleError(res, err);
      }
    },

    // GET /<resource>/:recordId
    async get(req, res) {
      try {
        const recordId = req.params.recordId || req.params.id;
        const result = await service.get({ recordId });
        return res.json({ success: true, record: result });
      } catch (err) {
        return handleError(res, err);
      }
    },

    // GET /patients/:patientId/<resource>
    async list(req, res) {
      try {
        const query = parse(
          listSubRecordsQuerySchema,
          req.query,
          `${label} list query`,
        );
        const result = await service.list({
          patient: req.clinicPatient,
          query,
        });
        return res.json({ success: true, ...result });
      } catch (err) {
        return handleError(res, err);
      }
    },

    // PATCH /<resource>/:recordId
    async update(req, res) {
      try {
        const recordId = req.params.recordId || req.params.id;
        const body = parse(updateSchema, req.body, `${label} update body`);
        const result = await service.update({ recordId, body });
        return res.json({ success: true, record: result });
      } catch (err) {
        return handleError(res, err);
      }
    },

    // DELETE /<resource>/:recordId
    async remove(req, res) {
      try {
        const recordId = req.params.recordId || req.params.id;
        const result = await service.remove({ recordId });
        return res.json({ success: true, ...result });
      } catch (err) {
        return handleError(res, err);
      }
    },
  };
}

export default buildSubRecordController;
