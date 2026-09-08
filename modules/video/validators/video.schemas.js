// server/modules/video/validators/video.schemas.js
//
// Схемы тела и запроса для каталога видео. Zod — как в остальных модулях.
//
// ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: поля visibility в схеме создания и правки.
// Открыть ролик наружу можно только отдельным действием publish, где живут
// проверки на PHI и готовность файла. Позволить менять видимость обычным
// PATCH значило бы обойти их одной строкой в теле запроса.

import { z } from "zod";
import {
  VIDEO_KINDS,
  VIDEO_SOURCES,
  VIDEO_LOCALES,
  VIDEO_LICENSES,
} from "../constants.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Некорректный идентификатор");

const attributionItem = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300).optional(),
  license: z.enum(VIDEO_LICENSES),
  url: z.string().trim().max(1000).optional(),
});

export const createVideoSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(300),
  description: z.string().trim().max(5000).optional(),
  lang: z.enum(VIDEO_LOCALES).optional(),
  kind: z.enum(VIDEO_KINDS).optional(),
  // Отметка «в кадре пациент». Ставится автором осознанно; для записи
  // приёма модель проставит её сама, что бы сюда ни пришло.
  phi: z.boolean().optional(),
  source: z
    .object({
      kind: z.enum(VIDEO_SOURCES).optional(),
      studioFilmId: z.string().trim().max(200).optional(),
      ref: z
        .object({
          entityType: z.string().trim().max(100).optional(),
          entityId: objectId.optional(),
        })
        .optional(),
    })
    .optional(),
  attribution: z.array(attributionItem).max(20).optional(),
});

