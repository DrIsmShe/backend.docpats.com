// server/modules/procedures/services/procedure.service.js
//
// Правила записи на операцию и обследование, которые не должны жить в
// контроллере: разрешение контекста врача, занятость времени и переходы
// статусов.
//
// Ключевое отличие от записи на приём — ЗАНЯТОСТЬ СЧИТАЕТСЯ ПО ДВУМ
// КОЛЛЕКЦИЯМ. Врач не может одновременно оперировать и вести приём, поэтому
// новая операция обязана видеть приёмы, а календарь приёмов — операции.
// Проверка, смотрящая только в свою коллекцию, пропустила бы ровно тот
// конфликт, ради которого её писали.

import { DateTime } from "luxon";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProcedureBooking, {
  ACTIVE_PROCEDURE_STATUSES,
  MIN_DURATION_MIN,
  MAX_DURATION_MIN,
} from "../../../common/models/Procedure/procedureBooking.js";
import { DEFAULT_TZ } from "../../../common/services/daySlots.service.js";

// Статусы приёма, при которых время врача занято. Совпадает с тем, что
// считает активным сам модуль приёмов (bookByDoctorController).
const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed"];

// Допуск на запись «в прошлое» — тот же, что у приёмов: расхождение часов
// и вмешательство, которое уже началось, а оформляют его сейчас.
export const PAST_GRACE_MS = 5 * 60 * 1000;

/** Ошибка правил записи. Контроллер разворачивает её в ответ. */
export class ProcedureError extends Error {
  constructor(message, { status = 400, code = null, extra = {}, i18n = null } = {}) {
    super(message);
    this.name = "ProcedureError";
    this.status = status;
    this.code = code;
    this.extra = extra;
    // Код сообщения в словаре: текст выбирается по языку того, кто спросил.
    this.i18n = i18n;
  }
}

/**
 * Врач, от имени которого идёт запись. doctorId берётся из профиля, а не из
 * тела запроса: приняв его снаружи, мы позволили бы одному врачу занимать
 * время другого.
 */
export async function resolveDoctorContext(userId) {
  const profile = await ProfileDoctor.findOne({ userId }).lean();
  if (!profile) {
    throw new ProcedureError("Профиль врача не найден", { status: 404 });
  }
  const schedule = await DoctorSchedule.findOne({
    doctorId: profile._id,
  }).lean();
  return {
    doctorId: profile._id,
    doctorUserId: userId,
    zone: schedule?.timezone || DEFAULT_TZ,
  };
}

/**
 * Начало вмешательства. Сетка слотов здесь не при чём — врач называет время
 * сам, — но наивное «14:30» превратить в инстант может только сервер: зона
 * расписания известна ему, а браузер вполне может стоять в другом поясе.
 */
export function resolveStart({ startsAt, startsAtLocal, zone }) {
  const starts = startsAtLocal
    ? DateTime.fromISO(String(startsAtLocal), { zone }).toUTC().toJSDate()
    : new Date(startsAt);
  if (isNaN(+starts)) {
    throw new ProcedureError("Некорректное время начала");
  }
  return starts;
}

/** Конец по длительности в минутах. Границы держит и модель, но отказ с
 *  внятным текстом лучше, чем ValidationError из mongoose. */
export function resolveEnd({ starts, durationMin }) {
  const minutes = Number(durationMin);
  if (!Number.isFinite(minutes)) {
    throw new ProcedureError("Не указана длительность");
  }
  if (minutes < MIN_DURATION_MIN) {
    throw new ProcedureError(
      `Длительность не может быть меньше ${MIN_DURATION_MIN} минут`,
    );
  }
  if (minutes > MAX_DURATION_MIN) {
    throw new ProcedureError(
      `Длительность не может превышать ${MAX_DURATION_MIN} минут`,
    );
  }
  return new Date(starts.getTime() + minutes * 60000);
}

/** Запись в прошлое. Проверка именно на сервере: интерфейс обходится, а
 *  вмешательство вчерашним числом ломает напоминания и отчётность. */
export function assertNotInPast(starts) {
  if (starts.getTime() < Date.now() - PAST_GRACE_MS) {
    throw new ProcedureError("Нельзя записать на прошедшее время", {
      code: "PAST_TIME",
    });
  }
}

/**
 * Пересечения — по приёмам И по вмешательствам сразу.
 *
 * @param {object} args
 * @param {ObjectId} args.doctorId
 * @param {Date} args.starts
 * @param {Date} args.ends
 * @param {ObjectId} [args.excludeId] - не считать конфликтом саму себя (перенос)
 */
export async function assertFree({ doctorId, starts, ends, excludeId = null }) {
  const overlap = { $lt: ends };
  const overlapEnd = { $gt: starts };

  const [appointment, procedure] = await Promise.all([
    Appointment.findOne({
      doctorId,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      startsAt: overlap,
      endsAt: overlapEnd,
    })
      .select("_id startsAt endsAt")
      .lean(),
    ProcedureBooking.findOne({
      doctorId,
      status: { $in: ACTIVE_PROCEDURE_STATUSES },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      startsAt: overlap,
      endsAt: overlapEnd,
    })
      .select("_id startsAt endsAt kind title")
      .lean(),
  ]);

  if (appointment) {
    throw new ProcedureError("На это время у вас уже назначен приём", {
      status: 409,
      code: "SLOT_TAKEN_APPOINTMENT",
      extra: { conflictId: String(appointment._id) },
    });
  }
  if (procedure) {
    throw new ProcedureError(
      "На это время у вас уже назначено вмешательство",
      {
        status: 409,
        code: "SLOT_TAKEN_PROCEDURE",
        extra: { conflictId: String(procedure._id) },
      },
    );
  }
}

// ─── Переходы статусов ────────────────────────────────────────────────
//
// Закрытый граф вместо «поставь любой статус». Без него в базе заводятся
// записи, отменённые после того, как были завершены, и отчёт «сколько
// операций проведено» перестаёт быть ответом на вопрос.
const TRANSITIONS = Object.freeze({
  planned: ["confirmed", "postponed", "cancelled", "no_show", "completed"],
  confirmed: ["completed", "postponed", "cancelled", "no_show"],
  // Терминальные состояния. completed не отменяется: операция, которая
  // состоялась, состоялась — исправлять это надо не статусом.
  completed: [],
  postponed: [],
  cancelled: [],
  no_show: [],
});

export function assertTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ProcedureError(
      `Из статуса «${from}» нельзя перейти в «${to}»`,
      { status: 409, code: "BAD_TRANSITION" },
    );
  }
}

/** Отметки времени, которые ставит переход. Держим рядом с графом, чтобы
 *  новый статус нельзя было добавить, забыв его метку. */
export function stampForStatus(status, { cancelReason } = {}) {
  const now = new Date();
  switch (status) {
    case "confirmed":
      return { confirmedAt: now };
    case "completed":
      return { completedAt: now };
    case "postponed":
      return { postponedAt: now };
    case "cancelled":
      return {
        cancelledAt: now,
        cancelReason: cancelReason ? String(cancelReason).slice(0, 500) : null,
      };
    case "no_show":
      return { noShowAt: now };
    default:
      return {};
  }
}

/** Границы локальных суток в UTC — для выборки «день врача». */
export function dayBounds(dateStr, zone) {
  const day = DateTime.fromISO(String(dateStr), { zone });
  if (!day.isValid) {
    throw new ProcedureError("Некорректная дата");
  }
  return {
    from: day.startOf("day").toUTC().toJSDate(),
    to: day.endOf("day").toUTC().toJSDate(),
  };
}
