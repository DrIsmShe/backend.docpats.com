// modules/admin/services/doctorVerification.service.js
//
// Допуск врача: срок, решения администратора и след в журнале.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СЛОЙ. Решение о допуске принимается в трёх местах —
// по одному документу, по врачу целиком и продлением срока, — и каждое
// из них обязано сделать одно и то же: пересчитать срок, записать
// событие в журнал HIPAA и сбросить ступень предупреждений. Разложенные
// по контроллерам, эти три шага разъезжаются на первой же правке: так
// уже вышло с verificationReviewedBy, который проставлялся в одном
// контроллере и не проставлялся в другом.
//
// ЧТО ТАКОЕ СРОК ДОПУСКА. Самая ранняя подтверждённая дата окончания
// среди одобренных обязательных документов — допуск держится на самом
// слабом звене. Лицензия до 2030-го при сертификате специалиста до
// 2027-го означает допуск до 2027-го.
//
// ПОЧЕМУ ДАТУ ПОДТВЕРЖДАЕТ АДМИНИСТРАТОР. Дату вписывает врач, глядя на
// свою бумагу. До сверки это его слово: без подтверждения врач продлевал
// бы себе допуск, вписав 2099 год. В срок идут только даты с
// expiryConfirmed.
//
// ПОЧЕМУ ЖУРНАЛ HIPAA, А НЕ ПОЛЕ В ПРОФИЛЕ. В профиле лежит ТЕКУЩЕЕ
// состояние, и следующее решение затирает предыдущее. Проверяющий
// спрашивает историю: когда допустили, на основании чего, когда срок
// вышел, кто продлил и почему. Журнал append-only — его нельзя ни
// изменить, ни удалить.

import DoctorVerificationDocument, {
  ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ,
  обязательныеСобраны,
  срокДопуска,
} from "../../../common/models/DoctorVerification/DocumentFiles.js";
import { recordAction } from "../../audit/services/audit.service.js";

/** Названия действий журнала — по одному на решение. */
export const СОБЫТИЯ = {
  ОДОБРИТЬ: "admin.doctor.verification.approve",
  ОТКЛОНИТЬ: "admin.doctor.verification.reject",
  ПРИОСТАНОВИТЬ: "admin.doctor.verification.suspend",
  ВОССТАНОВИТЬ: "admin.doctor.verification.restore",
  ПРОДЛИТЬ: "admin.doctor.verification.extend",
  ИСТЁК: "doctor.verification.expire",
  ДОКУМЕНТ_ОДОБРЕН: "admin.doctor.verification.document.approve",
  ДОКУМЕНТ_ОТКЛОНЁН: "admin.doctor.verification.document.reject",
  ПОДАНО: "doctor.verification.submit",
};

/**
 * Запись решения в журнал HIPAA.
 *
 * В metadata уходит ТОЛЬКО структура: виды документов, даты, статусы. Ни
 * номера лицензии, ни имени врача, ни ссылок на файлы — это правило
 * модуля аудита, и для допуска оно работает так же, как для медкарты.
 */
export async function записатьРешение({
  действие,
  администратор,
  профиль,
  ресурсId,
  сведения = {},
  контекст = {},
  session,
}) {
  return recordAction({
    actor: {
      userId: администратор?.userId || null,
      email: администратор?.email || null,
      role: администратор?.role || "system",
    },
    action: действие,
    resourceType: "doctor-verification",
    resourceId: ресурсId || профиль?._id,
    // Владелец ресурса — сам врач: по этому полю собирается «вся история
    // допуска врача X» одним запросом.
    resourceOwnerId: профиль?.userId || null,
    metadata: сведения,
    context: контекст,
    session,
  });
}

/** Сведения о запросе для журнала. */
export function контекстЗапроса(req) {
  return {
    ipAddress: req.ip || req.headers?.["x-forwarded-for"] || null,
    userAgent: req.headers?.["user-agent"] || null,
    sessionId: req.sessionID || null,
    httpMethod: req.method,
    httpPath: req.originalUrl,
  };
}

/**
 * Пересчитать срок допуска по документам врача.
 *
 * Зовётся после любого изменения документов. Возвращает новую дату (или
 * null — бессрочно) и сам её проставляет в профиль.
 *
 * ПОЧЕМУ СБРАСЫВАЕТСЯ СТУПЕНЬ ПРЕДУПРЕЖДЕНИЙ. Врач подал новую лицензию,
 * срок уехал на три года вперёд — а в профиле осталась отметка «уже
 * предупреждён за 7 дней». Без сброса следующее предупреждение ушло бы
 * только при повторном приближении к той же ступени, то есть через три
 * года минус семь дней, и то если ступень совпадёт.
 */
export async function пересчитатьСрок(профиль, session) {
  const документы = await DoctorVerificationDocument.find({
    doctorProfileId: профиль._id,
  })
    .select("documentType status isArchivedByDoctor expiresAt expiryConfirmed")
    .session(session || null)
    .lean();

  const срок = срокДопуска(документы);
  const прежний = профиль.verificationExpiresAt
    ? new Date(профиль.verificationExpiresAt).getTime()
    : null;
  const новый = срок ? срок.getTime() : null;

  профиль.verificationExpiresAt = срок;
  if (прежний !== новый) профиль.verificationExpiryNoticeStage = null;

  return { срок, документы, всёСобрано: обязательныеСобраны(документы) };
}

/**
 * Чего не хватает для допуска.
 * Возвращает список недостающих видов: ["specialization", "passport|id_card"].
 */
export function чегоНеХватает(документы = []) {
  const одобрено = new Set(
    документы
      .filter((д) => д.status === "approved" && !д.isArchivedByDoctor)
      .map((д) => д.documentType),
  );
  return ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ.filter(
    (варианты) => !варианты.some((в) => одобрено.has(в)),
  ).map((варианты) => варианты.join("|"));
}

export default {
  СОБЫТИЯ,
  записатьРешение,
  контекстЗапроса,
  пересчитатьСрок,
  чегоНеХватает,
};