export const updateVideoSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    lang: z.enum(VIDEO_LOCALES).optional(),
    kind: z.enum(VIDEO_KINDS).optional(),
    phi: z.boolean().optional(),
    attribution: z.array(attributionItem).max(20).optional(),
    // Полка витрины. null — это «снять с полки», а не ошибка:
    // без него раздел можно было бы только поменять, но не убрать.
    categoryId: z.union([z.string().trim().length(24), z.null()]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Нечего менять" });

export const publishVideoSchema = z.object({
  visibility: z.enum(["clinic", "link", "public"]),
});

export const attachSchema = z.object({
  entityType: z.enum([
    "clinic-appointment",
    "clinic-patient",
    "clinic-medical-encounter",
    "radiology-case",
    "consultation",
    "doctor-profile",
    "clinic",
  ]),
  entityId: objectId,
});

export const listVideosQuerySchema = z.object({
  // Чьи ролики показать. Без этого поля состав выборки зависел от роли:
  // пациент, оказавшийся администратором клиники, видел в «Моих роликах»
  // чужие фильмы — и кнопку «Удалить» на них.
  scope: z.enum(["own", "clinic", "all"]).optional(),
  kind: z.enum(VIDEO_KINDS).optional(),
  status: z.enum(["draft", "processing", "ready", "failed"]).optional(),
  phi: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const publicListQuerySchema = z.object({
  kind: z.enum(VIDEO_KINDS).optional(),
  lang: z.enum(VIDEO_LOCALES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // Лента «Подписки»: та же витрина, суженная до каналов зрителя.
  // Значение одно, но это именно перечисление — параметр ещё вырастет
  // («история», «сохранённое»), и строка без границ тут превратится в
  // способ передать серверу что угодно.
  feed: z.enum(["subscriptions"]).optional(),
  // Полка витрины и поиск. Сервис читал их с первого дня, но в схеме
  // их не было — а zod молча выбрасывает неизвестные поля. Выбор
  // раздела и поиск работали на вид, а выдача всегда возвращала весь
  // каталог: отказа нет, ошибки нет, просто не тот список.
  categoryId: z.string().trim().length(24).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // Порядок выдачи. «Популярное» было пунктом меню, который вёл на ту же
  // страницу и ничего не менял.
  sort: z.enum(["new", "popular"]).optional(),
  // Лента одного канала: открывается из списка подписок.
  channelType: z.enum(["user", "clinic"]).optional(),
  channelId: z.string().trim().length(24).optional(),
});

/**
 * Перенос фильма из студии.
 *
 * source — то, что человек скопировал: ссылка целиком или голый код.
 * Разбирает его сервис; здесь важно лишь, что строка не пустая и не
 * бесконечная.
 *
 * durationSec приходит от клиента, потому что ffprobe на сервере нет.
 * Это не дыра в расходах: настоящим ограничителем служит размер файла,
 * который мы проверяем сами при скачивании.
 */
export const importStudioSchema = z.object({
  source: z.string().trim().min(1).max(1000),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  lang: z.enum(VIDEO_LOCALES).optional(),
  kind: z.enum(VIDEO_KINDS).optional(),
  categoryId: z.string().trim().length(24).optional(),
  durationSec: z.coerce.number().int().min(0).max(36000).optional(),
});

/**
 * Жалоба на материал.
 *
 * Причина обязательна и выбирается из списка: свободный текст без причины
 * невозможно поставить в очередь разбора, а разбирающему нужно понимать,
 * что перед ним, ещё до чтения.
 */
export const reportSchema = z.object({
  targetType: z.enum(["video", "comment"]),
  targetId: z.string().trim().length(24),
  reason: z.enum([
    "medical",
    "privacy",
    "copyright",
    "abuse",
    "spam",
    "sexual",
    "other",
  ]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Заказ субтитров.
 *
 * targets — явный выбор автора: каждый язык стоит вызова модели,
 * и переводить веером на всё подряд за человека мы не вправе.
 */
export const transcribeSchema = z.object({
  lang: z.enum(VIDEO_LOCALES).optional(),
  targets: z.array(z.enum(VIDEO_LOCALES)).max(VIDEO_LOCALES.length).optional(),
});

/** Решение по жалобе. */
export const resolveReportSchema = z.object({
  status: z.enum(["reviewing", "resolved", "rejected"]),
  resolution: z.string().trim().max(2000).optional(),
});

/** Подписка на канал: врач или клиника. */
export const subscribeSchema = z.object({
  channelType: z.enum(["user", "clinic"]),
  channelId: z.string().trim().length(24),
});

/**
 * Доклад плеера о просмотре.
 *
 * Верхняя граница в 12 часов — не про длину ролика, а про доверие: число
 * приходит от клиента, и без потолка счётчик досмотров накручивается одним
 * запросом. Сервис вдобавок обрезает значение по реальной длительности.
 */
export const watchSchema = z.object({
  watchedSec: z.number().min(0).max(60 * 60 * 12),
});

/**
 * Заявка на машинную сборку ролика.
 *
 * Источник только один из двух — врачебный текст или размеченный случай.
 * Свободного «сгенерируй про гастрит» здесь нет намеренно: ролик обязан
 * опираться на то, что уже прочитал и подписал человек.
 */
export const draftFromDataSchema = z
  .object({
    source: z.enum(["summary", "radiology"]),
    lang: z.enum(VIDEO_LOCALES).optional(),
    phi: z.boolean().optional(),
    procedureName: z.string().trim().max(300).optional(),
    // source = summary
    summary: z.string().trim().max(8000).optional(),
    consultationId: objectId.optional(),
    // source = radiology
    caseId: objectId.optional(),
  })
  .refine((v) => (v.source === "summary" ? Boolean(v.summary) : true), {
    message: "Для сборки из текста нужен сам текст",
  })
  .refine((v) => (v.source === "radiology" ? Boolean(v.caseId) : true), {
    message: "Укажите случай радиологии",
  });

/** Решение врача по сценарию. При отказе причина обязательна — см. сервис. */
export const reviewSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

/** Покупка пакета минут. Ключ пакета, а не число: цену задаёт не клиент. */
export const buyMinutesSchema = z.object({
  pack: z.enum(["video_minutes_30", "video_minutes_120"]),
});

/**
 * Заявка на загрузку файла.
 *
 * Согласие с правилами — обязательное поле, и версия вместе с ним: подпись
 * под прошлой редакцией не означает согласия с новой.
 */
export const prepareUploadSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(300),
  description: z.string().trim().max(5000).optional(),
  lang: z.enum(VIDEO_LOCALES).optional(),
  kind: z.enum(VIDEO_KINDS).optional(),
  phi: z.boolean().optional(),
  mime: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().min(1),
  durationSec: z.number().min(1),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "Подтвердите правила публикации" }),
  }),
  termsVersion: z.string().trim().min(1),
});

export const completeUploadSchema = z.object({
  videoId: objectId,
});

/**
 * Тело вебхука студии.
 *
 * Ключи файлов приходят строками — проверять их формат здесь нельзя:
 * раскладку хранилища задаёт студия, и жёсткая маска сломала бы приём
 * рендера при первом же изменении на её стороне.
 */
export const studioCallbackSchema = z.object({
  studioFilmId: z.string().trim().min(1).max(200),
  status: z.enum(["ready", "processing", "failed"]).optional(),
  failureReason: z.string().trim().max(500).optional(),
  media: z
    .object({
      storageKey: z.string().trim().max(500).optional(),
      hlsKey: z.string().trim().max(500).optional(),
      posterKey: z.string().trim().max(500).optional(),
      durationSec: z.number().min(0).max(60 * 60 * 12).optional(),
      sizeBytes: z.number().min(0).optional(),
      mime: z.string().trim().max(100).optional(),
    })
    .optional(),
});

export default {
  createVideoSchema,
  updateVideoSchema,
  publishVideoSchema,
  attachSchema,
  listVideosQuerySchema,
  publicListQuerySchema,
  importStudioSchema,
  subscribeSchema,
  reportSchema,
  resolveReportSchema,
  transcribeSchema,
  watchSchema,
  draftFromDataSchema,
  reviewSchema,
  buyMinutesSchema,
  prepareUploadSchema,
  completeUploadSchema,
  studioCallbackSchema,
};
