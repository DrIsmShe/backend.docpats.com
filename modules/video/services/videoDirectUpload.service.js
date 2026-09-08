// server/modules/video/services/videoDirectUpload.service.js
//
// Загрузка ролика ЧЕРЕЗ СЕРВЕР — запасной путь, когда браузер не может
// положить файл в хранилище напрямую.
//
// ПОЧЕМУ ОН ПОНАДОБИЛСЯ. Обычный путь — подписанная ссылка: браузер шлёт
// файл прямо в R2, минуя нас. Он требует, чтобы у бакета была разрешена
// запись с нашего домена (CORS). Пока её нет, preflight отвечает 403, и
// человек видит «Загрузка не удалась» — при том что сервер и хранилище
// исправны. Этот путь работает без CORS вовсе: файл идёт на сервер, а к
// хранилищу обращаемся мы сами.
//
// ЭТО НЕ ЗАМЕНА, А ЗАПАСНОЙ ВЫХОД. Через сервер идёт весь трафик роликов:
// при десятке одновременных загрузок это заметная нагрузка, которой у
// прямого пути нет. Как только CORS настроен, клиент снова пойдёт мимо
// нас — он пробует прямой путь первым.
//
// ФАЙЛ ЛЕЖИТ В ПАМЯТИ, И ЭТО ОСОЗНАННО. Предел загрузки — 300 МБ; multer
// с диском потребовал бы уборки временных файлов на каждом обрыве связи,
// а поток в R2 через lib-storage тянет ещё одну зависимость. При текущих
// объёмах память проще и предсказуемее — но именно поэтому предел
// проверяется до чтения тела.

import Video from "../models/video.model.js";
import {
  ValidationError,
  ServiceUnavailableError,
  QuotaExceededError,
} from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { videoQuota } from "./videoQuota.service.js";
import { МАКС_БАЙТ, МАКС_СЕКУНД, ТИПЫ } from "./videoUpload.service.js";
import { правилаПриняты, ВЕРСИЯ_ПРАВИЛ } from "../uploadRules.js";

/**
 * Принять файл и положить его в хранилище от своего имени.
 *
 * @param {object} p
 * @param {object} p.actor
 * @param {object} p.file   объект multer: buffer, mimetype, originalname
 * @param {object} p.data   title, description, categoryId, durationSec, правила
 */
export async function directUpload({ actor, file, data }) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new ServiceUnavailableError("Хранилище не настроено");

  if (!file?.buffer?.length) throw new ValidationError("Файл не получен");

  // Те же правила, что и на прямом пути: запасной вход не должен быть
  // лазейкой мимо согласия и пределов.
  if (!правилаПриняты(data.rulesVersion)) {
    throw new ValidationError(
      "Подтвердите правила публикации — без этого загрузка невозможна",
    );
  }

  // ТИПЫ — это карта «mime → расширение», а не список: расширение
  // нужно тут же, чтобы имя в хранилище совпадало с содержимым.
  if (!ТИПЫ[file.mimetype]) {
    throw new ValidationError(
      `Такой формат не принимается: ${file.mimetype}. Подойдут MP4, WebM или MOV`,
    );
  }

  if (file.buffer.length > МАКС_БАЙТ) {
    throw new ValidationError(
      `Файл тяжелее ${Math.round(МАКС_БАЙТ / 1024 / 1024)} МБ`,
    );
  }

  const секунд = Math.round(Number(data.durationSec) || 0);
  if (секунд > МАКС_СЕКУНД) {
    throw new ValidationError(
      `Ролик длиннее ${Math.round(МАКС_СЕКУНД / 60)} минут загрузить нельзя`,
    );
  }

  // Квота хранилища — по факту полученного файла.
  if (actor.ownerType === "user") {
    const User = (await import("../../../common/models/Auth/users.js")).default;
    const user = await User.findById(actor.ownerId)
      .select("subscriptionPlan subscription videoRenderMinutesAddon")
      .lean();
    const квота = await videoQuota({ user, ownerType: "user", ownerId: actor.ownerId });
    const нужноГб = file.buffer.length / 1024 ** 3;
    if (квота.storageLimit !== -1 && квота.storageLeft < нужноГб) {
      throw new QuotaExceededError(
        `Не хватает места: свободно ${квота.storageLeft.toFixed(2)} ГБ из ${квота.storageLimit}`,
      );
    }
  }

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = (await import("../../../common/services/r2Client.js")).default;

  const метка = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ключ = `videos/uploads/${actor.ownerId}/${метка}${ТИПЫ[file.mimetype]}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: ключ,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  // Кадр для карточки: если браузер его прислал — кладём рядом. Без него
  // ролик всё равно создаётся: превью можно снять позже, а потерять
  // загруженный файл из-за картинки нельзя.
  let ключПостера = "";
  if (data.poster) {
    try {
      const байты = Buffer.from(String(data.poster).split(",").pop(), "base64");
      ключПостера = `videos/uploads/${actor.ownerId}/${метка}.jpg`;
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: ключПостера,
          Body: байты,
          ContentType: "image/jpeg",
        }),
      );
    } catch (err) {
      console.warn("[video] превью не сохранено:", err?.message);
      ключПостера = "";
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
    categoryId: data.categoryId || null,
    phi: Boolean(data.phi),
    // Приватный, как и всё новое: публикация — отдельное осознанное
    // действие со своими проверками.
    visibility: "private",
    status: "ready",
    source: { kind: "upload" },
    media: {
      storageKey: ключ,
      posterKey: ключПостера,
      durationSec: секунд,
      sizeBytes: file.buffer.length,
      mime: file.mimetype,
    },
    uploadTerms: { version: ВЕРСИЯ_ПРАВИЛ, acceptedAt: new Date() },
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
      sourceKind: "direct-upload",
      sizeBytes: file.buffer.length,
      durationSec: секунд,
      mime: file.mimetype,
    },
  });

  return video;
}

export default { directUpload };
