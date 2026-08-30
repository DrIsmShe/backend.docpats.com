// server/common/events/eventBus.js
//
// In-process event bus for loose coupling between modules.
//
// Publishers emit events; subscribers handle them asynchronously.
// Errors in subscribers DO NOT propagate to the publisher (fire-and-forget).
//
// Usage:
//
//   // 1. Subscribe (in module's event-listener file, imported once at boot):
//   import { eventBus, EVENTS } from "../../../common/events/eventBus.js";
//   eventBus.on(EVENTS.APPOINTMENT_COMPLETED, async (payload) => {
//     await createInvoiceFromAppointment(payload);
//   });
//
//   // 2. Publish (in service code):
//   eventBus.emitSafe(EVENTS.APPOINTMENT_COMPLETED, {
//     appointmentId, clinicId, doctorId, patientId, services
//   });
//
// When we scale to microservices, this gets replaced with Redis Pub/Sub.

import { EventEmitter } from "events";
import logger from "../logger.js";

const log = logger.child({ module: "eventBus" });

class TypedEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // в clinic-системе до 30+ listeners норма
  }

  /**
   * Safe emit: errors in any listener are caught and logged,
   * never propagate to the publisher.
   *
   * @param {string} eventName
   * @param {object} payload
   */
  emitSafe(eventName, payload = {}) {
    // Имя события обязано быть строкой.
    //
    // Опечатка или забытая константа давала EVENTS.X === undefined, и
    // дальше падал сам поиск слушателей — то есть публикация события
    // роняла операцию, которая его опубликовала. Ради этого emitSafe и
    // существует: рецепт сохранён, и сбой рассылки не должен превращаться
    // в ошибку у врача. Пишем в лог как ошибку — это дефект кода, но
    // наружу не выпускаем.
    if (typeof eventName !== "string" || !eventName) {
      log.error(
        { eventName, payload },
        "emitSafe вызван без имени события — проверьте константу в EVENTS",
      );
      return;
    }

    const listeners = this.listeners(eventName);
    if (listeners.length === 0) {
      log.debug({ event: eventName }, "Event emitted with no listeners");
      return;
    }

    log.debug(
      { event: eventName, listenerCount: listeners.length },
      "Event emitted",
    );

    listeners.forEach((listener) => {
      // Run each listener in its own microtask to isolate errors
      Promise.resolve()
        .then(() => listener(payload))
        .catch((err) => {
          log.error(
            { event: eventName, err, payload },
            `Event listener failed for ${eventName}`,
          );
        });
    });
  }

  /**
   * Synchronous emit — kept for compatibility but generally avoid it.
   * Use emitSafe instead.
   */
  emitSync(eventName, payload = {}) {
    return super.emit(eventName, payload);
  }
}

/**
 * Singleton instance.
 */
export const eventBus = new TypedEventBus();

/**
 * Canonical event names. Single source of truth.
 * When adding a new event — register here for type safety.
 *
 * Naming convention: <domain>.<past_tense_verb>
 * Examples: "appointment.created", "payment.received"
 *
 * Sprint 2 Phase 2B (27.05.2026): cleaned up duplicate APPOINTMENT_*
 * keys at the bottom of the original file (overrode same values),
 * added MEDICAL_ENCOUNTER_* for UMR workflow.
 */
