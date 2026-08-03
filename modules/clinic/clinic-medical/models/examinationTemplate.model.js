// modules/clinic/clinic-medical/models/examinationTemplate.model.js
//
// Справочник заготовок для протоколов исследований.
//
// ЗАЧЕМ. Врач не пишет протокол КТ с нуля каждый раз: у него есть набор
// готовых формулировок — названия исследований, типовые протоколы, частые
// заключения и рекомендации. В единоличной практике (модуль myClinic) это
// решено семнадцатью парами коллекций, по одной на каждый вид исследования.
// Здесь то же самое сделано одной моделью: вид исследования и вид заготовки
// стали ПОЛЯМИ, а не именем коллекции. Добавить восемнадцатый вид теперь
// значит дописать строку в справочник модальностей, а не завести пять
// моделей и три десятка файлов.
//
// ЧЕЙ ЭТО СПРАВОЧНИК. Клиники, а не врача — и это единственное отличие от
// поведения myClinic. В практике на одного доктора разницы нет, а в клинике
// на двадцать врачей справочник, привязанный к автору, означал бы, что
// каждый новый сотрудник набивает формулировки заново.
//
// ЭТО НЕ ДАННЫЕ ПАЦИЕНТА. В заготовке лежит обезличенная формулировка
// («Признаков очаговой патологии не выявлено»), поэтому — в отличие от
// самих исследований — содержимое не шифруется и не требует согласия
// пациента на доступ. Ссылок на пациента у модели нет вовсе.

import mongoose from "mongoose";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";

// Где применяется заготовка. Область решает, к какому набору полей она
// относится: протокол исследования или запись приёма.
export const TEMPLATE_SCOPES = ["examination", "encounter"];

// Четыре блока, из которых собирается протокол исследования. Совпадают с
// полями ImagingStudy: nameOfExam → report → diagnosis → recommendation.
export const EXAMINATION_KINDS = [
  "nameOfExam",
  "report",
  "diagnosis",
  "recommendation",
];

// Одиннадцать блоков записи приёма. Ключи в точности повторяют имена полей
// модели приёма (newPatientMedicalHistory) — так заготовка попадает в поле
// без всякого сопоставления, а расхождение имён обнаружится сразу.
//
// В единоличной практике (модуль myClinic) под каждый из этих блоков заведена
// отдельная коллекция-справочник: tempComplaints, tempAnamnesisMorbi,
// tempStatusLocalis и так далее. Здесь это значения одного поля.
export const ENCOUNTER_KINDS = [
  "complaints",
  "anamnesisMorbi",
  "anamnesisVitae",
  "statusPreasens",
  "statusLocalis",
  "additionalDiagnosis",
  "recommendations",
  "ctScanResults",
  "mriResults",
  "ultrasoundResults",
  "laboratoryTestResults",
];

// Полный перечень для enum схемы.
//
// ОСТОРОЖНО: "recommendation" (рекомендации в протоколе исследования) и
// "recommendations" (рекомендации по итогам приёма) различаются одной буквой.
// Это не опечатка: каждый ключ повторяет имя поля в своей модели, а модели
// назвали поля по-разному. Различает их область (scope), а не сам ключ.
export const TEMPLATE_KINDS = [...EXAMINATION_KINDS, ...ENCOUNTER_KINDS];

/** Допустимые блоки для области. */
export function kindsForScope(scope) {
  return scope === "encounter" ? ENCOUNTER_KINDS : EXAMINATION_KINDS;
}

const examinationTemplateSchema = new mongoose.Schema(
  {
    // Проставляется автоматически плагином tenantScoped из контекста запроса.
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Область применения. По умолчанию "examination": так записи, заведённые
    // до появления заготовок приёма, остаются протоколами исследований и
    // ничего не теряют.
    scope: {
      type: String,
      required: true,
      enum: TEMPLATE_SCOPES,
      default: "examination",
      index: true,
    },

    // Вид исследования: CT, MRI, EchoECG… Значения те же, что в studyType
    // модели ImagingStudy — единый список живёт в imaging.service.js.
    //
    // Обязателен ТОЛЬКО для протоколов исследований: у записи приёма вида
    // исследования нет, там жалобы и анамнез не делятся на КТ и МРТ.
    modality: {
      type: String,
      default: null,
      index: true,
      required: function () {
        return this.scope !== "encounter";
      },
    },

    // Какой блок заполняет эта заготовка: один из четырёх блоков протокола
    // или один из одиннадцати блоков приёма — смотря какая область.
    kind: { type: String, required: true, enum: TEMPLATE_KINDS, index: true },

    // Короткая подпись в списке выбора.
    title: { type: String, required: true, trim: true, maxlength: 300 },

    // Сам текст, который подставится в форму.
    body: { type: String, default: "", maxlength: 20000 },

    // Автор — для колонки «кто добавил». Сотрудник клиники и врач-пользователь
    // это разные личности, поэтому полей два, как и во всей клинике.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdByEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },
  },
  { timestamps: true, collection: "clinic_examination_templates" },
);

// Выборка всегда идёт «заготовки такого-то блока в такой-то области»,
// свежие сверху. clinicId в индексе первым: плагин подставляет его в каждый
// запрос, и без него индекс не использовался бы. modality стоит после scope
// и kind — у записей приёма он пустой и в отборе не участвует.
examinationTemplateSchema.index({
  clinicId: 1,
  scope: 1,
  kind: 1,
  modality: 1,
  createdAt: -1,
});

// Изоляция между клиниками. Плагин сам добавляет clinicId в каждый поиск,
// обновление и удаление, проставляет его при сохранении и роняет запрос,
// у которого явный clinicId противоречит контексту.
examinationTemplateSchema.plugin(tenantScopedPlugin);

// Регистрация через проверку: под vitest файл импортируется повторно, и
// mongoose.model() во второй раз бросил бы OverwriteModelError.
const ExaminationTemplate =
  mongoose.models.ExaminationTemplate ||
  mongoose.model("ExaminationTemplate", examinationTemplateSchema);

export default ExaminationTemplate;
