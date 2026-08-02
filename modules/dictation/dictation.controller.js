// server/modules/dictation/dictation.controller.js

import mongoose from "mongoose";
import { asyncHandler } from "../../common/middlewares/errorHandler.js";
import {
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from "../../common/utils/errors.js";
import DoctorPrivatePatient from "../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../common/models/Polyclinic/newPatientPolyclinic.js";
import * as service from "./dictation.service.js";
import * as stt from "./providers/stt.provider.js";
import * as structure from "./providers/structure.provider.js";

/**
 * Врач владеет пациентом?
 *
 * Повторяет проверку из addPatientsPolyclinicMedicalHistoryController —
 * намеренно: надиктовка создаёт запись в карте того же пациента, значит и
 * право на неё должно проверяться теми же условиями. Разойдись они, появился
 * бы обходной путь записать в чужую карту.
 */
async function assertOwnsPatient(patientType, patientId, doctorUserId) {
  if (patientType === "private") {
    const found = await DoctorPrivatePatient.findOne({
      _id: patientId,
      doctorUserId,
    }).select("_id");
    if (!found) {
      throw new ForbiddenError("Этот приватный пациент не принадлежит текущему врачу");
    }
    return "DoctorPrivatePatient";
  }
  if (patientType === "registered") {
    const found = await NewPatientPolyclinic.findOne({
      _id: patientId,
      doctorId: doctorUserId,
    }).select("_id");
    if (!found) {
      throw new ForbiddenError("Этот пациент не принадлежит текущему врачу");
    }
    return "NewPatientPolyclinic";
  }
  throw new ValidationError(`Неизвестный тип пациента: ${patientType}`);
}

function doctorIdOf(req) {
  const id = req.session?.userId;
  if (!id) throw new UnauthorizedError("Пожалуйста, войдите в систему");
  return id;
}

/** Готовность модуля: без ключей интерфейс должен честно сказать, что нельзя. */
export const statusController = asyncHandler(async (req, res) => {
  doctorIdOf(req);
  res.json({
    sttConfigured: stt.isConfigured(),
    aiConfigured: structure.isConfigured(),
    ready: stt.isConfigured() && structure.isConfigured(),
  });
});

/** Приём аудио. Пациент приходит из resolvePatient. */
export const uploadController = asyncHandler(async (req, res) => {
  const doctorId = doctorIdOf(req);

  if (!req.file) throw new ValidationError("Аудиофайл не передан (поле audio)");
  if (!/^audio\//.test(req.file.mimetype || "")) {
    throw new ValidationError("Ожидается аудиофайл (webm, ogg, mp4, wav)");
  }

  const { patient, patientType } = req;
  if (!patient || !patientType) throw new NotFoundError("Пациент");
  if (!mongoose.Types.ObjectId.isValid(patient._id)) {
    throw new ValidationError("Некорректный ID пациента");
  }

  const patientTypeModel = await assertOwnsPatient(
    patientType,
    patient._id,
    doctorId,
  );

  const job = await service.createJob({
    file: req.file,
    doctorId,
    patient: {
      patientType,
      patientRef: patient._id,
      patientTypeModel,
    },
    lang: req.body?.lang,
  });

  res.status(201).json({ job: service.presentJob(job) });
});

export const getController = asyncHandler(async (req, res) => {
  const doctorId = doctorIdOf(req);
  res.json({ job: await service.getJob(req.params.id, doctorId) });
});

export const listController = asyncHandler(async (req, res) => {
  const doctorId = doctorIdOf(req);
  res.json({ items: await service.listJobs(doctorId, { limit: req.query?.limit }) });
});

export const updateDraftController = asyncHandler(async (req, res) => {
  const doctorId = doctorIdOf(req);
  const patch = req.body?.draft;
  if (!patch || typeof patch !== "object") {
    throw new ValidationError("Ожидается объект draft с полями черновика");
  }
  res.json({ job: await service.updateDraft(req.params.id, doctorId, patch) });
});

export const attachController = asyncHandler(async (req, res) => {
  const doctorId = doctorIdOf(req);
  res.json(await service.attachJob(req.params.id, doctorId));
});

export const discardController = asyncHandler(async (req, res) => {
  const doctorId = doctorIdOf(req);
  res.json(await service.discardJob(req.params.id, doctorId));
});