export const EVENTS = Object.freeze({
  // Clinic core
  CLINIC_CREATED: "clinic.created",
  CLINIC_UPDATED: "clinic.updated",
  CLINIC_DELETED: "clinic.deleted",

  // Staff
  STAFF_INVITED: "staff.invited",
  STAFF_JOINED: "staff.joined",
  STAFF_LEFT: "staff.left",
  STAFF_ROLE_CHANGED: "staff.role_changed",
  STAFF_PERMISSIONS_UPDATED: "staff.permissions_updated",

  // Appointments
  APPOINTMENT_CREATED: "appointment.created",
  APPOINTMENT_CONFIRMED: "appointment.confirmed",
  APPOINTMENT_RESCHEDULED: "appointment.rescheduled",
  APPOINTMENT_CANCELLED: "appointment.cancelled",
  APPOINTMENT_CHECKED_IN: "appointment.checked_in",
  APPOINTMENT_STARTED: "appointment.started",
  APPOINTMENT_COMPLETED: "appointment.completed",
  APPOINTMENT_NO_SHOW: "appointment.no_show",
  APPOINTMENT_STATUS_CHANGED: "appointment.status_changed",

  // Patient flow
  PATIENT_CHECKED_IN: "patient.checked_in",
  PATIENT_CALLED: "patient.called",
  PATIENT_ENTERED_ROOM: "patient.entered_room",

  // Patient records (CRUD)
  PATIENT_CREATED: "patient.created",
  PATIENT_UPDATED: "patient.updated",
  PATIENT_LINKED: "patient.linked",
  PATIENT_DELETED: "patient.deleted",

  // ── UMR / Medical Encounters (Sprint 2 Phase 2) ───────────────
  // Encounter lifecycle for clinic-medical module.
  // patientId in payloads refers to ClinicPatient._id.
  MEDICAL_ENCOUNTER_CREATED: "medical.encounter.created",
  MEDICAL_ENCOUNTER_UPDATED: "medical.encounter.updated",
  MEDICAL_ENCOUNTER_SIGNED: "medical.encounter.signed",
  MEDICAL_ENCOUNTER_AMENDED: "medical.encounter.amended",
  MEDICAL_ENCOUNTER_DELETED: "medical.encounter.deleted",

  // Billing
  INVOICE_CREATED: "invoice.created",
  INVOICE_ISSUED: "invoice.issued",
  INVOICE_VOIDED: "invoice.voided",
  PAYMENT_RECEIVED: "payment.received",
  PAYMENT_REFUNDED: "payment.refunded",

  // Медкарта: рецепты и результаты анализов.
  //
  // Этих имён здесь не было, хотя сервисы их отправляли: EVENTS.X
  // возвращал undefined, и emitSafe падал на попытке найти слушателей
  // несуществующего события. Рецепт при этом успевал сохраниться, а врач
  // видел «Internal server error» и выписывал заново — в карте копились
  // дубли одного назначения.
  MEDICAL_PRESCRIPTION_CREATED: "medical.prescription.created",
  MEDICAL_PRESCRIPTION_CANCELLED: "medical.prescription.cancelled",
  MEDICAL_PRESCRIPTION_COMPLETED: "medical.prescription.completed",
  MEDICAL_PRESCRIPTION_DELETED: "medical.prescription.deleted",
  MEDICAL_LAB_RESULT_CREATED: "medical.lab_result.created",
  MEDICAL_LAB_RESULT_UPDATED: "medical.lab_result.updated",
  MEDICAL_LAB_RESULT_DELETED: "medical.lab_result.deleted",

  // Pharmacy
  PRESCRIPTION_ISSUED: "prescription.issued",
  PRESCRIPTION_DISPENSED: "prescription.dispensed",
  DRUG_LOW_STOCK: "drug.low_stock",
  DRUG_EXPIRING_SOON: "drug.expiring_soon",

  // Inventory
  INVENTORY_LOW: "inventory.low",
  INVENTORY_DEDUCTED: "inventory.deducted",

  // Marketing
  REVIEW_SUBMITTED: "review.submitted",
  REVIEW_MODERATED: "review.moderated",
  LEAD_CAPTURED: "lead.captured",
  LEAD_QUALIFIED: "lead.qualified",
  LEAD_CONVERTED: "lead.converted",

  // Reception
  RECEPTION_SESSION_STARTED: "reception.session_started",
  RECEPTION_SESSION_RESOLVED: "reception.session_resolved",

  // Referrals
  REFERRAL_CREATED: "referral.created",
  REFERRAL_ACCEPTED: "referral.accepted",
  REFERRAL_COMPLETED: "referral.completed",

  // Analytics & misc
  KPI_CALCULATED: "kpi.calculated",
});
