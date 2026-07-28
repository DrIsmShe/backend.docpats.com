// server/modules/diagnostics/audit.js
//
// Запись в канонический HIPAA-журнал (modules/audit → коллекция
// hipaa_audit_logs, только на добавление, TTL 7 лет).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Модуль работает с данными живых пациентов и, в
// отличие от остальных, ОТПРАВЛЯЕТ их наружу — внешней модели. Значит, к
// обычному «кто читал карту» добавляется вопрос, на который однажды придётся
// отвечать письменно: что именно ушло за пределы контура, когда и на каком
// основании. Собирать этот ответ по логам приложения нельзя — он должен
// писаться в тот же журнал, что и остальной доступ к PHI.
//
// ДВА РЕЖИМА ЗАПИСИ, и разница между ними не техническая:
//
//   trace()  — чтения и правки. Fire-and-forget: сбой журнала не должен
//              ронять открытие дела. Потеря записи о просмотре неприятна, но
//              не меняет судьбу данных.
//
//   traceEgress() — отправка материалов наружу (разбор, распознавание) и
//              подтверждение согласия. Здесь запись ОБЯЗАТЕЛЬНА и делается ДО
//              отправки: если журнал недоступен, данные наружу не уходят.
//              Иначе возможен худший расклад — материалы ушли, а следа нет.
//
// PHI В METADATA НЕ КЛАДЁМ НИКОГДА. Только структурные данные: сколько
// материалов, каких видов, сколько символов. Журнал сам по себе становится
// хранилищем персональных данных ровно в тот момент, когда туда попадает
// первая строка текста пациента.

import { recordAction, recordActionAsync } from "../audit/services/audit.service.js";
import logger from "../../common/logger.js";

/** Актор из запроса. У модуля свой middleware, он кладёт diagnosticsActor. */
function actorOf(req) {
  return {
    userId: req?.diagnosticsActor?.userId,
    role: req?.diagnosticsActor?.role,
  };
}

/** Технический контекст запроса — для расследования инцидентов. */
function contextOf(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? null,
    userAgent: req?.headers?.["user-agent"] ?? null,
    sessionId: req?.sessionID ?? null,
    httpMethod: req?.method ?? null,
    httpPath: req?.originalUrl ?? req?.path ?? null,
  };
}

/**
 * Обычное событие: чтение, правка, вердикт. Не блокирует ответ.
 */
export function trace(req, { action, resourceType = "diagnostic-case", resourceId, metadata }) {
  recordActionAsync({
    actor: actorOf(req),
    action,
    resourceType,
    resourceId: resourceId ? String(resourceId) : undefined,
    resourceOwnerId: req?.diagnosticsActor?.userId
      ? String(req.diagnosticsActor.userId)
      : undefined,
    metadata,
    context: contextOf(req),
  });
}

/**
 * Событие выхода данных за пределы контура — пишется СИНХРОННО и до действия.
 *
 * Если журнал недоступен, бросаем ошибку и не отправляем ничего. Это
 * сознательный размен: отказ в работе лучше, чем неучтённая передача данных
 * пациента наружу.
 *
 * @throws если запись в журнал не удалась
 */
export async function traceEgress(req, { action, resourceId, metadata }) {
  await recordAction({
    actor: actorOf(req),
    action,
    resourceType: "diagnostic-case",
    resourceId: resourceId ? String(resourceId) : undefined,
    resourceOwnerId: req?.diagnosticsActor?.userId
      ? String(req.diagnosticsActor.userId)
      : undefined,
    metadata,
    context: contextOf(req),
  });
}

/**
 * Отказ в доступе. Пишется отдельно: серия отказов от одного пользователя —
 * сигнал безопасности, а не просто неудачное нажатие.
 */
export function traceDenied(req, { action, resourceId, reason }) {
  recordActionAsync({
    actor: actorOf(req),
    action,
    resourceType: "diagnostic-case",
    resourceId: resourceId ? String(resourceId) : undefined,
    outcome: "denied",
    failureReason: reason,
    context: contextOf(req),
  });
}

/**
 * Структурное описание материалов дела для metadata.
 *
 * Именно то, что позволяет ответить «что ушло наружу», не храня само
 * содержимое: сколько материалов, каких видов, какой суммарный объём текста.
 */
export function describeArtifacts(artifacts = []) {
  const byKind = {};
  let textLength = 0;
  for (const a of artifacts) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    textLength += String(a.text ?? "").length;
  }
  return { artifactCount: artifacts.length, byKind, textLength };
}

/** Диагностика на старте: journal обязателен, и это стоит проверить громко. */
export function assertAuditAvailable() {
  if (typeof recordAction !== "function") {
    logger?.error?.({}, "diagnostics: audit service недоступен");
    throw new Error("Audit service недоступен — модуль diagnostics работать не должен");
  }
}
