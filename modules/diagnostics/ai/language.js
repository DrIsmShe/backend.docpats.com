// server/modules/diagnostics/ai/language.js
//
// ЯЗЫК РАЗБОРА.
//
// До этого файла модель писала по-русски всегда: правило «Пиши по-русски»
// стояло прямо в промпте, а язык врача не доезжал до сервера вовсе — клиент
// его не слал, в задании поля не было, Accept-Language никто не читал.
// Интерфейс при этом переводился на пять языков, и врач на азербайджанском
// получал переведённые заголовки над русским текстом.
//
// ПОЧЕМУ ГЕНЕРАЦИЯ, А НЕ ПЕРЕВОД. Врачебную запись можно было бы переводить
// готовой — через тот же translation-воркер. Но перевод медицинского текста
// это второй проход модели по тексту с PHI, лишняя задержка и лишняя потеря
// на пересказе: термин плывёт при переводе заметнее, чем при генерации.
// Модель умеет писать на нужном языке сразу — значит пусть пишет сразу.
//
// ЧЕГО ЭТОТ ФАЙЛ НЕ ДЕЛАЕТ. Он не переводит уже разобранные дела: выводы
// лежат в базе готовым текстом на языке, на котором их сделали. Смена языка
// интерфейса старое дело не переписывает — нужен перезапуск разбора.
//
// ПРОМПТ ОСТАЁТСЯ РУССКИМ — меняется только требуемый язык ОТВЕТА. Переводить
// сами инструкции незачем и рискованно: они выверены по формулировкам, и
// каждая их версия на пяти языках разъезжалась бы независимо.

/** Языки интерфейса. Всё, что не отсюда, считается русским. */
export const SUPPORTED_LANGS = ["ru", "en", "az", "tr", "ar"];

const DEFAULT_LANG = "ru";

/**
 * Приводит что угодно к поддерживаемому языку.
 *
 * Принимает и «az», и «az-AZ», и «AZ» — i18next и заголовок Accept-Language
 * пишут регион по-разному, а падать из-за этого разбор не должен.
 */
export function normalizeLang(value) {
  if (typeof value !== "string") return DEFAULT_LANG;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(base) ? base : DEFAULT_LANG;
}

/**
 * Требование к языку ответа — строкой в промпт.
 *
 * Сформулировано жёстче, чем «пиши на языке X»: модель, читая русский
 * материал дела и русские инструкции, охотно сползает обратно на русский.
 * Поэтому сказано и про источник, и про термины.
 */
const RULES = {
  ru: "Пиши по-русски, языком врачебной записи, без общих фраз и без воды.",
  en: "Пиши ПО-АНГЛИЙСКИ, языком врачебной записи, без общих фраз и без воды. Материал дела может быть на другом языке — это не повод отвечать на нём: весь ответ, включая термины и названия исследований, должен быть английским.",
  az: "Пиши ПО-АЗЕРБАЙДЖАНСКИ, языком врачебной записи, без общих фраз и без воды. Материал дела может быть на другом языке — это не повод отвечать на нём: весь ответ, включая термины и названия исследований, должен быть азербайджанским. Латиница, не кириллица.",
  tr: "Пиши ПО-ТУРЕЦКИ, языком врачебной записи, без общих фраз и без воды. Материал дела может быть на другом языке — это не повод отвечать на нём: весь ответ, включая термины и названия исследований, должен быть турецким.",
  ar: "Пиши ПО-АРАБСКИ, языком врачебной записи, без общих фраз и без воды. Материал дела может быть на другом языке — это не повод отвечать на нём: весь ответ, включая термины и названия исследований, должен быть арабским.",
};

/** Правило о языке ответа для промпта. */
export function languageRule(lang) {
  return RULES[normalizeLang(lang)];
}

/**
 * Подписи, которые сервер вклеивает в текст сам.
 *
 * Их нельзя отдать словарям клиента: они попадают в ТЕЛО материала дела и
 * сохраняются в базе вместе с ним. Врач, открывший дело через полгода,
 * должен видеть, что это прочитала модель по картинке, а не написал коллега,
 * — и видеть на своём языке.
 */
