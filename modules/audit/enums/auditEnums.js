// modules/audit/enums/auditEnums.js
//
// Перечисления для HIPAA Audit Log.
//
// При добавлении новых типов ресурсов или действий — добавляй сюда.
// Mongoose enum валидация не пропустит значения, которых здесь нет.

/* ============================================================
   ACTIONS — что было сделано
   ============================================================
   Формат: <resource>.<verb> или общий <verb>.

   Конкретные actions полезны для аналитики ("сколько раз
   доктор смотрел снимки на этой неделе"). Если конкретики
   не нужно — используй общие read/list/create/update/delete.
   ============================================================ */

export const ACTION_ENUM = [
  // ═══════════ ОБЩИЕ ДЕЙСТВИЯ ═══════════
  // Используются когда специфика не нужна
  "read", // Просмотр одного объекта
  "list", // Просмотр списка
  "create",
  "update",
  "delete",
  "export", // Скачивание / экспорт
  "share", // Расшаривание данных другому пользователю

  // ═══════════ AUTH (отдельно от старого AuditLog в common/) ═══════════
  "auth.login",
  "auth.logout",
  "auth.failed_login",
  "auth.password_change",
  "auth.password_reset_request",
  "auth.account_locked",

  // ═══════════ CHAT (Communication module) ═══════════
  "chat.dialog.read",
  "chat.dialog.list",
  "chat.message.create",
  "chat.message.read",
  "chat.message.delete",
  "chat.message.upload",
  "chat.message.export",

  // ═══════════ ANTHROPOMETRY ═══════════
  // Сохраняем те же что в anthropometry-модуле — для совместимости
  // если когда-то решишь объединить системы.
  "case.create",
  "case.view",
  "case.update",
  "case.archive",
  "case.unarchive",
  "case.delete",
  "case.consent_given",
  "case.consent_revoked",
  "case.export",

  "study.create",
  "study.view",
  "study.update",
  "study.delete",
  "study.calibrate",
  "study.recalibrate",
  "study.export",

  "photo.upload",
  "photo.view",
  "photo.download",
  "photo.delete",

  "annotation.create",
  "annotation.view",
  "annotation.update",
  "annotation.create_version",
  "annotation.lock",
  "annotation.unlock",
  "annotation.delete",
  "annotation.set_current",

  // ═══════════ SURGERY ═══════════
  "surgery.case.create",
  "surgery.case.read",
  "surgery.case.update",
  "surgery.case.delete",
  "surgery.case.export",

  // ═══════════ SIMULATION ═══════════
  "simulation.plan.create",
  "simulation.plan.read",
  "simulation.plan.update",
  "simulation.plan.delete",
  "simulation.plan.export",

  // ═══════════ CONSULTATION ═══════════
  "consultation.create",
  "consultation.read",
  "consultation.update",
  "consultation.delete",

  // ═══════════ PROFILES ═══════════
  "doctor.profile.read",
  "doctor.profile.update",
  "patient.profile.read",
  "patient.profile.update",

  // ═══════════ CLINIC PATIENTS (ClinicPatient — карта пациента в клинике) ═══════════
  // Отличается от patient.profile.* (которые про User-аккаунт пациента
  // на DocPats). ClinicPatient — внутренняя клиническая запись с PHI,
  // привязанная к конкретной клинике (tenant). Регистратор/админ/owner
  // создают карту → доктор читает на приёме → потом обновляет.
  "clinic.patient.create",
  "clinic.patient.read",
  "clinic.patient.list",
  "clinic.patient.search",
  "clinic.patient.update",
  "clinic.patient.delete",
  "clinic.patient.link", // связка с DocPats user-аккаунтом
  "clinic.patient.unlink",
  "clinic.patient.user_search", // поиск User-аккаунта для линковки
  "clinic.patient.export",

  // ═══════════ CLINIC STAFF / MEMBERSHIPS ═══════════
  // На будущее: когда будем аудитить операции с сотрудниками клиники
  // (добавление врача, смена роли, удаление). Сейчас не используется.
  "clinic.staff.invite",
  "clinic.staff.add",
  "clinic.staff.role_change",
  "clinic.staff.remove",
  "clinic.staff.list",
  "clinic.staff.read",

  // ═══════════ CLINIC SETTINGS ═══════════
  // На будущее: изменения настроек клиники (название, часовой пояс,
  // валюта, языки, тариф) и сама регистрация клиники.
  "clinic.create",
  "clinic.read",
  "clinic.update",
  "clinic.delete",

  // ═══════════ CLINIC DOCTOR SCHEDULES (Appointments module, Sprint 1) ═══════════
  // Недельное расписание врача ВНУТРИ клиники. Отдельно от legacy
  // doctorSchedule-модуля (тот про публичную запись к частным врачам).
  // Часы работы — не PHI, но кто/когда менял доступность врача —
  // security-relevant (подмена расписания, форензика). Аудитим все.
  "clinic.schedule.list", // список всех расписаний клиники (admin overview)
  "clinic.schedule.view", // расписание одного врача
  "clinic.schedule.upsert", // создание/замена недельного паттерна
  // Schedule exceptions — разовые отклонения от недельного паттерна на
  // конкретную дату (выходной/отпуск/нестандартные часы).
  "clinic.schedule.exception.create", // одно исключение на одну дату
  "clinic.schedule.exception.bulk_day_off", // диапазон дат как выходные (отпуск)
  "clinic.schedule.exception.list", // список исключений врача за период
  "clinic.schedule.exception.delete", // удаление одного исключения
  // Slot lookup — вычисленные свободные слоты (недельный паттерн + исключения).
  "clinic.schedule.slots.view", // запрос свободных слотов врача за период

  // ═══════════ CLINIC APPOINTMENTS (Appointments module, Sprint 1) ═══════════
  // Приёмы внутри клиники. Отдельно от legacy appointment.* (старый
  // per-doctor модуль записи). Причина визита (reason) — PHI, шифруется;
  // в audit meta пишем только структуру, не значения. Регистратор создаёт
  // приём → пациент приходит (checkin) → доктор закрывает (complete).
  "clinic.appointment.list", // список приёмов (по врачу/дате/статусу)
  "clinic.appointment.view", // один приём
  "clinic.appointment.slots", // запрос свободных слотов врача
  "clinic.appointment.create", // бронирование приёма
  "clinic.appointment.reschedule", // перенос на другое время
  "clinic.appointment.cancel", // отмена
  "clinic.appointment.checkin", // пациент пришёл (scheduled → checked_in)
  "clinic.appointment.complete", // приём завершён
  "clinic.appointment.noshow", // пациент не явился

  // ═══════════ APPOINTMENTS (legacy per-doctor module) ═══════════
  "appointment.create",
  "appointment.read",
  "appointment.update",
  "appointment.cancel",

  // ═══════════ AI ═══════════
  "ai.consultation.create",
  "ai.consultation.read",

  // ═══════════ ADMIN ═══════════
  "admin.user.view",
  "admin.user.update",
  "admin.user.delete",
  "admin.audit.view",

  // Заглушка для случаев когда нужно записать что-то нестандартное.
  // Используй редко — лучше добавь конкретный enum выше.
  "other",
];

