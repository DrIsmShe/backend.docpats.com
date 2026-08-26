// server/modules/education/education-categories/models/examCategory.model.js
//
// ExamCategory = именованная рубрика витрины тестов, которую создаёт админ:
// «Международные экзамены», «Резидентура Турции», «НМО-баллы». Полный аналог
// категорий статей (common/models/Articles/articlesCategories.js), но для
// модуля подготовки к экзаменам.
//
// Проектные решения:
//   1. ГЛОБАЛЬНАЯ сущность, как и весь модуль education: без clinicId и без
//      tenantScoped-плагина. Категории видит любой авторизованный, создаёт
//      только админ.
//   2. Дерево ПРОИЗВОЛЬНОЙ глубины через parentId (self-ref): категория →
//      подкатегория → под-подкатегория → … Ограничение одно — запрет циклов
//      (см. category.service → assertParentValid). Витрина обходит дерево
//      рекурсивно, навигация идёт «папками» с хлебными крошками.
//   3. НИЧЕГО не создаётся сидом: пустой каталог — нормальное стартовое
//      состояние. Наполняет админ вручную, ровно как категории статей.
//   4. slug — необязательный, для читаемых ссылок и совместимости; навигация
//      в авторизованной зоне идёт по _id, а не по slug (см. CLAUDE.md).

import mongoose from "mongoose";
import { EXAM_LANGUAGES } from "../../constants.js";

const { Schema } = mongoose;

// Перевод названия рубрики на один язык.
//
// ВЛОЖЕННЫМ МАССИВОМ, а не отдельной коллекцией — в отличие от переводов
// кейсов арены и вопросов банка. Там перевод это самостоятельная единица: на
// вопрос-перевод ссылается попытка, у кейса-перевода свой жизненный цикл и
// пометка «выправлено человеком». Здесь переводится ДВА КОРОТКИХ ПОЛЯ, ни на
// что не ссылающихся; отдельная коллекция дала бы join на каждый показ
// каталога ради строки в двадцать символов.
const translationSchema = new Schema(
  {
    lang: { type: String, enum: EXAM_LANGUAGES, required: true },
    name: { type: String, trim: true, maxlength: 200, default: "" },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { _id: false },
);

const examCategorySchema = new Schema(
  {
    // Человекочитаемое имя рубрики. Уникальность — в паре с родителем,
    // чтобы «Часть 1» можно было завести в разных категориях (см. индекс ниже).
    name: { type: String, required: true, trim: true, maxlength: 200 },

    // Читаемый идентификатор. Уникален глобально, но необязателен —
    // генерируется сервисом из name, у кириллицы допускается пустой.
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 220,
      default: null,
    },

    description: { type: String, trim: true, maxlength: 2000, default: "" },

    // Родитель. null = категория верхнего уровня; заполнено = подкатегория.
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCategory",
      default: null,
      index: true,
    },

    // Порядок в списке (меньше — выше). Совпадающий порядок разрешаем:
    // при равенстве сортируем по имени.
    order: { type: Number, default: 0 },

    // Иконка (класс bootstrap-icons, эмодзи или URL) — необязательна.
    icon: { type: String, trim: true, maxlength: 200, default: "" },

    isActive: { type: Boolean, default: true },

    // ─── Язык и переводы ───
    //
    // Каталог показывают врачам на пяти языках, а рубрику админ заводит на
    // одном — на своём. До появления этих полей азербайджанский врач видел в
    // списке «Психология», «Научные» и «Psixoloqiya» вперемешку, причём
    // первые две были не переведены, а третья оказывалась ОТДЕЛЬНОЙ
    // категорией, заведённой руками на другом языке. Каталог выглядел
    // сломанным, хотя сломано было ровно одно: у рубрики не было языка.
    //
    // lang — язык, на котором введены name/description. Он же источник
    // перевода и то, к чему откатываемся, когда перевода на нужный язык нет.
    lang: { type: String, enum: EXAM_LANGUAGES, default: "ru" },
    translations: { type: [translationSchema], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "exam_categories",
  },
);

// ─── Индексы ───
// Основной запрос: дети конкретного узла в порядке отображения.
examCategorySchema.index({ parentId: 1, order: 1, name: 1 });
// Имя уникально В ПРЕДЕЛАХ одного родителя (две «Часть 1» под разными
// категориями допустимы, две под одной — нет).
examCategorySchema.index({ parentId: 1, name: 1 }, { unique: true });
// slug уникален глобально, но только когда он вообще задан (sparse).
examCategorySchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: "string" } } },
);

const ExamCategory =
  mongoose.models.ExamCategory ||
  mongoose.model("ExamCategory", examCategorySchema, "exam_categories");

export default ExamCategory;
