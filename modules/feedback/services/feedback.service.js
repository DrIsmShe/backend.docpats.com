// server/modules/feedback/services/feedback.service.js
//
// Обращения к разработчикам: приём, переписка, разбор.
//
// ДВЕ СТОРОНЫ И РАЗНЫЕ ПРАВА. Автор видит только свои обращения и может
// дописывать в них реплики. Администратор видит все, отвечает и меняет
// состояние. Третьей стороны нет: обращения не публичны — человек пишет
// нам, а не на форум, и его слова не должны оказаться в общей ленте.
//
// ПОЧЕМУ ПРОВЕРКА ВЛАДЕНИЯ ЖИВЁТ ЗДЕСЬ. Обращение не принадлежит клинике, и
// tenantScoped его не защищает: у пациента клиники нет вовсе. Владение
// определяется парой (authorType, authorId), и сравнивает её сервис — в
// каждом чтении и в каждой записи.
//
// АНТИСПАМ — ПО ЧИСЛУ ОТКРЫТЫХ, А НЕ ПО ЧАСТОТЕ. Ограничение «не больше N
// в час» наказывает человека, который нашёл три ошибки подряд. Ограничение
// на число незакрытых обращений — нет: закрытые не считаются, и активный
// человек не упирается в предел, пока мы сами не перестаём отвечать.

import mongoose from "mongoose";

import Feedback, { ЗАКРЫТЫЕ, СОСТОЯНИЯ } from "../models/feedback.model.js";
import User from "../../../common/models/Auth/users.js";
import { notify } from "../../notifications/services/notification.service.js";
import {
  текстПринято,
  текстСостояния,
  текстШаблона,
} from "./feedbackTexts.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  QuotaExceededError,
} from "../../../common/utils/errors.js";

/* Сколько незакрытых обращений человек может держать одновременно.
   Десять — заведомо больше, чем пишет добросовестный человек, и заведомо
   меньше, чем нужно, чтобы завалить очередь. */
const ПРЕДЕЛ_ОТКРЫТЫХ = 10;

/** Ссылка на карточку обращения в кабинете автора. */
const ссылкаНаОбращение = (id) => `/feedback/${id}`;

function объектId(v) {
  if (!v) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  return mongoose.Types.ObjectId.isValid(v)
    ? new mongoose.Types.ObjectId(v)
    : null;
}

/** Условие «это обращение принадлежит актёру». */
function условиеВладения(actor) {
  return { authorType: actor.ownerType, authorId: объектId(actor.ownerId) };
}

/**
 * Роль автора для снимка.
 *
 * Сотрудник клиники входит без User — для него роль берём из контекста
 * клиники, иначе обращение выглядело бы безымянным.
 */
async function рольАвтора(actor) {
  if (actor.ownerType === "user") {
    const user = await User.findById(actor.ownerId).select("role").lean();
    return user?.role || "user";
  }
  return actor.role ? `clinic_${actor.role}` : "clinic_employee";
}

/* ── Приём ────────────────────────────────────────────────────────── */

/**
 * Создать обращение.
 *
 * Подтверждение приёма пишется сразу и от «system»: человек должен видеть,
 * что письмо дошло, не дожидаясь, пока его прочитают.
 */
export async function создать({ actor, data, context = {} }) {
  const открытых = await Feedback.countDocuments({
    ...условиеВладения(actor),
    status: { $nin: ЗАКРЫТЫЕ },
  });

  if (открытых >= ПРЕДЕЛ_ОТКРЫТЫХ) {
    throw new QuotaExceededError(
      `У вас ${открытых} обращений в работе. Дождитесь ответа по ним — так мы успеем разобрать каждое`,
    );
  }

  const обращение = await Feedback.create({
    authorType: actor.ownerType,
    authorId: объектId(actor.ownerId),
    authorRole: await рольАвтора(actor),
    clinicId: объектId(actor.clinicId),
    kind: data.kind,
    area: data.area || "other",
    subject: data.subject,
    body: data.body,
    locale: data.locale || "ru",
    context: {
      url: String(context.url || data.url || "").slice(0, 500),
      userAgent: String(context.userAgent || "").slice(0, 400),
      viewport: String(data.viewport || "").slice(0, 20),
    },
    messages: [
      { authorType: "author", authorId: объектId(actor.ownerId), text: data.body },
      { authorType: "system", text: текстПринято(data.locale) },
    ],
    lastAuthorAt: new Date(),
  });

  // Уведомление разбирающим. Текст обращения в него НЕ попадает: список
  // уведомлений виден в чужих руках чаще, чем карточка разбора.
  await известитьАдминов(обращение).catch(() => {});

  return обращение.toObject();
}

