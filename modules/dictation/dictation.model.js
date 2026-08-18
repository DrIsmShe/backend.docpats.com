// server/modules/dictation/dictation.model.js
//
// DictationJob — одна надиктовка врача на пути «голос → черновик осмотра».
//
// ЧТО ЭТО НЕ ЕСТЬ. Это не запись приёма и не разговор с пациентом. Врач
// диктует САМ, после приёма, своим голосом — то есть в аудио нет голоса
// пациента. Это принципиально: запись пациента — биометрия, отдельное
// согласие и отдельный класс риска; врачебная надиктовка о своём пациенте —
// обычная медицинская практика, которой десятки лет.
//
// ПОЧЕМУ ОТДЕЛЬНАЯ КОЛЛЕКЦИЯ, А НЕ ПОЛЕ В ИСТОРИИ БОЛЕЗНИ. У задания своя
// жизнь: оно проходит через распознавание и сборку структуры, может упасть и
// быть повторено, и живёт максимум неделю. История болезни живёт годами.
// Смешать их значило бы хранить мусор обработки в медицинской карте.
//
// ГРАНИЦА ОТВЕТСТВЕННОСТИ. Задание НИКОГДА не пишет в карту само. Оно
// доводит дело до черновика, дальше врач правит и сохраняет через обычный
// путь модуля. Модель здесь — инструмент ввода, как клавиатура.

import mongoose from "mongoose";
import { encryptPHI, decryptPHI } from "../../common/utils/phiCrypto.js";

const { Schema } = mongoose;

// Статусы обработки. failed — кончились попытки; expired — задание протухло,
// не дождавшись врача. Оба терминальные.
export const DICTATION_STATUSES = [
  "uploaded",
  "transcribing",
  "transcribed",
  "structuring",
  "drafted",
  "attached",
  "failed",
  "expired",
];

// Сколько раз пробуем прогнать задание через внешние сервисы, прежде чем
// признать провал. Три — чтобы пережить сетевую икоту, но не молотить в
// стену: каждая попытка стоит денег.
export const MAX_ATTEMPTS = 3;

// Сколько живёт неразобранное задание. Неделя — компромисс: врач успевает
// вернуться после выходных, а незакрытое аудио не копится месяцами.
export const EXPIRE_AFTER_DAYS = 7;

const dictationJobSchema = new Schema(
  {
    // ─── Кто и о ком ───
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Пациент в терминах модуля myClinic: тип + ссылка. Те же три поля, что
    // требует история болезни, — чтобы приёмник не гадал, куда писать.
    patientType: {
      type: String,
      enum: ["registered", "private"],
      required: true,
    },
    patientRef: { type: Schema.Types.ObjectId, required: true, index: true },
    patientTypeModel: {
      type: String,
      enum: ["DoctorPrivatePatient", "NewPatientPolyclinic", "ClinicPatient"],
      required: true,
    },

    // Куда приземлится результат. Приёмник выбирается по этому ключу
    // (sinks/index.js) — движок не знает про модули-получатели.
    sink: { type: String, default: "myClinic", index: true },

    // ─── Куда именно, если приёмник clinic ───────────────────────
    //
    // Клиника фиксируется в МОМЕНТ загрузки аудио, а не берётся при
    // сборке черновика: приёмник работает в воркере, вне запроса, где
    // контекст аренды пуст. Взять клинику «из текущего контекста» там
    // означало бы взять null и создать запись, невидимую для клиники,
    // но существующую в базе.
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },
    // Кто автор: User платформы или внутренний сотрудник клиники. У
    // записи в карте это ДВА разных поля, и модель требует ровно одно
    // из них — перепутать значит сослаться на несуществующего
    // пользователя.
    actorType: {
      type: String,
      enum: ["user", "employee"],
      default: "user",
    },

    // ─── Аудио ───
    // Ссылка на файл в хранилище. Обнуляется после прикрепления к карте:
    // голос — самое тяжёлое, что здесь лежит, и после подписи он бесполезен.
    audioUrl: { type: String, default: null },
    audioDeletedAt: { type: Date, default: null },
    durationSec: { type: Number, default: 0 },
    // Язык, на котором говорил врач. Пустая строка — автоопределение.
    lang: { type: String, trim: true, maxlength: 10, default: "" },

    // ─── Результаты обработки (PHI) ───
    // Расшифровка хранится, аудио — нет. Текст весит килобайты и однажды
    // ответит на вопрос «откуда в карте эта фраза»; аудио весит мегабайты,
    // содержит голос и после подписи не нужно.
    transcript: {
      type: String,
      trim: true,
      default: "",
      set: encryptPHI,
      get: decryptPHI,
    },
    // Собранный черновик как JSON-строка. Шифруется целиком: внутри те же
    // жалобы и анамнез, что в карте.
    draftJson: {
      type: String,
      default: "",
      set: encryptPHI,
      get: decryptPHI,
    },

    status: {
      type: String,
      enum: DICTATION_STATUSES,
      default: "uploaded",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, trim: true, maxlength: 2000, default: null },

    // Модели, которые реально отработали. При срабатывании запасной модели
    // это не та, которую просили, — а разбирать неудачный черновик без этого
    // знания невозможно.
    sttModel: { type: String, trim: true, maxlength: 120, default: "" },
    structureModel: { type: String, trim: true, maxlength: 120, default: "" },

    // ─── Итог ───
    // Черновик истории болезни, созданный из этого задания.
    medicalHistoryId: {
      type: Schema.Types.ObjectId,
      ref: "newPatientMedicalHistory",
      default: null,
    },
    attachedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "dictation_jobs",
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

// Воркер выбирает задания по статусу и числу попыток — индекс под этот запрос.
dictationJobSchema.index({ status: 1, attempts: 1, createdAt: 1 });
// Список заданий врача в интерфейсе — новые сверху.
dictationJobSchema.index({ doctorId: 1, createdAt: -1 });

const DictationJob =
  mongoose.models.DictationJob ||
  mongoose.model("DictationJob", dictationJobSchema, "dictation_jobs");

export default DictationJob;