const IMAGE_TEXT = {
  ru: {
    header: "── ПРОЧИТАНО С ИЗОБРАЖЕНИЯ МОДЕЛЬЮ (не заключение врача) ──",
    what: "Что это",
    frame: "В кадре",
    attention: "Обращает на себя внимание:",
    couldBe: "похоже на",
    verify: "проверить",
    nothingSheet: "Явных изменений на просмотренных срезах не отмечено.",
    nothingOne: "Явных изменений на этом изображении не отмечено.",
    notAbsence: "Это НЕ означает отсутствия патологии у пациента.",
    limits: "Что мешает смотреть:",
    footerSheet:
      "Описание получено моделью по ВЫБОРКЕ срезов серии (не по всем) и подлежит проверке врачом.",
    footerOne:
      "Описание получено моделью по одному изображению и подлежит проверке врачом.",
    confidence: { high: "уверенно", moderate: "предположительно", low: "неотчётливо" },
  },
  en: {
    header: "── READ FROM THE IMAGE BY A MODEL (not a physician's report) ──",
    what: "What this is",
    frame: "In frame",
    attention: "Worth attention:",
    couldBe: "looks like",
    verify: "verify",
    nothingSheet: "No obvious changes noted on the reviewed slices.",
    nothingOne: "No obvious changes noted on this image.",
    notAbsence: "This does NOT mean the patient has no pathology.",
    limits: "What limits the reading:",
    footerSheet:
      "Description produced by a model from a SAMPLE of the series (not all slices) and subject to physician review.",
    footerOne:
      "Description produced by a model from a single image and subject to physician review.",
    confidence: { high: "confident", moderate: "probable", low: "indistinct" },
  },
  az: {
    header: "── ŞƏKİLDƏN MODEL TƏRƏFİNDƏN OXUNUB (həkim rəyi deyil) ──",
    what: "Bu nədir",
    frame: "Kadrda",
    attention: "Diqqət çəkənlər:",
    couldBe: "buna oxşayır",
    verify: "yoxlanmalı",
    nothingSheet: "Baxılmış kəsiklərdə aşkar dəyişiklik qeyd olunmayıb.",
    nothingOne: "Bu şəkildə aşkar dəyişiklik qeyd olunmayıb.",
    notAbsence: "Bu, pasiyentdə patologiyanın OLMAMASI demək DEYİL.",
    limits: "Baxışı məhdudlaşdıranlar:",
    footerSheet:
      "Təsvir model tərəfindən seriyanın SEÇMƏ kəsikləri üzrə (hamısı üzrə deyil) alınıb və həkim yoxlaması tələb edir.",
    footerOne:
      "Təsvir model tərəfindən bir şəkil üzrə alınıb və həkim yoxlaması tələb edir.",
    confidence: { high: "əminliklə", moderate: "ehtimal ki", low: "aydın deyil" },
  },
  tr: {
    header: "── GÖRÜNTÜDEN MODEL TARAFINDAN OKUNDU (hekim raporu değildir) ──",
    what: "Bu nedir",
    frame: "Kadrajda",
    attention: "Dikkat çekenler:",
    couldBe: "şuna benziyor",
    verify: "doğrulanmalı",
    nothingSheet: "İncelenen kesitlerde belirgin değişiklik saptanmadı.",
    nothingOne: "Bu görüntüde belirgin değişiklik saptanmadı.",
    notAbsence: "Bu, hastada patoloji OLMADIĞI anlamına GELMEZ.",
    limits: "Değerlendirmeyi kısıtlayanlar:",
    footerSheet:
      "Tanım, model tarafından serinin ÖRNEKLENMİŞ kesitlerinden (tümünden değil) elde edilmiştir ve hekim onayı gerektirir.",
    footerOne:
      "Tanım, model tarafından tek bir görüntüden elde edilmiştir ve hekim onayı gerektirir.",
    confidence: { high: "kesin", moderate: "olası", low: "belirsiz" },
  },
  ar: {
    header: "── قُرئت من الصورة بواسطة نموذج (ليست تقرير طبيب) ──",
    what: "ما هذا",
    frame: "في الإطار",
    attention: "ما يستدعي الانتباه:",
    couldBe: "يشبه",
    verify: "للتحقق",
    nothingSheet: "لم تُلاحظ تغيّرات واضحة في المقاطع التي جرت مراجعتها.",
    nothingOne: "لم تُلاحظ تغيّرات واضحة في هذه الصورة.",
    notAbsence: "هذا لا يعني غياب المرض لدى المريض.",
    limits: "ما يحدّ من القراءة:",
    footerSheet:
      "الوصف صادر عن نموذج بناءً على عيّنة من مقاطع السلسلة (وليس جميعها) ويخضع لمراجعة الطبيب.",
    footerOne: "الوصف صادر عن نموذج بناءً على صورة واحدة ويخضع لمراجعة الطبيب.",
    confidence: { high: "بثقة", moderate: "على الأرجح", low: "غير واضح" },
  },
};

/** Подписи для текста описания снимка. */
export function imageText(lang) {
  return IMAGE_TEXT[normalizeLang(lang)];
}