/* ============================================================
   RESOURCE TYPES — на чём произошло действие
   ============================================================ */

export const RESOURCE_TYPE_ENUM = [
  // Communication
  "chat-message",
  "chat-dialog",

  // Anthropometry (совместимость с существующими ресурсами)
  "PatientCase",
  "Study",
  "Photo",
  "Annotation",

  // Также normalized lower-case варианты
  "anthropometry-case",
  "anthropometry-study",
  "anthropometry-photo",
  "anthropometry-annotation",

  // Other modules
  "surgical-case",
  "simulation-plan",
  "consultation",
  "ai-consultation",
  "appointment",

  // Clinic module (Sprint 0+)
  // clinic-patient: ClinicPatient карта пациента (PHI, tenant-scoped)
  // clinic-employee: ClinicEmployee — внутренний сотрудник клиники
  // clinic: сама клиника (tenant) — для аудита смены настроек
  "clinic-patient",
  "clinic-employee",
  "clinic",

  // Clinic appointments module (Sprint 1)
  // clinic-doctor-schedule: ClinicDoctorSchedule — недельное расписание
  //   врача внутри клиники (tenant-scoped, не PHI)
  // clinic-appointment: ClinicAppointment — приём в клинике (reason — PHI,
  //   шифруется; tenant-scoped)
  "clinic-doctor-schedule",
  "clinic-appointment",

  // Profiles
  "doctor-profile",
  "patient-profile",
  "user-account",

  // Catch-all
  "other",
];

/* ============================================================
   OUTCOMES — результат действия
   ============================================================
   - success : действие выполнено
   - failure : техническая ошибка (БД упала, network error)
   - denied  : отказ доступа (нет прав, заблокирован)

   Различение failure/denied важно для security monitoring:
   множество denied от одного юзера — потенциальная атака.
   ============================================================ */

export const OUTCOME_ENUM = ["success", "failure", "denied"];

export default {
  ACTION_ENUM,
  RESOURCE_TYPE_ENUM,
  OUTCOME_ENUM,
};
