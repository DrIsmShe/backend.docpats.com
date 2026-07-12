// server/modules/clinic/clinic-pharmacy/models/drugItem.model.js
//
// DrugItem = one entry in a clinic's drug formulary (номенклатура) — the
// "what" of a medication, NOT its stock. It answers "which drugs does this
// clinic carry?" Physical quantity lives in DrugBatch (separate model), and
// dispensing is recorded in DispenseLog. Keeping the definition separate from
// stock is deliberate: one DrugItem has many batches with different expiry.
//
// Design notes (mirrors lead.model.js / clinicService.model.js):
//   1. Tenant-scoped: clinicId is REQUIRED; the service ALWAYS filters by it.
//      No plugin — same manual approach as the other clinic-* modules.
//   2. NON-PHI: a drug's name/INN/strength is reference data, not patient
//      medical data, so nothing is encrypted. (A DISPENSE tied to a patient is
//      PHI-adjacent and gets audited — that's DispenseLog's job, not here.)
//   3. Soft archive: instead of hard-delete we flip status active -> archived,
//      so historical batches/dispenses keep a valid reference. Same status
//      pattern ClinicService uses.
//   4. Units: baseUnit is the smallest countable unit that gets DISPENSED
//      (tablet, ampoule, ml). packUnit is how it's PURCHASED / REQUISITIONED
//      (pack, box, vial). unitsPerPack converts between them. Stock math and
//      FEFO dispensing (later) depend on these — a requisition in "packs" must
//      resolve to baseUnit before a batch is decremented.
//   5. isControlled marks наркотические / психотропные / сильнодействующие —
//      these require предметно-количественный учёт: stricter audit + a
//      separate report. The flag lives here; the enforcement lives in service.

import mongoose from "mongoose";

// Dosage form — how the drug is physically presented.
const DRUG_FORMS = [
  "tablet", // таблетка
  "capsule", // капсула
  "syrup", // сироп
  "solution", // раствор
  "injection", // инъекция / р-р для инъекций
  "ointment", // мазь / крем / гель
  "drops", // капли
  "spray", // спрей / аэрозоль
  "suppository", // свеча
  "powder", // порошок
  "patch", // пластырь
  "other",
];

// Smallest unit that is COUNTED and DISPENSED.
const BASE_UNITS = [
  "tablet", // таблетка
  "capsule", // капсула
  "ampoule", // ампула
  "vial_dose", // флакон/доза
  "ml", // миллилитр
  "g", // грамм
  "drop", // капля
  "piece", // штука (свеча, пластырь)
  "dose", // доза (спрей)
];

// Unit the drug is PURCHASED / REQUISITIONED in.
const PACK_UNITS = [
  "pack", // упаковка
  "box", // коробка
  "blister", // блистер
  "bottle", // флакон / бутылка
  "vial", // ампула-флакон
  "tube", // туба
  "piece", // штука
];

const DRUG_STATUSES = ["active", "archived"];

const NAME_MAX = 300;
const INN_MAX = 300;
const STRENGTH_MAX = 120;
const CATEGORY_MAX = 160;
const MANUFACTURER_MAX = 200;
const SKU_MAX = 80;
const NOTE_MAX = 1000;

const drugItemSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Торговое наименование (то, что видит фармацевт в списке).
    name: { type: String, trim: true, required: true, maxlength: NAME_MAX },

    // МНН / действующее вещество (для поиска и проверки дублей закупки).
    inn: { type: String, trim: true, default: "", maxlength: INN_MAX },

    form: {
      type: String,
      enum: DRUG_FORMS,
      default: "other",
      required: true,
    },

    // Дозировка/концентрация: "500 мг", "5 мг/мл", "0.9%".
    strength: {
      type: String,
      trim: true,
      default: "",
      maxlength: STRENGTH_MAX,
    },

    baseUnit: {
      type: String,
      enum: BASE_UNITS,
      default: "piece",
      required: true,
    },

    packUnit: {
      type: String,
      enum: PACK_UNITS,
      default: "pack",
      required: true,
    },

    // Сколько baseUnit в одном packUnit (уп → таблетки). >= 1.
    unitsPerPack: {
      type: Number,
      default: 1,
      min: 1,
      required: true,
    },

    // Свободная категория ("Антибиотики", "Анальгетики"). Индексируем для
    // группировки в каталоге и отчётах.
    category: {
      type: String,
      trim: true,
      default: "",
      maxlength: CATEGORY_MAX,
    },

    manufacturer: {
      type: String,
      trim: true,
      default: "",
      maxlength: MANUFACTURER_MAX,
    },

    // Внутренний код / штрихкод. Уникальность НЕ навязываем на уровне схемы
    // (частичный уникальный индекс по clinicId+sku можно добавить позже).
    sku: { type: String, trim: true, default: "", maxlength: SKU_MAX },

    // Предметно-количественный учёт (наркотич./психотроп./сильнодействующие).
    isControlled: { type: Boolean, default: false, index: true },

    // Порог дозаказа, в baseUnit. 0 = не отслеживать.
    minStock: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: DRUG_STATUSES,
      default: "active",
      required: true,
      index: true,
    },

    note: { type: String, trim: true, default: "", maxlength: NOTE_MAX },
  },
  { timestamps: true, collection: "clinic_drug_items" },
);

// ── INDEXES ────────────────────────────────────────────────
// Основной листинг каталога: активные препараты клиники по имени.
drugItemSchema.index({ clinicId: 1, status: 1, name: 1 });
// Отчёт по контролируемым в рамках клиники.
drugItemSchema.index({ clinicId: 1, isControlled: 1, status: 1 });
// Поиск по названию/МНН (текстовый). Вес имени выше МНН.
drugItemSchema.index(
  { name: "text", inn: "text" },
  { weights: { name: 5, inn: 3 }, name: "drugitem_text" },
);

const DrugItem =
  mongoose.models.DrugItem || mongoose.model("DrugItem", drugItemSchema);

export const DRUG_FORM_VALUES = DRUG_FORMS;
export const DRUG_BASE_UNIT_VALUES = BASE_UNITS;
export const DRUG_PACK_UNIT_VALUES = PACK_UNITS;
export const DRUG_STATUS_VALUES = DRUG_STATUSES;

export default DrugItem;
