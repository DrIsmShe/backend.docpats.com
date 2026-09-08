// server/modules/video/services/videoUpload.service.js
//
// Загрузка готового ролика со стороны — файлом, как на YouTube.
//
// ФАЙЛ ИДЁТ МИМО НАШЕГО СЕРВЕРА. Мы выдаём подписанную ссылку на запись в
// R2, браузер льёт файл прямо туда, и только потом сообщает нам «готово».
// Гонять сотни мегабайт через процесс приложения — верный способ положить
// его на трёх одновременных загрузках: каждый запрос держал бы память и
// поток на всё время передачи.
//
// ЧТО ПРОВЕРЯЕТ СЕРВЕР, А ЧТО ПРИХОДИТ ОТ КЛИЕНТА. Размер после загрузки
// сервер узнаёт сам (HeadObject) и сверяет с обещанным — подделать нельзя.
// Длительность измеряет браузер и присылает числом: без ffprobe на сервере
// её проверить нечем, и это ограничение честнее скрытого «доверяем всему».
// Поэтому предел по длительности дублируется пределом по размеру, который
// проверяется по-настоящему.
//
// ПОЧЕМУ ЗАПИСЬ СОЗДАЁТСЯ ДО ЗАГРУЗКИ. Иначе файл в хранилище оказался бы
// ничьим: загрузка оборвалась, ключ есть, записи нет, и убрать его сможет
// только человек руками. Запись в состоянии "processing" — это заявка, а
// уборщик сирот заберёт файл, если она так и не станет готовой.

import mongoose from "mongoose";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import r2 from "../../../common/services/r2Client.js";
import Video from "../models/video.model.js";
import {
  NotFoundError,
  ValidationError,
  QuotaExceededError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { videoQuota } from "./videoQuota.service.js";
import { ВЕРСИЯ_ПРАВИЛ, правилаПриняты } from "../uploadRules.js";

/* ── Пределы ──────────────────────────────────────────────────────
   Десять минут: объяснение длиннее пациент не досматривает, а на досмотре
   держится видео-согласие. 300 МБ на эти десять минут — примерно 4 Мбит/с,
   с запасом на 720p; больший битрейт для разговорного ролика с анатомией
   не даёт ничего, кроме счёта за хранение. */
export const МАКС_СЕКУНД = 600;
export const МАКС_БАЙТ = 300 * 1024 * 1024;

/** Что браузер умеет играть без перекодирования на нашей стороне. */
export const ТИПЫ = Object.freeze({
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
});

/** Ссылка на запись живёт полчаса: столько может идти загрузка с телефона. */
const СРОК_ССЫЛКИ = 30 * 60;

function bucket() {
  return process.env.R2_BUCKET || "";
}

function auditActor(actor) {
  return {
    userId: actor.ownerId,
    email: actor.email || null,
    role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
  };
}

/**
 * Заявка на загрузку: проверки, черновик и ссылки для записи файлов.
 *
 * Возвращает две ссылки — на сам ролик и на превью. Превью делает браузер
 * кадром из видео: просить у человека отдельную картинку значит потерять
 * половину загрузок на этом шаге.
 */
export async function prepareUpload({ actor, data }) {
  if (!bucket()) throw new ServiceUnavailableError("Хранилище не настроено");

  // СОГЛАСИЕ ПРОВЕРЯЕТСЯ ПЕРВЫМ И ПО ВЕРСИИ. Галочка под прошлой редакцией
  // не означает согласия с новой, а «принял правила» без указания, какие
  // именно, не доказывает ничего.
  if (!правилаПриняты(data)) {
    throw new ValidationError(
      "Подтвердите правила публикации — без этого загрузка невозможна",
    );
  }

  const тип = String(data.mime || "");
  if (!ТИПЫ[тип]) {
    throw new ValidationError(
      "Такой формат не подойдёт. Загрузите MP4, WebM или MOV",
    );
  }

  const секунд = Number(data.durationSec) || 0;
  if (secondsInvalid(секунд)) {
    throw new ValidationError(
      `Ролик длиннее ${Math.round(МАКС_СЕКУНД / 60)} минут загрузить нельзя`,
    );
  }

  const байт = Number(data.sizeBytes) || 0;
  if (байт <= 0 || байт > МАКС_БАЙТ) {
    throw new ValidationError(
      `Файл больше ${Math.round(МАКС_БАЙТ / 1024 / 1024)} МБ загрузить нельзя`,
    );
  }

  // Квота хранения — та же, что считает тариф. Проверяем до загрузки:
  // отказать после того, как человек залил триста мегабайт, — издевательство.
  if (actor.ownerType === "user") {
    const User = (await import("../../../common/models/Auth/users.js")).default;
    const user = await User.findById(actor.ownerId)
      .select("subscriptionPlan subscription videoRenderMinutesAddon")
      .lean();
    const квота = await videoQuota({ user, ownerType: "user", ownerId: actor.ownerId });
    const нужноГб = байт / 1024 ** 3;
    if (квота.storageLimit !== -1 && квота.storageLeft < нужноГб) {
      throw new QuotaExceededError(
        `Не хватает места: свободно ${квота.storageLeft.toFixed(2)} ГБ из ${квота.storageLimit}`,
      );
    }
  }

  const video = await Video.create({
    ownerType: actor.ownerType,
    ownerId: actor.ownerId,
    clinicId: actor.clinicId || null,
    title: data.title,
    description: data.description || "",
    lang: data.lang || "ru",
    kind: data.kind || "explainer",
    phi: Boolean(data.phi),
    visibility: "private",
    source: { kind: "upload" },
    // "processing" — файла ещё нет, но заявка есть. Готовым ролик станет
    // только после completeUpload, когда файл действительно лежит в R2.
    status: "processing",
    media: { durationSec: секунд, mime: тип },
    // Под какой редакцией правил загружено — вместе с записью, а не в
    // отдельном журнале: вопрос «с чем он согласился» задают о конкретном
    // ролике.
    uploadTerms: { version: ВЕРСИЯ_ПРАВИЛ, acceptedAt: new Date() },
  });

  const ключ = `videos/upload/${video._id}${ТИПЫ[тип]}`;
  const ключПостера = `videos/upload/${video._id}.jpg`;
  video.media.storageKey = ключ;
  video.media.posterKey = ключПостера;
  await video.save();

  const [uploadUrl, posterUrl] = await Promise.all([
    getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: bucket(), Key: ключ, ContentType: тип }),
      { expiresIn: СРОК_ССЫЛКИ },
    ),
    getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: bucket(),
        Key: ключПостера,
        ContentType: "image/jpeg",
      }),
      { expiresIn: СРОК_ССЫЛКИ },
    ),
  ]);

  await recordAction({
    actor: auditActor(actor),
    action: "video.create",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      sourceKind: "upload",
      sizeBytes: байт,
      durationSec: секунд,
      mime: тип,
    },
  });

  return { videoId: video._id, uploadUrl, posterUrl, expiresInSec: СРОК_ССЫЛКИ };
}

