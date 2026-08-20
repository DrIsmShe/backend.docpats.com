// server/modules/webinar/models/Webinar.model.js

/* ============================================================
   ВЕБИНАР — КОМНАТА, А НЕ ЗВОНОК
   ============================================================
   Третья, отдельная сущность рядом с двумя уже существующими,
   и заводится она не от любви к сущностям:

   - звонок (call.gateway) — эфемерный, собирается дозвоном,
     живёт в памяти процесса. Обзванивать полсотни человек
     по одному никто не станет;
   - групповой диалог — постоянная комната при переписке.
     Собирать чат на пятьдесят человек ради одной встречи
     значит завести полсотни ненужных подписок на сообщения.

   Вебинар — встреча, к которой приходят по ссылке. Ни дозвона,
   ни переписки: адрес, время, хозяин и правила входа.

   ЧТО ЭТО НЕ ЗАМЕНЯЕТ: разговор врача с пациентом и консилиум
   на трёх-пятерых остаются звонком. Там дозвон — это и есть
   смысл, а ссылка была бы лишним шагом.
   ============================================================ */

import mongoose from "mongoose";

const { Schema } = mongoose;

export const WEBINAR_ACCESS = [
  // Заходит любой, у кого есть ссылка (и аккаунт в системе).
  "link",
  // Заходят только перечисленные. Ссылка сама по себе не пускает.
  "invited",
];

export const WEBINAR_STATUS = ["scheduled", "live", "ended"];

const webinarSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },

    // Хозяин встречи. Он же модератор в комнате Jitsi: право пускать
    // из комнаты ожидания и выключать чужие микрофоны должно быть у
    // человека, а не у всех подряд.
    hostId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Соведущие — тоже модераторы. Нужны, когда встречу ведут вдвоём
    // и один не может весь час сидеть на кнопке допуска.
    coHostIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    accessMode: {
      type: String,
      enum: WEBINAR_ACCESS,
      default: "link",
      index: true,
    },

    // Для accessMode="invited". Список тех, кого пускают.
    invitedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Комната ожидания: участники ждут, пока ведущий впустит.
    // Само включение делает Jitsi, здесь — намерение хозяина.
    lobbyEnabled: { type: Boolean, default: false },

    scheduledAt: { type: Date, default: null, index: true },

    status: {
      type: String,
      enum: WEBINAR_STATUS,
      default: "scheduled",
      index: true,
    },

    // Верхняя граница на всякий случай. Настоящий предел задаёт
    // видеомост (MAX_PARTICIPANTS в конфиге Jitsi) — это лишь то,
    // что хозяин обещает себе сам.
    maxParticipants: { type: Number, default: 50, min: 2, max: 500 },
  },
  { timestamps: true },
);

// Список своих встреч — самый частый запрос.
webinarSchema.index({ hostId: 1, scheduledAt: -1 });

/**
 * Имя комнаты Jitsi. Оно же уезжает в JWT, поэтому строится в одном
 * месте: разойдутся имя в токене и имя в ссылке — участник упрётся в
 * отказ, и понять почему будет неоткуда.
 */
webinarSchema.methods.roomName = function roomName() {
  return `webinar-${this._id.toString()}`;
};

/** Может ли пользователь модерировать: хозяин и соведущие. */
webinarSchema.methods.isModerator = function isModerator(userId) {
  const id = String(userId);
  if (String(this.hostId) === id) return true;
  return (this.coHostIds || []).some((coHost) => String(coHost) === id);
};

/** Пускать ли пользователя внутрь. */
webinarSchema.methods.mayJoin = function mayJoin(userId) {
  if (this.status === "ended") return false;
  if (this.isModerator(userId)) return true;
  if (this.accessMode === "link") return true;
  const id = String(userId);
  return (this.invitedUserIds || []).some((invited) => String(invited) === id);
};

const Webinar =
  mongoose.models.Webinar || mongoose.model("Webinar", webinarSchema);

export default Webinar;
