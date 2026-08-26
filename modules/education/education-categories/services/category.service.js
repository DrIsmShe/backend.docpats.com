// server/modules/education/education-categories/services/category.service.js
//
// Бизнес-логика рубрикатора тестов. Категории создаёт админ; глубина дерева
// ограничена двумя уровнями (категория → подкатегория), потому что витрина
// и режим «блоков по 50» рассчитаны именно на такую форму.

import mongoose from "mongoose";
import ExamCategory from "../models/examCategory.model.js";
import { translateCategoryContent } from "./categoryTranslator.js";
import { EXAM_LANGUAGES } from "../../constants.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// ─── slug из имени ────────────────────────────────────────────────────
// Навигация в авторизованной зоне идёт по _id, поэтому slug — «для красоты»
// и SEO. Кириллицу транслитерируем по простой таблице; если после чистки
// не осталось ни одного символа — slug не выставляем вовсе (индекс sparse).
const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(name) {
  const base = String(name ?? "")
    .toLowerCase()
    .split("")
    .map((ch) => (ch in CYR ? CYR[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || null;
}

// Гарантирует уникальность slug: при коллизии добавляет -2, -3, …
async function uniqueSlug(name, excludeId = null) {
  const base = slugify(name);
  if (!base) return null;

  let candidate = base;
  let n = 1;
  // Циклимся до свободного значения. Категорий немного, перебор дешёвый.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: excludeId };
    const clash = await ExamCategory.findOne(query).select("_id").lean();
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// ─── Имя рубрики на языке врача ───────────────────────────────────────
// Перевода нет — отдаём оригинал. Это осознанный откат, а не заглушка: имя
// на чужом языке читается, пустое место — нет. Так же ведут себя переводы
// кейсов арены и вопросов банка.
function localize(category, lang) {
  if (!lang || lang === category.lang) return category;
  const tr = (category.translations ?? []).find((t) => t.lang === lang);
  if (!tr?.name) return category;
  return {
    ...category,
    name: tr.name,
    description: tr.description || category.description,
  };
}

// Перевод рубрики на остальные языки. БЕЗ await у вызывающего: админ не
// должен ждать модель, чтобы создать рубрику, и недоступность модели не
// повод не дать её создать. Ошибку гасим в лог — как перевод кейса при
// публикации (radiology/translation/onPublish.js).
function scheduleCategoryTranslation(categoryId) {
  setImmediate(async () => {
    try {
      const doc = await ExamCategory.findById(categoryId);
      if (!doc) return;
      const targets = EXAM_LANGUAGES.filter((l) => l !== doc.lang);
      const translations = await translateCategoryContent({
        name: doc.name,
        description: doc.description ?? "",
        sourceLang: doc.lang,
        targetLangs: targets,
      });
      if (!translations.length) return;
      doc.translations = translations;
      await doc.save();
      logger?.info?.(
        { categoryId: String(categoryId), langs: translations.map((t) => t.lang) },
        "exam category translated",
      );
    } catch (err) {
      logger?.error?.(
        { err, categoryId: String(categoryId) },
        "exam category translation failed",
      );
    }
  });
}

// ─── Дерево категорий с числом тестов ─────────────────────────────────
// countScope:
//   "public" — считаем только опубликованные публичные тесты (для витрины);
//   "all"    — считаем все тесты категории (для админки).
// lang: язык врача — имена рубрик отдаются на нём, если перевод есть.
export async function listCategoriesTree({ countScope = "public", lang = null } = {}) {
  const [categories, counts] = await Promise.all([
    ExamCategory.find({}).sort({ order: 1, name: 1 }).lean(),
    countProgramsByCategory(countScope),
  ]);

  const byId = new Map(
    categories.map((c) => [
      String(c._id),
      {
        ...localize(c, lang),
        id: String(c._id),
        parentId: c.parentId ? String(c.parentId) : null,
        // Тесты, привязанные напрямую к этому узлу.
        directProgramCount: counts.get(String(c._id)) ?? 0,
        children: [],
      },
    ]),
  );

  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      // Верхний уровень: либо явный корень, либо «сирота» с удалённым
      // родителем — её тоже показываем на верхнем уровне, чтобы не потерять.
      roots.push(node);
    }
  }

  // programCount у категории = свои тесты + тесты всего поддерева на любой
  // глубине. Считаем рекурсивно, чтобы цифра на верхнем узле была верной.
  const computeCounts = (node) => {
    let total = node.directProgramCount;
    for (const child of node.children) total += computeCounts(child);
    node.programCount = total;
    return total;
  };
  roots.forEach(computeCounts);

  return roots;
}

async function countProgramsByCategory(countScope) {
  const { default: ExamProgram } = await import(
    "../../education-catalog/models/examProgram.model.js"
  );
  const match = { categoryId: { $ne: null } };
  if (countScope === "public") {
    match.status = "published";
    match.ownerClinicId = null;
  }
  const rows = await ExamProgram.aggregate([
    { $match: match },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

// ─── Валидация родителя (дерево неограниченной глубины) ────────────────
// Глубина вложенности не ограничена. Единственное ограничение —
// запрет циклов: категорию нельзя вложить в саму себя или в любую из своих
// (пусть и глубоких) подкатегорий, иначе дерево замкнётся в кольцо и обход
// зациклится.
async function assertParentValid(parentId, selfId = null) {
  if (!parentId) return;

  if (selfId && String(parentId) === String(selfId)) {
    throw new ValidationError("Категория не может быть родителем самой себе");
  }

  let cursor = await ExamCategory.findById(parentId)
    .select("_id parentId")
    .lean();
  if (!cursor) throw new NotFoundError("Родительская категория");

  if (selfId) {
    // Идём вверх по цепочке предков предполагаемого родителя. Если встретим
    // саму перемещаемую категорию — значит родитель лежит в её поддереве.
    while (cursor) {
      if (String(cursor._id) === String(selfId)) {
        throw new ValidationError(
          "Нельзя переместить категорию внутрь её же подкатегории",
        );
      }
      cursor = cursor.parentId
        ? await ExamCategory.findById(cursor.parentId)
            .select("_id parentId")
            .lean()
        : null;
    }
  }
}

// ─── create ───────────────────────────────────────────────────────────
export async function createCategory(input) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new ValidationError("Имя категории обязательно");

  await assertParentValid(input.parentId ?? null);

  const slug = await uniqueSlug(name);

  try {
    const doc = await ExamCategory.create({
      name,
      slug,
      description: input.description ?? "",
      parentId: input.parentId ?? null,
      order: input.order ?? 0,
      icon: input.icon ?? "",
      isActive: input.isActive ?? true,
      // Язык, на котором админ набрал имя. Приходит из интерфейса; без него
      // считаем русским — так вело себя всё до появления языка у рубрик.
      lang: EXAM_LANGUAGES.includes(input.lang) ? input.lang : "ru",
      createdBy: input.actorId ?? null,
    });
    scheduleCategoryTranslation(doc._id);
    return doc.toObject();
  } catch (err) {
    // Дубликат имени в пределах родителя ловим по коду Mongo, чтобы отдать
    // человеку понятное сообщение вместо E11000.
    if (err?.code === 11000) {
      throw new ConflictError("Категория с таким именем здесь уже есть");
    }
    throw err;
  }
}

// ─── update ───────────────────────────────────────────────────────────
export async function updateCategory(id, input) {
  const existing = await ExamCategory.findById(id);
  if (!existing) throw new NotFoundError("Категория");

  const update = {};
  // Текст изменился — значит прежние переводы относятся к другому названию.
  let textChanged = false;
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new ValidationError("Имя категории обязательно");
    if (name !== existing.name) textChanged = true;
    update.name = name;
    // Пересобираем slug только при смене имени.
    update.slug = await uniqueSlug(name, existing._id);
  }
  if (input.description !== undefined) {
    if (input.description !== existing.description) textChanged = true;
    update.description = input.description;
  }
  if (input.lang !== undefined && EXAM_LANGUAGES.includes(input.lang)) {
    if (input.lang !== existing.lang) textChanged = true;
    update.lang = input.lang;
  }
  if (input.order !== undefined) update.order = input.order;
  if (input.icon !== undefined) update.icon = input.icon;
  if (input.isActive !== undefined) update.isActive = input.isActive;

  if (input.parentId !== undefined) {
    const nextParent = input.parentId ?? null;
    await assertParentValid(nextParent, existing._id);
    update.parentId = nextParent;
  }

  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  try {
    if (textChanged) {
      // Старые переводы стираем СРАЗУ, не дожидаясь новых: рубрика,
      // переименованная в «Кардиология», не должна ни секунды показываться
      // азербайджанскому врачу как «Nevrologiya». Оригинал в этот промежуток
      // читается, устаревший перевод — вводит в заблуждение.
      update.translations = [];
    }
    const doc = await ExamCategory.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true },
    ).lean();
    if (textChanged) scheduleCategoryTranslation(id);
    return doc;
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError("Категория с таким именем здесь уже есть");
    }
    throw err;
  }
}

