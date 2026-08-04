// modules/clinic/clinic-medical/controllers/examinationTemplate.controller.js
//
// HTTP-слой справочника заготовок для протоколов исследований.
//
// Тело запроса разбирается zod'ом до сервиса — как в labResult.controller.js.
// Аудит пишется через recordActionAsync: справочник не содержит данных
// пациента, но по журналу видно, кто правит формулировки, которыми потом
// пользуется вся клиника.

import { z } from "zod";
import * as svc from "../services/examinationTemplate.service.js";
import { recordActionAsync } from "../../../audit/services/audit.service.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  UnprocessableError,
  toErrorResponse,
} from "../../../../common/utils/errors.js";
import {
  TEMPLATE_KINDS,
  TEMPLATE_SCOPES,
  kindsForScope,
} from "../models/examinationTemplate.model.js";
import { VALID_STUDY_TYPES } from "../services/imaging.service.js";

const ET = ACTIONS.EXAM_TEMPLATE;

// Схема пропускает любой известный блок, а соответствие блока области
// проверяет отдельным правилом: zod не умеет условный enum, а разводить две
// схемы ради этого значит дублировать все поля.
const createSchema = z
  .object({
    scope: z.enum(TEMPLATE_SCOPES).optional(),
    modality: z.enum(VALID_STUDY_TYPES).optional(),
    kind: z.enum(TEMPLATE_KINDS),
    title: z.string().trim().min(1).max(300),
    body: z.string().max(20000).optional(),
  })
  .superRefine((v, ctx) => {
    const scope = v.scope || "examination";

    if (scope !== "encounter" && !v.modality) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modality"],
        message: "Для протокола исследования нужен вид исследования",
      });
    }

    if (!kindsForScope(scope).includes(v.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message: `Блок «${v.kind}» не относится к области «${scope}»`,
      });
    }
  });

// Вид исследования и вид заготовки не меняются: заготовка «заключение для КТ»,
// ставшая «названием для МРТ», — это другая запись.
const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(20000).optional(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined, {
    message: "Нужно передать title или body",
  });

const listSchema = z.object({
  scope: z.enum(TEMPLATE_SCOPES).optional(),
  modality: z.enum(VALID_STUDY_TYPES).optional(),
  kind: z.enum(TEMPLATE_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * Разбор входных данных.
 *
 * ВАЖНО: только safeParse. Метод parse бросает ZodError, а обработчик
 * ошибок проекта (toErrorResponse) про такой класс не знает и отдаёт 500 —
 * то есть любая опечатка в параметре превращалась бы во «внутреннюю ошибку
 * сервера». Здесь ошибка становится типизированной 422, как в соседних
 * контроллерах модуля.
 */
function parse(schema, source, label) {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new UnprocessableError(`Неверные данные: ${label}`, result.error.flatten());
  }
  return result.data;
}

// В metadata аудита — только структурное: область, вид исследования и блок.
// Ни заголовка, ни текста: правило модуля audit — форма события, не содержание.
const meta = (t) => ({ scope: t?.scope, modality: t?.modality, kind: t?.kind });

export async function list(req, res) {
  try {
    const query = parse(listSchema, req.query ?? {}, "параметры списка");
    const result = await svc.listTemplates(query);
    res.json(result);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  }
}

export async function getOne(req, res) {
  try {
    const template = await svc.getTemplate(req.params.templateId);
    recordActionAsync({
      action: ET.READ,
      resourceType: "clinic-medical-exam-template",
      resourceId: template._id,
      metadata: meta(template),
    });
    res.json({ template });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  }
}

export async function create(req, res) {
  try {
    const body = parse(createSchema, req.body ?? {}, "тело запроса");
    const template = await svc.createTemplate(body);
    recordActionAsync({
      action: ET.CREATE,
      resourceType: "clinic-medical-exam-template",
      resourceId: template._id,
      metadata: meta(template),
    });
    res.status(201).json({ template });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  }
}

export async function update(req, res) {
  try {
    const body = parse(updateSchema, req.body ?? {}, "тело запроса");
    const template = await svc.updateTemplate(req.params.templateId, body);
    recordActionAsync({
      action: ET.UPDATE,
      resourceType: "clinic-medical-exam-template",
      resourceId: template._id,
      metadata: meta(template),
    });
    res.json({ template });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  }
}

export async function remove(req, res) {
  try {
    const result = await svc.deleteTemplate(req.params.templateId);
    recordActionAsync({
      action: ET.DELETE,
      resourceType: "clinic-medical-exam-template",
      resourceId: result._id,
    });
    res.json(result);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  }
}
