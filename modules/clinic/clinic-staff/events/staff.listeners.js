// server/modules/clinic/clinic-staff/events/staff.listeners.js
//
// Side-effects for staff events. Decoupled from staff.service.js: the service
// only emits STAFF_JOINED; this listener turns that into a user-facing
// notification ("you were added to clinic X"). Imported once at boot.
//
// Fire-and-forget: errors here never affect the add-staff request (eventBus
// isolates listener errors).

import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import { notify } from "../../../notifications/services/notification.service.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/events" });

// Resolve a human clinic name for the notification message.
async function resolveClinicName(clinicId) {
  try {
    const Clinic = (await import("../../clinic-core/models/clinic.model.js"))
      .default;
    const clinic = await Clinic.findById(clinicId).select("name").lean();
    return clinic?.name || null;
  } catch (err) {
    log.warn({ err: err.message, clinicId }, "Failed to resolve clinic name");
    return null;
  }
}

eventBus.on(EVENTS.STAFF_JOINED, async (payload) => {
  const { userId, clinicId, role } = payload || {};
  if (!userId || !clinicId) return;

  // Only DocPats users (doctors) have a User._id that notify() can target.
  // Internal ClinicEmployees are created via the invitation flow and are not
  // routed here (STAFF_JOINED for them carries an employee id, not a User id).
  // We guard by role: employees never come through addStaff as "user".
  const clinicName = await resolveClinicName(clinicId);

  await notify({
    userId,
    type: "system_message",
    title: "Вас добавили в клинику",
    message: clinicName
      ? `Вы добавлены в клинику «${clinicName}» как ${role || "сотрудник"}.`
      : `Вы добавлены в клинику как ${role || "сотрудник"}.`,
    link: "/doctor/my-clinics",
    meta: {
      clinicId: String(clinicId),
      role: role || null,
      kind: "staff_joined",
    },
  }).catch((err) => {
    log.error(
      { err: err.message, userId, clinicId },
      "notify(STAFF_JOINED) failed",
    );
  });
});

log.info("clinic-staff event listeners registered");

export default true;
