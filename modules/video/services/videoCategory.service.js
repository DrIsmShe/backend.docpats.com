// server/modules/video/services/videoCategory.service.js
//
// Разделы витрины: список для зрителя и управление для администратора.
//
// УДАЛЕНИЕ РАЗДЕЛА НЕ ТРОГАЕТ РОЛИКИ. Ролики остаются, просто теряют полку
// и уходят в общую ленту. Иначе удаление раздела «Реабилитация» стирало бы
// чужие материалы — цена ошибки в админке несопоставима с пользой.
//
// ПОРЯДОК ХРАНИТСЯ ЧИСЛОМ, А НЕ ПОЗИЦИЕЙ В МАССИВЕ. Перетаскивание полки
// иначе требовало бы переписать все остальные, а два администратора,
// делающие это одновременно, получили бы разный порядок.

import mongoose from "mongoose";
import VideoCategory from "../models/videoCategory.model.js";
import Video from "../models/video.model.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { VIDEO_LOCALES } from "../constants.js";

/** Разделы для витрины — только включённые, в заданном порядке. */
export async function listCategories({ lang = "ru", withCounts = false } = {}) {
  const items = await VideoCategory.find({ active: true })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  let счётчики = new Map();
  if (withCounts && items.length) {
    // Сколько роликов на каждой полке — одним запросом: витрина иначе
    // делала бы по запросу на чипс.
    const строки = await Video.aggregate([
      {
        $match: {
          visibility: "public",
          status: "ready",
          phi: false,
          archivedAt: null,
          categoryId: { $in: items.map((к) => к._id) },
        },
      },
      { $group: { _id: "$categoryId", n: { $sum: 1 } } },
    ]);
    счётчики = new Map(строки.map((с) => [String(с._id), с.n]));
  }

  return {
    items: items.map((к) => ({
      _id: к._id,
      slug: к.slug,
      title: (к.title && (к.title[lang] || к.title.ru)) || к.slug,
      order: к.order,
      count: счётчики.get(String(к._id)) ?? undefined,
    })),
  };
}

/** Полный список для администратора — включая выключенные, со всеми языками. */
export async function adminListCategories() {
  const items = await VideoCategory.find().sort({ order: 1, createdAt: 1 }).lean();
  const строки = await Video.aggregate([
    { $match: { categoryId: { $ne: null } } },
    { $group: { _id: "$categoryId", n: { $sum: 1 } } },
  ]);
  const счётчики = new Map(строки.map((с) => [String(с._id), с.n]));
  return {
    items: items.map((к) => ({ ...к, count: счётчики.get(String(к._id)) || 0 })),
  };
}

/**
 * Дописать названию раздела недостающие языки.
 *
 * ЗАЧЕМ. Раздел заводит администратор и пишет название по-русски. До сих пор
 * турецкий и арабский зритель видел в чипсах витрины русские слова — не
 * ошибку, а просто непонятный текст, потому что подставлять было нечего.
 *
 * ПЕРЕВОДИМ ТОЛЬКО ПУСТОЕ. Если администратор вписал название сам, оно
 * важнее машинного: он знает, как эту полку называют в клинике.
 *
 * СБОЙ ПЕРЕВОДА НЕ ОТМЕНЯЕТ СОЗДАНИЕ РАЗДЕЛА. Раздел без пяти языков —
 * рабочий раздел; раздел, который не создался из-за недоступной модели, —
 * потерянное действие администратора. Поэтому каждый язык в своём try, а
 * весь вызов — необязательный шаг.
 *
 * ДВА СЛОВА — НЕ СТАТЬЯ. translateWithAI рассчитан на текст, но другого
 * переводчика в проекте нет, а заводить второй ради подписи из двух слов
 * значит удваивать место, где чинить.
 */
/**
 * Похож ли перевод на этот язык.
 *
 * Проверка грубая и намеренно такая: она ловит не плохой перевод, а
 * НЕПЕРЕВОД — когда вернулся исходник или текст чужой письменности.
 * Судить о качестве перевода машина не может, а отличить кириллицу от
 * арабского — вполне.
 */
function похожеНаЯзык(текст, язык) {
  const t = String(текст || "").trim();
  if (!t) return false;

  const кириллица = /[\u0400-\u04FF]/.test(t);
  const арабица = /[\u0600-\u06FF]/.test(t);

  if (язык === "ar") return арабица;
  // Латинские языки: кириллица означает, что перевода не было.
  if (["en", "tr", "az"].includes(язык)) return !кириллица && !арабица;
  return true;
}

