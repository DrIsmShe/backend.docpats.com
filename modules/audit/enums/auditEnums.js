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

  // ═══════════ EXAMINATIONS (medical scans: CT, MRI, EKG, etc.) ═══════════
  // Generic actions for all examination types. Specific scan type
  // (CTScan, MRI, EKG, etc.) goes into metadata.studyType.
  // Sprint Cleanup Phase 4 — replaces legacy AuditLog.createLog with
  // "CREATE_X_SCAN" string actions used across 16 myClinic controllers.
  "examination.create",
  "examination.read",
  "examination.list",
  "examination.update",
  "examination.delete",
  "examination.export",

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
  "clinic.patient.provisional_user_created", // создание provisional User одновременно с ClinicPatient
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
  // Appointments — конкретные приёмы врач-пациент (Sprint 1, day 4).
  // status_change покрывает любой переход FSM (scheduled→checked_in/cancelled/no_show,
  // checked_in→completed/cancelled/no_show). Для отмен metaFrom фиксирует hasCancelReason,
  // но не само значение (это может содержать комментарий оператора).
  "clinic.appointment.create", // создание приёма
  "clinic.appointment.view", // чтение одного приёма
  "clinic.appointment.list", // список приёмов (по врачу/по пациенту)
  "clinic.appointment.reschedule", // перенос времени активного приёма
  "clinic.appointment.update_reason", // правка reason/notes (любой статус)
  "clinic.appointment.status_change", // смена статуса по FSM
  "clinic.appointment.slots_free.view", // свободные слоты с учётом занятых

  // ═══════════ CLINIC APPOINTMENTS (Appointments module, Sprint 1) ═══════════
  // ═══════════ APPOINTMENTS (legacy per-doctor module) ═══════════
  "appointment.create",
  "appointment.read",
  "appointment.update",
  "appointment.cancel",

  // ═══════════ CLINIC MEDICAL — UMR (Sprint 2 Phase 1) ═══════════
  // Unified Medical Records внутри clinic-domain.
  // Аудит ВСЕХ операций с медицинскими данными внутри клиники.
  // Покрывает: encounter (история болезни) + 6 patient-attribute моделей.
  //
  // Resource type: clinic-medical-{encounter|allergy|chronic-disease|operation|family-history|immunization|imaging-study}
  //
  // Important: cross-clinic чтения (когда клиника B читает запись созданную
  // клиникой A через consent или sharedWith) — пишутся с metadata.isCrossClinic=true.

  // Encounter (newPatientMedicalHistory)
  "clinic.medical.encounter.create",
  "clinic.medical.encounter.read",
  "clinic.medical.encounter.list",
  "clinic.medical.encounter.update",
  "clinic.medical.encounter.sign", // переход status → "signed"
  "clinic.medical.encounter.amend", // переход status → "amended"
  "clinic.medical.encounter.delete",
  "clinic.medical.encounter.export",

  // Allergies (allergiesPatient)
  "clinic.medical.allergy.create",
  "clinic.medical.allergy.read",
  "clinic.medical.allergy.list",
  "clinic.medical.allergy.update",
  "clinic.medical.allergy.delete",

  // Chronic diseases (chronicDiseasesPatient)
  "clinic.medical.chronic_disease.create",
  "clinic.medical.chronic_disease.read",
  "clinic.medical.chronic_disease.list",
  "clinic.medical.chronic_disease.update",
  "clinic.medical.chronic_disease.delete",

  // Operations history (operationsPatient — перенесённые операции)
  "clinic.medical.operation.create",
  "clinic.medical.operation.read",
  "clinic.medical.operation.list",
  "clinic.medical.operation.update",
  "clinic.medical.operation.delete",

  // Family history of disease
  "clinic.medical.family_history.create",
  "clinic.medical.family_history.read",
  "clinic.medical.family_history.list",
  "clinic.medical.family_history.update",
  "clinic.medical.family_history.delete",

  // Immunization
  "clinic.medical.immunization.create",
  "clinic.medical.immunization.read",
  "clinic.medical.immunization.list",
  "clinic.medical.immunization.update",
  "clinic.medical.immunization.delete",

  // Imaging studies (ImagingStudy — CT/MRI/USG/etc unified)
  "clinic.medical.imaging.create",
  "clinic.medical.imaging.read",
  "clinic.medical.imaging.list",
  "clinic.medical.imaging.update",
  "clinic.medical.imaging.delete",
  "clinic.medical.imaging.export",

  // Prescriptions (Prescription — Rx blanks with items[]) — Stage 2 #4
  "clinic.medical.prescription.create",
  "clinic.medical.prescription.read",
  "clinic.medical.prescription.list",
  "clinic.medical.prescription.cancel",
  "clinic.medical.prescription.complete",
  "clinic.medical.prescription.delete",
  "clinic.medical.prescription.export",

  // ═══════════ PATIENT CONSENT (UMR Sprint 2 Phase 1) ═══════════
  // Глобальное согласие пациента на доступ конкретной клиники к его
  // медицинским данным. Отдельно от case.consent_* (anthropometry).
  // resourceType: "patient-consent", resourceId: PatientConsent._id.
  //
  // grant   — пациент дал клинике consent (новая запись)
  // revoke  — пациент отозвал consent (revokedAt set)
  // update  — изменены scopes у активного consent
  // check   — клиника запросила проверку (security-relevant: кто/когда сверялся)
  "patient.consent.grant",
  "patient.consent.revoke",
  "patient.consent.update_scopes",
  "patient.consent.check",
  "patient.consent.list",
  "patient.consent.expire", // авто-истечение по expiresAt (cron)

  // ═══════════ AI ═══════════
  "ai.consultation.create",
  "ai.consultation.read",

  // ═══════════ USER PROVISIONAL ACCOUNTS ═══════════
  // Provisional User lifecycle: created by clinic → patient requests
  // activation → confirms via OTP → fully activated.
  // resourceType: "user-account", resourceId: User._id.
  "user.provisional.created", // clinic created tmp credentials
  "user.provisional.activation_requested", // patient typed new email+password, OTP sent
  "user.provisional.activation_otp_failed", // wrong/expired OTP — security signal
  "user.provisional.activated", // OTP verified, account fully activated
  "user.provisional.wiped", // another clinic wiped before activation
  "user.provisional.expired", // cron anonymized after 3-year TTL

  // ═══════════ ADMIN ═══════════
  "admin.user.view",
  "admin.user.update",
  "admin.user.delete",
  "admin.audit.view",

  // Заглушка для случаев когда нужно записать что-то нестандартное.
  // Используй редко — лучше добавь конкретный enum выше.
  "other",
  "system.r2_orphan.cleanup",
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

  // Medical examinations (CT, MRI, EKG, etc.) — concrete scan type
  // lives in metadata.studyType. Sprint Cleanup Phase 4.
  "examination",

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

  // Clinic medical / UMR (Sprint 2 Phase 1)
  // Все ресурсы единой медицинской истории. Аудитим каждый тип отдельно
  // чтобы можно было делать выборки "все аллергии созданные клиникой X"
  // или "кто читал имаджинг пациента Y".
  "clinic-medical-encounter", // newPatientMedicalHistory (история болезни / визит)
  "clinic-medical-allergy", // allergiesPatient
  "clinic-medical-chronic-disease", // chronicDiseasesPatient
  "clinic-medical-operation", // operationsPatient (перенесённые операции)
  "clinic-medical-family-history", // familyHistoryOfDiseasePatient
  "clinic-medical-immunization", // immunizationPatient
  "clinic-medical-imaging-study", // ImagingStudy
  "clinic-medical-prescription", // Prescription (Rx blanks) — Stage 2 #4

  // Patient consent (UMR Sprint 2 Phase 1)
  // Глобальное согласие пациент↔клиника. resourceId = PatientConsent._id.
  // resourceOwnerId = User._id пациента (для запроса "все consent'ы пациента").
  "patient-consent",

  // Profiles
  "doctor-profile",
  "patient-profile",
  "user-account",
  "orphan-r2-file",
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