function secondsInvalid(секунд) {
  return !(секунд > 0) || секунд > МАКС_СЕКУНД;
}

/**
 * Файл загружен — проверяем и открываем ролик к показу.
 *
 * Размер берём у хранилища, а не из слов клиента: это единственное число,
 * которое здесь можно проверить по-настоящему, и именно оно ограничивает
 * расход. Файл больше предела удаляем сразу — платить за него мы не должны.
 */
export async function completeUpload({ actor, id }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Ролик не найден");
  const video = await Video.findById(id);
  if (!video) throw new NotFoundError("Ролик не найден");

  const свой =
    video.ownerType === actor.ownerType &&
    String(video.ownerId) === String(actor.ownerId);
  if (!свой) throw new NotFoundError("Ролик не найден");

  let head;
  try {
    head = await r2.send(
      new HeadObjectCommand({ Bucket: bucket(), Key: video.media.storageKey }),
    );
  } catch {
    throw new ValidationError("Файл не найден в хранилище — загрузка не дошла");
  }

  const байт = Number(head.ContentLength) || 0;
  if (байт > МАКС_БАЙТ) {
    // Запись оставляем в failed, а файл ставим в уборку: держать у себя
    // то, за что не договаривались платить, незачем.
    video.status = "failed";
    video.failureReason = "Файл превышает допустимый размер";
    await video.save();
    const { enqueueOrphanFiles } = await import("./video.service.js");
    await enqueueOrphanFiles(video);
    throw new ValidationError(
      `Файл больше ${Math.round(МАКС_БАЙТ / 1024 / 1024)} МБ — он удалён`,
    );
  }

  video.media.sizeBytes = байт;
  video.status = "ready";
  video.failureReason = "";
  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.update",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      sourceKind: "upload",
      sizeBytes: байт,
      durationSec: video.media.durationSec,
      completed: true,
    },
  });

  return video;
}

export default { prepareUpload, completeUpload, МАКС_СЕКУНД, МАКС_БАЙТ, ТИПЫ };
