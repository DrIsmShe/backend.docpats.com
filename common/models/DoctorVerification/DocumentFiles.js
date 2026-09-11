import mongoose from "mongoose";

const doctorVerificationDocumentSchema = new mongoose.Schema(
  {
    /* userId объявлялся здесь дважды — второй раз ниже, с ref и
       индексом. Mongoose оставлял последнее объявление и ругался в лог;
       поведение не менялось, но схема читалась как ошибка. Оставлено
       одно, полное. */
    doctorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* Вид документа.
     *
     * Обязательных четыре — лицензия, диплом, подтверждение
     * специализации, удостоверение личности (passport либо id_card); их
     * список лежит в ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ ниже. Стаж, страховка и
     * проверка по спискам санкций — дело следующего захода; в схеме им
     * места пока нет намеренно, чтобы не заводить поля, которые никто не
     * заполняет.
     *
     * specialization добавлен к прежнему набору: certificate означал что
     * угодно — и сертификат специалиста, и свидетельство о курсах. Для
     * допуска важен первый, и отличать его надо по типу, а не по имени
     * файла. */
    documentType: {
      type: String,
      enum: [
        "license",
        "diploma",
        "specialization",
        "certificate",
        "passport",
        "id_card",
        "other",
      ],
      required: true,
      index: true,
    },

    /* ─────────── Что написано В САМОМ документе ───────────
     *
     * Всё это заполняет ВРАЧ, а подтверждает администратор: дата
     * окончания напечатана на бумаге, и достать её оттуда может только
     * тот, кто держит бумагу в руках. Автоматическое распознавание здесь
     * не годится — цена ошибки в дате допуска слишком высока, чтобы
     * доверять её OCR.
     *
     * ПОЧЕМУ НОМЕР НЕ ШИФРУЕТСЯ. Номер лицензии — профессиональный
     * идентификатор: он стоит на каждом выписанном рецепте и по нему
     * ищут в открытых реестрах. Так же хранится licenseNumber в профиле
     * врача.
     */
    documentNumber: { type: String, default: null, trim: true },

    /* Кто выдал: «Səhiyyə Nazirliyi», «Tabip Odası», медсовет штата.
       Свободный текст, а не справочник: у каждой страны свой орган, и
       справочник на все юрисдикции сразу — это работа, которая устареет
       раньше, чем закончится. */
    issuingAuthority: { type: String, default: null, trim: true },

    /* Юрисдикция документа: AZ, TR, US-CA. Лицензия действует в стране,
       которая её выдала, и врач с турецкой лицензией, работающий в
       Азербайджане, — это два разных вопроса, а не один. */
    jurisdictionCode: { type: String, default: null, trim: true, uppercase: true },

    issuedAt: { type: Date, default: null },

    /* Докогда действует. У диплома срока нет — и это нормальное
       состояние, а не пропуск: диплом не истекает. У лицензии и
       сертификата специалиста срок есть почти всегда. */
    expiresAt: { type: Date, default: null, index: true },

    /* Подтвердил ли администратор дату, сверив её с документом.
     *
     * Отдельный флаг, а не доверие полю expiresAt: дату вписывает врач, и
     * до сверки это его слово, а не факт. В срок допуска
     * (DoctorProfile.verificationExpiresAt) идут только подтверждённые
     * даты — иначе врач продлевал бы себе допуск, вписав 2099 год. */
    expiryConfirmed: { type: Boolean, default: false },

    fileUrl: { type: String, required: true },
    fileName: { type: String, default: null },
    fileMime: { type: String, default: null },
    fileSize: { type: Number, default: null },
    isArchivedByDoctor: {
      type: Boolean,
      default: false,
      index: true,
    },

    archivedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    reviewComment: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/* Что обязательно для допуска.
 *
 * Удостоверение личности принимается в двух видах — паспорт или
 * внутренняя карточка, — поэтому это не один тип, а выбор из двух:
 * требовать паспорт от врача в стране, где ходят с id-картой, значит
 * требовать документ, который ему незачем заводить.
 *
 * Стаж, отсутствие исков и проверка по спискам санкций сюда НЕ входят:
 * договорились, что это следующий заход. Первые три проверяются по
 * бумаге, которую врач может предъявить сегодня; последние три требуют
 * обращения к внешним реестрам, у каждого из которых свой доступ, своя
 * цена и своя страна.
 */
export const ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ = [
  ["license"],
  ["diploma"],
  ["specialization"],
  ["passport", "id_card"],
];

/** Собраны ли все обязательные виды среди одобренных документов. */
export function обязательныеСобраны(документы = []) {
  const одобрено = new Set(
    документы
      .filter((д) => д.status === "approved" && !д.isArchivedByDoctor)
      .map((д) => д.documentType),
  );
  return ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ.every((варианты) =>
    варианты.some((в) => одобрено.has(в)),
  );
}

/**
 * Докогда действует допуск по набору документов.
 *
 * Самая ранняя ПОДТВЕРЖДЁННАЯ дата окончания среди одобренных
 * обязательных документов: допуск держится на самом слабом звене.
 * Возвращает null, если ни у одного срока нет, — такой допуск бессрочный
 * (см. DoctorProfile.verificationExpiresAt).
 */
export function срокДопуска(документы = []) {
  const нужные = new Set(ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ.flat());
  const даты = документы
    .filter(
      (д) =>
        д.status === "approved" &&
        !д.isArchivedByDoctor &&
        нужные.has(д.documentType) &&
        д.expiryConfirmed &&
        д.expiresAt,
    )
    .map((д) => new Date(д.expiresAt).getTime());

  return даты.length ? new Date(Math.min(...даты)) : null;
}

doctorVerificationDocumentSchema.index({ doctorProfileId: 1, status: 1 });
doctorVerificationDocumentSchema.index({ userId: 1, createdAt: -1 });

const DoctorVerificationDocument =
  mongoose.models.DoctorVerificationDocument ||
  mongoose.model(
    "DoctorVerificationDocument",
    doctorVerificationDocumentSchema,
  );

export default DoctorVerificationDocument;
