// server/modules/clinic/clinic-leads/services/leadNotify.service.js
//
// Fire-and-forget уведомление клиники о новой заявке (лиде) с витрины.
//
// Два независимых канала, каждый в своём try/catch — падение одного НЕ
// затрагивает другой и НЕ затрагивает публичный ответ гостю (createLead
// всегда возвращает 201, даже если оба канала упали).
//
//   • in-app  — notify() по membership c actorType:"user" и ролью owner|manager.
//               Модель Notification привязана к User._id, поэтому employee-login
//               менеджеров этим каналом НЕ покрывается (см. notification.service).
//               Для employee-получателей — отдельное расширение в бэклоге.
//   • email   — на общий контактный адрес клиники (clinic.contacts.email).
//               БЕЗ PHI: имя гостя + тип заявки; телефон только в панели.
//
// Единственная точка вызова — createLead в lead.service.js, обёрнута в .catch().

import mongoose from "mongoose";

import { ROLES } from "../../../../common/auth/permissions.js";
import { notifyMany } from "../../../notifications/services/notification.service.js";
import { sendEmail } from "../../../../common/services/emailService.js";
import Clinic from "../../clinic-core/models/clinic.model.js";
import ClinicMembership from "../../clinic-staff/models/clinicMembership.model.js";

// Роли, которым интересны заявки с сайта.
const TARGET_ROLES = [ROLES.OWNER, ROLES.MANAGER];

// Человекочитаемый тип заявки для письма/уведомления (без реквеста в i18n —
// это серверный текст оператору, не гостю; держим RU как в остальном бэке).
function leadTypeLabel(type) {
  if (type === "callback") return "Просьба перезвонить";
  return "Сообщение";
}

// ─── in-app: owner/manager, у которых есть User._id ───────────
async function sendInAppNotifications(clinicId, lead) {
  const memberships = await ClinicMembership.find({
    clinicId: new mongoose.Types.ObjectId(String(clinicId)),
    role: { $in: TARGET_ROLES },
    actorType: "user", // только те, кто адресуется Notification (User._id)
    isActive: true,
    leftAt: null,
  })
    .select("userId")
    .lean();

  const userIds = [
    ...new Set(
      memberships
        .map((m) => (m.userId ? String(m.userId) : null))
        .filter(Boolean),
    ),
  ];

  if (userIds.length === 0) return 0;

  await notifyMany(userIds, {
    type: "clinic_lead",
    title: "Новая заявка с сайта",
    message: `${lead.name} — ${leadTypeLabel(lead.type)}`,
    link: "/clinic/employee/leads",
    icon: "bell",
    priority: "normal",
    meta: { leadId: String(lead._id), clinicId: String(clinicId) },
  });

  return userIds.length;
}

// ─── email: на контактную почту клиники (без PHI) ─────────────
async function sendEmailNotification(clinic, lead) {
  const to = clinic?.contacts?.email;
  if (!to) return false;

  const clinicName = clinic?.name || "клиника";
  const subject = `Новая заявка с сайта — ${clinicName}`;

  // Телефон намеренно НЕ включаем в письмо (незашифрованный канал).
  // Оператор открывает панель, чтобы увидеть контактные данные.
  const message = [
    `Поступила новая заявка через сайт клиники «${clinicName}».`,
    ``,
    `Имя: ${lead.name}`,
    `Тип: ${leadTypeLabel(lead.type)}`,
    ``,
    `Телефон и детали доступны в панели управления клиникой,`,
    `в разделе «Заявки».`,
  ].join("\n");

  await sendEmail(to, subject, message);
  return true;
}

// ─── публичный вход ───────────────────────────────────────────
// Не бросает наружу: логирует и глотает ошибки каждого канала отдельно.
export async function notifyClinicManagersOfLead(clinicId, lead) {
  if (!clinicId || !lead) return;

  // Клиника нужна и для email (contacts.email/name); тянем один раз.
  let clinic = null;
  try {
    clinic = await Clinic.findById(clinicId).select("name contacts").lean();
  } catch (err) {
    console.error("[leadNotify] clinic lookup failed:", err?.message);
  }

  // in-app — изолированно
  try {
    const n = await sendInAppNotifications(clinicId, lead);
    if (n > 0) {
      console.log(`[leadNotify] in-app sent to ${n} user(s), lead ${lead._id}`);
    }
  } catch (err) {
    console.error("[leadNotify] in-app failed:", err?.message);
  }

  // email — изолированно
  try {
    if (clinic) {
      const sent = await sendEmailNotification(clinic, lead);
      if (sent) {
        console.log(`[leadNotify] email sent for lead ${lead._id}`);
      }
    }
  } catch (err) {
    console.error("[leadNotify] email failed:", err?.message);
  }
}

export default { notifyClinicManagersOfLead };