/** Разослать администраторам сигнал о новом обращении. */
async function известитьАдминов(обращение) {
  const админы = await User.find({ role: "admin" }).select("_id").lean();

  await Promise.all(
    админы.map((а) =>
      notify({
        userId: а._id,
        type: "feedback_new",
        title: "Новое обращение",
        message: `${обращение.kind} · ${обращение.subject}`.slice(0, 200),
        link: `/admin/feedback/${обращение._id}`,
        priority: обращение.kind === "bug" ? "high" : "normal",
        icon: "message-square",
        meta: { feedbackId: String(обращение._id), kind: обращение.kind },
      }).catch(() => null),
    ),
  );
}

/* ── Кабинет автора ───────────────────────────────────────────────── */

/** Свои обращения: список без переписки — она тяжёлая и здесь не нужна. */
export async function мои({ actor, status = null, limit = 50 }) {
  const условие = условиеВладения(actor);
  if (status) условие.status = status;

  const items = await Feedback.find(условие)
    .select("-messages -context.userAgent")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();

  return items.map((о) => ({
    ...о,
    // «Есть непрочитанный ответ» — вопрос, который задаёт каждая карточка
    // в списке; считать его на клиенте значило бы повторить правило дважды.
    hasNewReply: Boolean(
      о.lastAdminAt && (!о.authorReadAt || о.authorReadAt < о.lastAdminAt),
    ),
  }));
}

/** Одно своё обращение с перепиской. Открытие считается прочтением. */
export async function одно({ actor, id }) {
  const обращение = await Feedback.findOne({
    _id: объектId(id),
    ...условиеВладения(actor),
  });

  if (!обращение) throw new NotFoundError("Обращение не найдено");

  if (
    обращение.lastAdminAt &&
    (!обращение.authorReadAt || обращение.authorReadAt < обращение.lastAdminAt)
  ) {
    обращение.authorReadAt = new Date();
    await обращение.save();
  }

  return обращение.toObject();
}

/**
 * Дописать реплику в своё обращение.
 *
 * В закрытое писать нельзя: у закрытого есть итог, и дописка под ним
 * осталась бы без ответа. Правильный ход — новое обращение, о чём и
 * говорит текст ошибки.
 */
export async function дописать({ actor, id, text }) {
  const обращение = await Feedback.findOne({
    _id: объектId(id),
    ...условиеВладения(actor),
  });

  if (!обращение) throw new NotFoundError("Обращение не найдено");

  if (ЗАКРЫТЫЕ.includes(обращение.status)) {
    throw new ValidationError(
      "Обращение закрыто. Если вопрос остался — создайте новое, так его точно увидят",
    );
  }

  обращение.messages.push({
    authorType: "author",
    authorId: объектId(actor.ownerId),
    text,
  });
  обращение.lastAuthorAt = new Date();
  await обращение.save();

  await известитьАдминов(обращение).catch(() => {});

  return обращение.toObject();
}

/* ── Разбор ───────────────────────────────────────────────────────── */

/** Очередь разбора. Фильтры складываются: состояние, вид, раздел. */
export async function очередь({
  status = null,
  kind = null,
  area = null,
  waiting = false,
  page = 1,
  limit = 25,
}) {
  const условие = {};
  if (status) условие.status = status;
  if (kind) условие.kind = kind;
  if (area) условие.area = area;

  // «Ждут ответа» — последнее слово за автором. Именно эти обращения
  // теряются: они выглядят разобранными, пока не откроешь переписку.
  if (waiting) {
    условие.$expr = {
      $gt: ["$lastAuthorAt", { $ifNull: ["$lastAdminAt", new Date(0)] }],
    };
  }

  const шаг = Math.min(Number(limit) || 25, 100);
  const пропустить = (Math.max(Number(page) || 1, 1) - 1) * шаг;

  const [items, total] = await Promise.all([
    Feedback.find(условие)
      .select("-messages")
      .sort({ createdAt: -1 })
      .skip(пропустить)
      .limit(шаг)
      .lean(),
    Feedback.countDocuments(условие),
  ]);

  return { items, total, page: Math.max(Number(page) || 1, 1), limit: шаг };
}

