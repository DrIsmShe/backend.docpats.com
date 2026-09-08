// server/modules/video/services/videoGeneration.service.js
//
// Сборка ролика из данных платформы: сценарий → черновик каталога →
// проверка врачом → очередь рендера.
//
// ПОРЯДОК ЗДЕСЬ ГЛАВНОЕ. Ролик не уходит на рендер сразу после генерации:
// сначала врач читает сценарий и подтверждает его. Причина не в
// перестраховке, а в разнице последствий. Неточность в тексте статьи
// правится незаметно; ролик, который пациент посмотрел перед операцией и
// под который подписал согласие, отозвать уже нельзя — он видел и запомнил.
//
// ЧЕРНОВИК СОЗДАЁТСЯ СРАЗУ, ДО ПРОВЕРКИ. Иначе сценарий жил бы в памяти
// процесса и терялся при перезапуске, а врач возвращался бы к пустому месту.
// Запись каталога со статусом draft и review.status="pending" — это и есть
// «лежит и ждёт человека».

import mongoose from "mongoose";
import Video from "../models/video.model.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  QuotaExceededError,
} from "../../../common/utils/errors.js";
import { canFor } from "../../../common/auth/can.js";
import { recordAction } from "../../audit/services/audit.service.js";
import {
  scriptFromSummary,
  scriptFromRadiologyCase,
} from "../render/scriptwriter.js";
import { enqueueRender, renderEnabled } from "../render/render.queue.js";
import { canRender } from "./videoQuota.service.js";

const asId = (v) => (v ? String(v) : "");

function auditActor(actor) {
  return {
    userId: actor.ownerId,
    email: actor.email || null,
    role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
  };
}

function clinicCan(actor, action) {
  if (!actor.role || !actor.clinicId) return false;
  return canFor(
    { role: actor.role, permissions: actor.permissions || null },
    "video",
    action,
  );
}

/**
 * Собрать сценарий и завести черновик.
 *
 * Источник — либо врачебный текст (эпикриз, итог консультации), либо
 * размеченный случай радиологии. Больше ничего: генерировать ролик из
 * данных, которые не читал врач, нельзя — подтверждать будет нечего.
 */
export async function draftFromData({ actor, data }) {
  if (!clinicCan(actor, "write") && actor.ownerType !== "user") {
    throw new ForbiddenError("Нет права создавать ролики");
  }

  let script;
  let sourceRef = { entityType: "", entityId: null };

  if (data.source === "summary") {
    script = await scriptFromSummary({
      summary: data.summary,
      procedure: data.procedureName || "",
      lang: data.lang || "ru",
    });
    if (data.consultationId) {
      sourceRef = { entityType: "consultation", entityId: data.consultationId };
    }
  } else if (data.source === "radiology") {
    const RadiologyCase = (
      await import("../../radiology/radiology-cases/models/radiologyCase.model.js")
    ).default;
    const caseDoc = await RadiologyCase.findById(data.caseId);
    if (!caseDoc) throw new NotFoundError("Случай не найден");
    script = await scriptFromRadiologyCase({ caseDoc, lang: data.lang || "ru" });
    sourceRef = { entityType: "radiology-case", entityId: caseDoc._id };
  } else {
    throw new ValidationError("Неизвестный источник для генерации");
  }

  const video = await Video.create({
    ownerType: actor.ownerType,
    ownerId: actor.ownerId,
    clinicId: actor.clinicId || null,
    title: script.title || data.procedureName || "Разъяснительный ролик",
    lang: script.lang,
    kind: script.kind,
    // Сгенерированный ролик про конкретного человека — это PHI, и решает
    // это вызывающий, а не модель: разбор снимка пациента и общий ролик
    // «что такое гастроскопия» приходят одним путём.
    phi: Boolean(data.phi),
    source: { kind: "generated", ref: sourceRef },
    status: "draft",
    media: { durationSec: script.durationSec },
    generation: {
      script,
      model: "claude",
      generatedAt: new Date(),
    },
    review: { status: "pending" },
  });

  await recordAction({
    actor: auditActor(actor),
    action: "video.create",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      kind: video.kind,
      phi: video.phi,
      sourceKind: "generated",
      scenes: script.scenes.length,
      durationSec: script.durationSec,
      inputTokens: script.usage?.inputTokens ?? null,
      outputTokens: script.usage?.outputTokens ?? null,
    },
  });

  return video;
}

