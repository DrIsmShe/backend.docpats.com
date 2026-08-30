// server/modules/audit/services/patientAccessLog.service.js
// ─────────────────────────────────────────────────────────────────────
//   «Кто открывал мою карту» — журнал доступа ДЛЯ ПАЦИЕНТА.
//
//   Журнал пишется с самого начала: семь лет хранения, запрет на
//   изменение и удаление на уровне модели. Пациенту он не показывался
//   никак — и это странно, потому что право «покажите, кто видел мои
//   данные» и есть та причина, по которой HIPAA требует такой журнал.
//
//   ─── ЧТО ПАЦИЕНТ ВИДИТ И ЧЕГО НЕ ВИДИТ ────────────────────────────
//
//   ВИДИТ: когда, какая организация, какого рода данные, что сделали.
//
//   НЕ ВИДИТ имени и адреса конкретного сотрудника. Это не сокрытие, а
//   осознанный выбор: назвать медсестру по имени человеку, недовольному
//   тем, что его карту открывали, — значит создать конфликт между двумя
//   людьми, ни один из которых не решает, кому положен доступ. За доступ
//   отвечает организация, и в журнале для пациента отвечает она же.
//   Поимённый разбор остаётся администратору клиники — у него для этого
//   есть тот же журнал целиком.
//
//   НЕ ВИДИТ технических полей: IP, user-agent, идентификатор сессии.
//   Это данные о сотруднике, а не о пациенте, и в его журнале им не
//   место.
//
//   ─── СОБСТВЕННЫЕ ДЕЙСТВИЯ ПОМЕЧЕНЫ ────────────────────────────────
//
//   Пациент, открывший свою карту, увидел бы себя в списке «кто смотрел»
//   и решил, что за ним следят. Свои действия помечаются отдельно и
//   по умолчанию не показываются.
// ─────────────────────────────────────────────────────────────────────

import HIPAAAuditLog from "../models/AuditLog.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";

/**
 * Человеческое название раздела карты.
 *
 * Неизвестный тип показываем как «медицинские данные», а не прячем:
 * строка «кто-то обратился к вашим данным» честнее пропуска, даже когда
 * мы не умеем назвать раздел.
 */
const SECTION = {
  "clinic-patient": "карточка пациента",
  "clinic-appointment": "запись на приём",
  "clinic-medical-encounter": "история болезни",
  "clinic-medical-allergy": "аллергии",
  "clinic-medical-chronic-disease": "хронические заболевания",
  "clinic-medical-operation": "перенесённые операции",
  "clinic-medical-family-history": "семейный анамнез",
  "clinic-medical-immunization": "прививки",
  "clinic-medical-imaging-study": "снимки",
  "clinic-medical-prescription": "назначения",
  "clinic-medical-lab-result": "анализы",
  "clinic-medical-summary": "вся карта (сводка)",
  "clinic-medical-fhir-export": "выгрузка всей карты в файл",
  "clinic-medical-card-print": "печать всей карты",
  "patient-consent": "согласие на доступ",
  consultation: "консультация",
  "ai-consultation": "AI-консультация",
  "chat-message": "переписка",
  "video-room": "видеоприём",
};

/**
 * Что именно сделали. Действий в перечне много, и все они пишутся
 * глаголами вида "clinic.medical.allergy.read" — пациенту нужен не
 * идентификатор, а глагол.
 */
function verbOf(action = "") {
  const tail = String(action).split(".").pop();
  if (["read", "list", "view", "export"].includes(tail)) return "просмотр";
  if (["create", "add"].includes(tail)) return "запись добавлена";
  if (["update", "edit", "amend", "sign"].includes(tail)) return "запись изменена";
  if (["delete", "remove"].includes(tail)) return "запись удалена";
  return "обращение";
}

/**
 * Журнал доступа к данным пациента.
 *
 * @param {object} args
 * @param {string} args.userId — пациент (он же resourceOwnerId в журнале)
 * @param {number} [args.limit]
 * @param {boolean} [args.includeOwn] — показывать собственные действия
 */
export async function getPatientAccessLog({
  userId,
  limit = 100,
  includeOwn = false,
}) {
  const filter = { resourceOwnerId: userId };

  // Свои действия по умолчанию убираем: увидев себя в списке «кто
  // смотрел», человек решит, что за ним следят.
  if (!includeOwn) filter.userId = { $ne: userId };

  const rows = await HIPAAAuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 300))
    .select(
      "createdAt action resourceType outcome actorRole clinicId userId metadata",
    )
    .lean();

  // Названия клиник — одним запросом, а не по строке: журнал за год у
  // активного пациента это сотни записей из двух-трёх клиник.
  const clinicIds = [
    ...new Set(rows.map((r) => r.clinicId).filter(Boolean).map(String)),
  ];
  const clinics = clinicIds.length
    ? await Clinic.find({ _id: { $in: clinicIds } })
        .select("name")
        .setOptions({ skipTenantScope: true })
        .lean()
    : [];
  const clinicName = new Map(clinics.map((c) => [String(c._id), c.name]));

  return rows.map((r) => ({
    at: r.createdAt,
    // Организация, а не человек. Причина — в шапке файла.
    organization: r.clinicId
      ? clinicName.get(String(r.clinicId)) || "клиника"
      : "платформа DocPats",
    // Роль показываем: «врач» и «регистратура» — разные вещи для того,
    // кто читает свой журнал, и это не указывает на конкретного человека.
    role: r.actorRole || null,
    section: SECTION[r.resourceType] || "медицинские данные",
    what: verbOf(r.action),
    // Отказанные попытки показываем тоже: «вашу карту пытались открыть
    // и не смогли» — это ровно то, ради чего журнал и заводят.
    denied: r.outcome === "denied" || r.outcome === "failure",
    isOwn: String(r.userId) === String(userId),
  }));
}

export default { getPatientAccessLog };