export async function перевестиНазвание(title) {
  const исходный = "ru";
  const готово = { ...title };

  const языки = VIDEO_LOCALES.filter(
    (л) => л !== исходный && !String(готово[л] || "").trim(),
  );
  if (!языки.length || !title?.ru) return готово;

  const { translateWithAI } = await import("../../translation/translateWithAI.js");

  for (const язык of языки) {
    try {
      const { content } = await translateWithAI({
        // Контекст в заголовке: одно слово без него модель переводит
        // наугад, и «Анатомия» уезжает в турецкий как «Anatomia».
        title: "Название раздела каталога медицинских видео",
        content: title.ru,
        fromLanguage: исходный,
        toLanguage: язык,
      });
      // Подпись чипса — короткая: обрезаем по тому же пределу, что и схема,
      // иначе длинный перевод не пройдёт валидацию модели.
      const текст = String(content || "").trim().slice(0, 80);

      // Пустое поле честнее подделки: интерфейс покажет русское название,
      // и человек увидит, что перевода нет. Кириллица под видом арабского
      // выглядит переведённой и потому не будет замечена никогда.
      if (текст && похожеНаЯзык(текст, язык)) {
        готово[язык] = текст;
      } else if (текст) {
        console.warn(
          `[video] перевод раздела на ${язык} не похож на язык: «${текст}»`,
        );
      }
    } catch (err) {
      console.warn(`[video] название раздела на ${язык}:`, err?.message);
    }
  }

  return готово;
}

/**
 * Разделы, доступные ЭТОМУ человеку для публикации.
 *
 * Витрина показывает все полки — по ним ищут. Но при публикации выбор
 * зависит от того, кто публикует: пациент кладёт ролик только в «Мнения
 * пациентов». Раньше сервер молча переносил ролик на нужную полку, и
 * человек выбирал одно, а получал другое; честнее показать сразу, что
 * выбора нет.
 */
export async function listPublishableCategories({ actor, lang = "ru" }) {
  const { этоПациент, полкаПациентов } = await import(
    "./videoPatientPublish.service.js"
  );

  let пациент = false;
  if (actor?.ownerType === "user" && actor.ownerId) {
    const User = (await import("../../../common/models/Auth/users.js")).default;
    const user = await User.findById(actor.ownerId).select("role").lean();
    пациент = этоПациент(user);
  }

  if (пациент) {
    const полка = await полкаПациентов();
    return {
      items: [
        {
          _id: полка._id,
          slug: полка.slug,
          title: полка.title?.[lang] || полка.title?.ru || полка.slug,
          order: полка.order,
        },
      ],
      // Интерфейсу: выбора нет, показывать список бессмысленно.
      fixed: true,
    };
  }

  const { items } = await listCategories({ lang });
  return { items, fixed: false };
}

export async function createCategory({ adminId, data }) {
  const существует = await VideoCategory.findOne({ slug: data.slug });
  if (существует) throw new ValidationError("Раздел с таким ключом уже есть");

  // Недостающие языки дописываем до создания: половина разделов с
  // переводом и половина без — худший вид непоследовательности, чем
  // отсутствие перевода вообще.
  let title = data.title;
  try {
    title = await перевестиНазвание(data.title);
  } catch (err) {
    console.warn("[video] перевод названия раздела не удался:", err?.message);
  }

  const категория = await VideoCategory.create({
    slug: data.slug,
    title,
    order: data.order ?? 100,
    active: data.active ?? true,
    createdBy: adminId,
  });

  await recordAction({
    actor: { userId: adminId, email: null, role: "admin" },
    action: "video.admin.category",
    resourceType: "video",
    resourceId: категория._id,
    metadata: { op: "create", slug: категория.slug },
  });

  return категория;
}

export async function updateCategory({ adminId, id, patch }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Раздел не найден");
  const категория = await VideoCategory.findById(id);
  if (!категория) throw new NotFoundError("Раздел не найден");

  if (patch.slug && patch.slug !== категория.slug) {
    const занят = await VideoCategory.findOne({ slug: patch.slug });
    if (занят) throw new ValidationError("Раздел с таким ключом уже есть");
    категория.slug = patch.slug;
  }
  if (patch.title) {
    const слитое = { ...категория.title.toObject(), ...patch.title };
    // Дописываем только пустые языки: старый ручной перевод машинным
    // не заменяем — администратор мог назвать полку так, как её зовут в клинике.
    try {
      категория.title = await перевестиНазвание(слитое);
    } catch (err) {
      console.warn("[video] перевод названия раздела не удался:", err?.message);
      категория.title = слитое;
    }
  }
  if (patch.order !== undefined) категория.order = patch.order;
  if (patch.active !== undefined) категория.active = patch.active;
  await категория.save();

  await recordAction({
    actor: { userId: adminId, email: null, role: "admin" },
    action: "video.admin.category",
    resourceType: "video",
    resourceId: категория._id,
    metadata: { op: "update", fields: Object.keys(patch) },
  });

  return категория;
}

/**
 * Удалить раздел.
 *
 * Ролики не трогаем — только снимаем с них ссылку. Удаление полки не должно
 * означать удаление того, что на ней лежало.
 */
export async function deleteCategory({ adminId, id }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Раздел не найден");
  const категория = await VideoCategory.findById(id);
  if (!категория) throw new NotFoundError("Раздел не найден");

  const { modifiedCount } = await Video.updateMany(
    { categoryId: категория._id },
    { $set: { categoryId: null } },
  );
  await VideoCategory.deleteOne({ _id: категория._id });

  await recordAction({
    actor: { userId: adminId, email: null, role: "admin" },
    action: "video.admin.category",
    resourceType: "video",
    resourceId: категория._id,
    metadata: { op: "delete", slug: категория.slug, released: modifiedCount },
  });

  return { deleted: true, released: modifiedCount };
}

export default {
  listCategories,
  adminListCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
