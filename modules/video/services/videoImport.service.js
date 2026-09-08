// server/modules/video/services/videoImport.service.js
//
// Перенос готового фильма из студии DP-Videra в каталог платформы.
//
// ЗАЧЕМ ЭТО СУЩЕСТВУЕТ. Студия ещё не сообщает нам о снятых фильмах —
// вебхук /studio/callback написан и ждёт, но стучаться в него должна она.
// Пока этого нет, автор снимает фильм и не может ничего с ним сделать на
// платформе: ни показать пациенту, ни приложить к приёму, ни опубликовать.
// Импорт по ссылке закрывает эту дыру, не трогая чужой код.
//
// ЭТО ВРЕМЕННЫЙ ПУТЬ, И ОН ДОЛЖЕН ОСТАТЬСЯ ЧЕСТНЫМ. Файл действительно
// переносится к нам: ролик, оставшийся ссылкой на чужой сервер, перестал бы
// играть в тот день, когда там что-то поменяют. Поэтому скачиваем и кладём
// в своё хранилище — как при обычной загрузке, с теми же пределами и той же
// квотой.
//
// ЧТО МЫ НЕ УМЕЕМ УЗНАТЬ. Длительность фильма приходит от клиента: его
// измеряет браузер, а ffprobe на сервере нет. Ограничителем расхода служит
// размер — его мы проверяем сами по факту скачивания.

import Video from "../models/video.model.js";
import {
  ValidationError,
  QuotaExceededError,
  ServiceUnavailableError,
  ConflictError,
} from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { videoQuota } from "./videoQuota.service.js";
import { МАКС_БАЙТ, МАКС_СЕКУНД } from "./videoUpload.service.js";

/** Адрес студии — тот же, что выдаёт пропуск (modules/videra/pass.js). */
function студия() {
  return (process.env.DPVIDERA_URL || "https://docpats.com/dp-videra").replace(
    /\/+$/,
    "",
  );
}

/**
 * Достать идентификатор фильма из того, что вставил человек.
 *
 * Принимаем и полную ссылку, и голый идентификатор: люди копируют то, что
 * видят в адресной строке, и требовать «вставьте только код» — верный
 * способ получить поток обращений в поддержку.
 */
export function разобратьСсылку(строка) {
  const текст = String(строка || "").trim();
  if (!текст) return null;

  const изСсылки = текст.match(/\/dp-videra\/film\/([A-Za-z0-9_-]{6,64})/);
  if (изСсылки) return изСсылки[1];

  // Голый идентификатор: буквы, цифры, дефис и подчёркивание.
  if (/^[A-Za-z0-9_-]{6,64}$/.test(текст)) return текст;

  return null;
}

async function скачать(url, пределБайт) {
  const ответ = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!ответ.ok) throw new ValidationError(`Студия ответила ${ответ.status}`);

  // Размер известен заранее не всегда, но когда известен — отказываем до
  // скачивания, а не после: незачем тянуть к себе то, что всё равно нельзя.
  const заявлено = Number(ответ.headers.get("content-length")) || 0;
  if (заявлено && заявлено > пределБайт) {
    throw new ValidationError(
      `Фильм больше ${Math.round(пределБайт / 1024 / 1024)} МБ — перенести нельзя`,
    );
  }

  const буфер = Buffer.from(await ответ.arrayBuffer());
  if (буфер.length > пределБайт) {
    throw new ValidationError(
      `Фильм больше ${Math.round(пределБайт / 1024 / 1024)} МБ — перенести нельзя`,
    );
  }
  return буфер;
}

/**
 * Перенести фильм студии в каталог.
 *
 * @param {object} p
 * @param {object} p.actor       кто переносит
 * @param {object} p.data        { source, title, description, categoryId, durationSec }
 */
export async function importFromStudio({ actor, data }) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new ServiceUnavailableError("Хранилище не настроено");

  const filmId = разобратьСсылку(data.source);
  if (!filmId) {
    throw new ValidationError(
      "Не похоже на ссылку из студии. Скопируйте адрес страницы фильма",
    );
  }

  // Тот же фильм дважды в каталоге — это два ролика, которые разойдутся
  // просмотрами и правками. Уникальный индекс не даст создать двойника, но
  // понятный отказ лучше ошибки базы.
  const уже = await Video.findOne({ "source.studioFilmId": filmId });
  if (уже) {
    throw new ConflictError("Этот фильм уже перенесён в каталог");
  }

  const секунд = Number(data.durationSec) || 0;
  if (секунд > МАКС_СЕКУНД) {
    throw new ValidationError(
      `Фильм длиннее ${Math.round(МАКС_СЕКУНД / 60)} минут перенести нельзя`,
    );
  }

  const видео = await скачать(`${студия()}/film/${filmId}/video`, МАКС_БАЙТ);
  // Превью необязательно: фильм без картинки лучше, чем несостоявшийся
  // перенос из-за неё.
  let постер = null;
  try {
    постер = await скачать(`${студия()}/film/${filmId}/poster`, 8 * 1024 * 1024);
  } catch {
    постер = null;
  }

  // Квота хранения — по факту скачанного, а не по обещанию.
  if (actor.ownerType === "user") {
    const User = (await import("../../../common/models/Auth/users.js")).default;
    const user = await User.findById(actor.ownerId)
      .select("subscriptionPlan subscription videoRenderMinutesAddon")
      .lean();
    const квота = await videoQuota({ user, ownerType: "user", ownerId: actor.ownerId });
    const нужноГб = видео.length / 1024 ** 3;
    if (квота.storageLimit !== -1 && квота.storageLeft < нужноГб) {
      throw new QuotaExceededError(
        `Не хватает места: свободно ${квота.storageLeft.toFixed(2)} ГБ из ${квота.storageLimit}`,
      );
    }
  }

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = (await import("../../../common/services/r2Client.js")).default;

  const ключВидео = `videos/studio/${filmId}.mp4`;
  const ключПостера = `videos/studio/${filmId}.jpg`;

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: ключВидео,
      Body: видео,
      ContentType: "video/mp4",
    }),
  );
  if (постер) {
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: ключПостера,
        Body: постер,
        ContentType: "image/jpeg",
      }),
    );
  }

  const video = await Video.create({
    ownerType: actor.ownerType,
    ownerId: actor.ownerId,
    clinicId: actor.clinicId || null,
    title: data.title,
    description: data.description || "",
    lang: data.lang || "ru",
    kind: data.kind || "explainer",
    categoryId: data.categoryId || null,
    phi: Boolean(data.phi),
    // Приватный, как и всё новое: опубликовать — отдельное осознанное
    // действие со своими проверками.
    visibility: "private",
    status: "ready",
    source: { kind: "studio", studioFilmId: filmId },
    media: {
      storageKey: ключВидео,
      posterKey: постер ? ключПостера : "",
      durationSec: секунд,
      sizeBytes: видео.length,
      mime: "video/mp4",
    },
  });

  await recordAction({
    actor: {
      userId: actor.ownerId,
      email: actor.email || null,
      role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
    },
    action: "video.create",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      sourceKind: "studio-import",
      sizeBytes: видео.length,
      durationSec: секунд,
      hasPoster: Boolean(постер),
    },
  });

  return video;
}

export default { importFromStudio, разобратьСсылку };