/** Сводка по очереди: сколько в каком состоянии. */
export async function сводка() {
  const строки = await Feedback.aggregate([
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);

  const счёт = Object.fromEntries(СОСТОЯНИЯ.map((с) => [с, 0]));
  for (const с of строки) счёт[с._id] = с.n;

  const открытых = СОСТОЯНИЯ.filter((с) => !ЗАКРЫТЫЕ.includes(с)).reduce(
    (сумма, с) => сумма + счёт[с],
    0,
  );

  return { byStatus: счёт, open: открытых };
}

/** Одно обращение целиком — для карточки разбора. */
export async function карточка(id) {
  const обращение = await Feedback.findById(объектId(id)).lean();
  if (!обращение) throw new NotFoundError("Обращение не найдено");

  // Имя автора берём отдельно: хранить снимок имени в обращении значило
  // бы дублировать личные данные там, где они не нужны для разбора.
  let author = null;
  if (обращение.authorType === "user") {
    const u = await User.findById(обращение.authorId)
      .select("name lastName email role")
      .lean();
    if (u) {
      author = {
        name: [u.name, u.lastName].filter(Boolean).join(" ") || null,
        email: u.email || null,
        role: u.role || null,
      };
    }
  }

  return { ...обращение, author };
}

/**
 * Ответить автору.
 *
 * Свободный текст старше заготовки: если администратор написал своё, он
 * имел в виду именно его. Заготовка переводится на язык обращения — см.
 * feedbackTexts.js.
 */
export async function ответить({ adminId, id, text = "", templateKey = null }) {
  const обращение = await Feedback.findById(объектId(id));
  if (!обращение) throw new NotFoundError("Обращение не найдено");

  const готовый = templateKey
    ? текстШаблона(templateKey, обращение.locale)
    : null;

  if (templateKey && !готовый) {
    throw new ValidationError("Неизвестная заготовка ответа");
  }

  const итог = (text || "").trim() || готовый;
  if (!итог) throw new ValidationError("Пустой ответ отправить нельзя");

  обращение.messages.push({
    authorType: "admin",
    authorId: объектId(adminId),
    text: итог,
  });
  обращение.lastAdminAt = new Date();

  // Ответ означает, что обращение прочитали: оставлять его «новым» после
  // ответа — врать очереди.
  if (обращение.status === "new") обращение.status = "in_review";

  await обращение.save();
  await известитьАвтора(обращение, "reply").catch(() => {});

  return обращение.toObject();
}

/**
 * Сменить состояние.
 *
 * Реплику о смене пишет сервер — это и есть «ответить автоматически».
 * Отключается флагом: иногда администратор уже всё объяснил своими
 * словами, и казённая приписка следом только портит ответ.
 */
export async function сменитьСостояние({
  adminId,
  id,
  status,
  resolution = "",
  priority = null,
  autoReply = true,
}) {
  if (!СОСТОЯНИЯ.includes(status)) {
    throw new ValidationError("Неизвестное состояние обращения");
  }

  const обращение = await Feedback.findById(объектId(id));
  if (!обращение) throw new NotFoundError("Обращение не найдено");

  const закрываем = ЗАКРЫТЫЕ.includes(status);
  if (закрываем && !resolution.trim() && !обращение.resolution) {
    throw new ValidationError(
      "Закрыть обращение без итога нельзя: напишите, что решили и почему",
    );
  }

  обращение.status = status;
  if (priority) обращение.priority = priority;
  if (resolution.trim()) обращение.resolution = resolution.trim();

  if (закрываем) {
    обращение.handledBy = объектId(adminId);
    обращение.handledAt = new Date();
  }

  const авто = autoReply ? текстСостояния(status, обращение.locale) : null;
  if (авто) {
    const текст = закрываем && обращение.resolution
      ? `${авто}\n\n${обращение.resolution}`
      : авто;
    обращение.messages.push({ authorType: "system", text: текст });
    обращение.lastAdminAt = new Date();
  }

  await обращение.save();
  if (авто) await известитьАвтора(обращение, "status").catch(() => {});

  return обращение.toObject();
}

/**
 * Сказать автору, что ему ответили.
 *
 * Текст ответа в уведомление не попадает — только повод открыть карточку.
 * Сотруднику клиники уведомление не уходит: модель уведомлений адресует
 * их через User, а у сотрудника его нет. Он увидит ответ в кабинете.
 */
async function известитьАвтора(обращение, повод) {
  if (обращение.authorType !== "user") return;

  await notify({
    userId: обращение.authorId,
    type: "feedback_reply",
    title: повод === "status" ? "Обращение обновлено" : "Ответ на ваше обращение",
    message: обращение.subject.slice(0, 200),
    link: ссылкаНаОбращение(обращение._id),
    icon: "message-square",
    meta: { feedbackId: String(обращение._id), status: обращение.status },
  });
}

export default {
  создать,
  мои,
  одно,
  дописать,
  очередь,
  сводка,
  карточка,
  ответить,
  сменитьСостояние,
};