/**
 * Врач подтверждает сценарий — и только теперь ролик уходит на рендер.
 *
 * Подтвердить может владелец или коллега с правом записи в той же клинике:
 * ролик, сгенерированный уходящей сменой, не должен зависать до её
 * возвращения. Но подтверждение всегда именное — в журнале видно, кто
 * отвечает за то, что услышит пациент.
 */
export async function approveGenerated({ actor, id, notes }) {
  const video = await загрузитьСвой(id, actor);

  if (!video.generation?.script) {
    throw new ValidationError("У ролика нет сценария — подтверждать нечего");
  }
  if (video.review?.status === "approved") {
    throw new ConflictError("Сценарий уже подтверждён");
  }

  video.review = {
    status: "approved",
    byUserId: actor.ownerId,
    byMembershipId: actor.membershipId || null,
    at: new Date(),
    notes: String(notes || "").slice(0, 1000),
  };
  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.review.approve",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      scenes: video.generation.script.scenes?.length ?? 0,
      durationSec: video.generation.script.durationSec ?? 0,
      hasNotes: Boolean(video.review.notes),
    },
  });

  // Рендер может быть выключен — тогда подтверждение всё равно состоялось,
  // а задание поставит тот, кто включит генерацию. Молча проглатывать это
  // нельзя: вызывающий должен знать, поехало или нет.
  let queued = false;
  if (renderEnabled()) {
    // Квота проверяется ДО постановки задания. После рендера отказывать
    // поздно: он уже оплачен, а результат человеку всё равно не достанется.
    // Владелец-сотрудник клиники под лимит не подпадает — за него платит
    // клиника, и её тариф считается отдельно.
    if (actor.ownerType === "user") {
      const User = (await import("../../../common/models/Auth/users.js")).default;
      const user = await User.findById(actor.ownerId)
        .select("subscriptionPlan subscription videoRenderMinutesAddon")
        .lean();
      const { allowed, reason } = await canRender({
        user,
        ownerType: "user",
        ownerId: actor.ownerId,
        durationSec: video.media?.durationSec || 0,
      });
      if (!allowed) throw new QuotaExceededError(reason);
    }

    await enqueueRender({
      videoId: video._id,
      script: video.generation.script,
      meta: { lang: video.lang, kind: video.kind, phi: video.phi },
    });
    queued = true;
  }

  return { video, queued };
}

/** Врач отклоняет сценарий. Причина обязательна — по ней его перепишут. */
export async function rejectGenerated({ actor, id, notes }) {
  const video = await загрузитьСвой(id, actor);
  if (!String(notes || "").trim()) {
    throw new ValidationError("Укажите, что не так со сценарием");
  }

  video.review = {
    status: "rejected",
    byUserId: actor.ownerId,
    byMembershipId: actor.membershipId || null,
    at: new Date(),
    notes: String(notes).slice(0, 1000),
  };
  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.review.reject",
    resourceType: "video",
    resourceId: video._id,
    metadata: { scenes: video.generation?.script?.scenes?.length ?? 0 },
  });

  return video;
}

/** Ролик, который актёр вправе рецензировать. */
async function загрузитьСвой(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Ролик не найден");
  const video = await Video.findById(id);
  if (!video) throw new NotFoundError("Ролик не найден");

  const свой =
    video.ownerType === actor.ownerType && asId(video.ownerId) === asId(actor.ownerId);
  const своя =
    video.clinicId &&
    asId(video.clinicId) === asId(actor.clinicId) &&
    clinicCan(actor, "write");

  if (!свой && !своя) throw new NotFoundError("Ролик не найден");
  return video;
}

export default { draftFromData, approveGenerated, rejectGenerated };
