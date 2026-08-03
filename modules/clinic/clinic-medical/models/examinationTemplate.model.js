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

// Четыре блока, из которых собирается протокол. Совпадают с полями
// ImagingStudy: nameOfExam → report → diagnosis → recommendation.
export const TEMPLATE_KINDS = [
  "nameOfExam",
  "report",
  "diagnosis",
  "recommendation",
];

const examinationTemplateSchema = new mongoose.Schema(
  {
    // Проставляется автоматически плагином tenantScoped из контекста запроса.
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Вид исследования: CT, MRI, EchoECG… Значения те же, что в studyType
    // модели ImagingStudy — единый список живёт в imaging.service.js.
    modality: { type: String, required: true, index: true },

    // Какой из четырёх блоков протокола заполняет эта заготовка.
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

// Выборка всегда идёт «заготовки такого-то вида для такого-то исследования»,
// свежие сверху. clinicId в индексе первым: плагин подставляет его в каждый
// запрос, и без него индекс не использовался бы.
examinationTemplateSchema.index({ clinicId: 1, modality: 1, kind: 1, createdAt: -1 });

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
