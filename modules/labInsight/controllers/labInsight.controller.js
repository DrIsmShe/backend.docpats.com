// server/modules/labInsight/controllers/labInsight.controller.js
//
// HTTP-слой расшифровки анализов. Тонкий: вся логика в сервисах.

import * as svc from "../services/labInsight.service.js";
import { labInsightQuotaLeft } from "../services/labInsightQuota.service.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";
import {
  ValidationError,
  NotFoundError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";

function handleError(res, err) {
  if (err instanceof ValidationError) {
    // details несут feature/limit/used — по ним интерфейс показывает
    // не просто отказ, а сколько осталось и когда восстановится.
    return res.status(400).json({
      success: false,
      message: errorText(err, res.req),
      ...(err.details || {}),
    });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: errorText(err, res.req) });
  }
  if (err instanceof ServiceUnavailableError) {
    return res.status(503).json({ success: false, message: errorText(err, res.req) });
  }
  console.error("labInsight:", err);
  return res
    .status(500)
    .json({ success: false, message: res.req?.t?.("app.labForm.parseFailed") ?? "Не удалось разобрать бланк" });
}

export async function createController(req, res) {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.labForm.attachmentRequired"),
      });
    }

    const insight = await svc.createLabInsight({
      userId: req.session.userId,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      language: req.body?.language || "ru",
    });

    return res.status(201).json({ success: true, insight });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function listController(req, res) {
  try {
    const items = await svc.listLabInsights({ userId: req.session.userId });
    return res.json({ success: true, items, count: items.length });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function getController(req, res) {
  try {
    const insight = await svc.getLabInsight({
      userId: req.session.userId,
      id: req.params.id,
    });
    return res.json({ success: true, insight });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function deleteController(req, res) {
  try {
    const out = await svc.deleteLabInsight({
      userId: req.session.userId,
      id: req.params.id,
    });
    return res.json({ success: true, ...out });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function quotaController(req, res) {
  try {
    const quota = await labInsightQuotaLeft(req.session.userId);
    return res.json({ success: true, quota });
  } catch (err) {
    return handleError(res, err);
  }
}

export default {
  createController,
  listController,
  getController,
  deleteController,
  quotaController,
};