// ─── delete ───────────────────────────────────────────────────────────
// Удаление рубрики не трогает тесты — только их привязку. Но молча
// «отвязать» десяток тестов опасно, поэтому удаление блокируется, пока к
// категории что-то привязано: сначала перенеси тесты и подкатегории.
export async function deleteCategory(id) {
  const category = await ExamCategory.findById(id).lean();
  if (!category) throw new NotFoundError("Категория");

  const child = await ExamCategory.findOne({ parentId: id })
    .select("_id")
    .lean();
  if (child) {
    throw new ConflictError(
      "У категории есть подкатегории — сначала удалите или перенесите их",
    );
  }

  const { default: ExamProgram } = await import(
    "../../education-catalog/models/examProgram.model.js"
  );
  const linked = await ExamProgram.findOne({ categoryId: id })
    .select("_id")
    .lean();
  if (linked) {
    throw new ConflictError(
      "К категории привязаны тесты — сначала перенесите их в другую категорию",
    );
  }

  await ExamCategory.deleteOne({ _id: id });
  logger?.info?.({ categoryId: String(id) }, "exam category deleted");
  return { deleted: true, id: String(id) };
}

// ─── getCategoryById ──────────────────────────────────────────────────
export async function getCategoryById(id) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Категория");
  const doc = await ExamCategory.findById(id).lean();
  if (!doc) throw new NotFoundError("Категория");
  return doc;
}
