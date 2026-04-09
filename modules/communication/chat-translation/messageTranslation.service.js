// server/modules/communication/chat-translation/messageTranslation.service.js

import OpenAI from "openai";
import MessageTranslationModel from "./messageTranslation.model.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Все языки мира (100+) ────────────────────────────────────────────────────
// GPT-4o-mini поддерживает все эти языки без дополнительных настроек.
// Список используется для UI (LanguageSelector) и валидации кода.

export const SUPPORTED_LANGUAGES = {
  // Европейские
  af: "Afrikaans",
  sq: "Albanian",
  hy: "Armenian",
  az: "Azerbaijani",
  eu: "Basque",
  be: "Belarusian",
  bs: "Bosnian",
  bg: "Bulgarian",
  ca: "Catalan",
  hr: "Croatian",
  cs: "Czech",
  da: "Danish",
  nl: "Dutch",
  en: "English",
  et: "Estonian",
  fi: "Finnish",
  fr: "French",
  gl: "Galician",
  ka: "Georgian",
  de: "German",
  el: "Greek",
  hu: "Hungarian",
  is: "Icelandic",
  ga: "Irish",
  it: "Italian",
  lv: "Latvian",
  lt: "Lithuanian",
  lb: "Luxembourgish",
  mk: "Macedonian",
  mt: "Maltese",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sr: "Serbian",
  sk: "Slovak",
  sl: "Slovenian",
  es: "Spanish",
  sv: "Swedish",
  uk: "Ukrainian",
  cy: "Welsh",

  // Азиатские
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  bn: "Bengali",
  gu: "Gujarati",
  id: "Indonesian",
  kn: "Kannada",
  km: "Khmer",
  lo: "Lao",
  ms: "Malay",
  ml: "Malayalam",
  mr: "Marathi",
  my: "Burmese",
  ne: "Nepali",
  pa: "Punjabi",
  si: "Sinhala",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  tl: "Filipino",
  ur: "Urdu",
  uz: "Uzbek",
  vi: "Vietnamese",

  // Ближний Восток
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  tr: "Turkish",
  ku: "Kurdish",

  // Центральная Азия
  kk: "Kazakh",
  ky: "Kyrgyz",
  mn: "Mongolian",
  tg: "Tajik",
  tk: "Turkmen",
  tt: "Tatar",

  // Африканские
  am: "Amharic",
  ha: "Hausa",
  ig: "Igbo",
  sw: "Swahili",
  yo: "Yoruba",
  zu: "Zulu",
  so: "Somali",
  rw: "Kinyarwanda",
  mg: "Malagasy",
};

// Получить название языка по коду (для промпта GPT)
function getLangName(code) {
  return SUPPORTED_LANGUAGES[code] || code; // неизвестный — передаём код напрямую
}

// Валидация: принимаем любой корректный ISO-код (2–8 символов)
// Это позволяет переводить даже на языки не из списка выше
function isValidLangCode(code) {
  if (!code || typeof code !== "string") return false;
  return /^[a-z]{2,8}(-[A-Za-z]{2,4})?$/.test(code);
}

// ─── Определение языка по Unicode (без API) ───────────────────────────────────

export function detectLanguage(text) {
  if (!text || text.trim().length < 2) return null;

  const t = text.replace(/\s/g, "");
  const total = t.length || 1;

  const scores = {
    ar: (t.match(/[\u0600-\u06FF]/g) || []).length,
    he: (t.match(/[\u0590-\u05FF]/g) || []).length,
    zh: (t.match(/[\u4E00-\u9FFF]/g) || []).length,
    ja: (t.match(/[\u3040-\u30FF]/g) || []).length,
    ko: (t.match(/[\uAC00-\uD7AF]/g) || []).length,
    th: (t.match(/[\u0E00-\u0E7F]/g) || []).length,
    ka: (t.match(/[\u10A0-\u10FF]/g) || []).length,
    hy: (t.match(/[\u0530-\u058F]/g) || []).length,
    hi: (t.match(/[\u0900-\u097F]/g) || []).length,
    am: (t.match(/[\u1200-\u137F]/g) || []).length,
    cyrillic: (t.match(/[\u0400-\u04FF]/g) || []).length,
    latin: (t.match(/[a-zA-Z]/g) || []).length,
  };

  // Находим скрипт с наибольшим процентом символов
  for (const [lang, count] of Object.entries(scores)) {
    if (lang === "cyrillic" || lang === "latin") continue;
    if (count / total > 0.25) {
      // Различаем японский vs китайский
      if (lang === "zh" && scores.ja / total > 0.1) return "ja";
      return lang;
    }
  }

  if (scores.cyrillic / total > 0.3) {
    if (/[іїєґ]/.test(text)) return "uk";
    if (/[ўЎ]/.test(text)) return "be";
    if (/[ӘәҒғҚқҢңӨөҰұҮүҺһ]/.test(text)) return "kk";
    if (/[ӣӯҳқғ]/.test(text)) return "tg";
    return "ru";
  }

  if (scores.latin / total > 0.4) {
    if (/[əöüğışçƏÖÜĞİŞÇ]/.test(text)) return "az";
    if (/[İıĞğŞşÖöÜü]/.test(text)) return "tr";
    if (/[żźćęąśłńó]/.test(text)) return "pl";
    if (/[čšžđć]/.test(text)) return "hr";
    if (/[áéíóúüñ¿¡]/.test(text)) return "es";
    if (/[àâäèêëîïôùûüÿœæ]/.test(text)) return "fr";
    if (/[äöüß]/.test(text)) return "de";
    if (/[àèìòùéäöü]/.test(text)) return "it";
    if (/[ãõáéíóúàèç]/.test(text)) return "pt";
    if (/[åæø]/.test(text)) return "no";
    if (/[åäö]/.test(text)) return "sv";
    return "en";
  }

  return null;
}

// ─── GPT перевод ──────────────────────────────────────────────────────────────

async function callGPT(text, fromLang, toLang) {
  const fromName = getLangName(fromLang);
  const toName = getLangName(toLang);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a precise medical chat translator. " +
          "Return ONLY the translated text — no explanations, no quotes, nothing else.",
      },
      {
        role: "user",
        content:
          `Translate from ${fromName} to ${toName}.\n` +
          `Rules: natural conversational tone, keep medical terms accurate, keep emojis as-is.\n\n` +
          `Message:\n${text}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 1024,
  });

  const result = response.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error("Empty GPT response");
  return result;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const rlStore = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const key = String(userId);
  if (!rlStore.has(key)) rlStore.set(key, []);
  const timestamps = rlStore.get(key).filter((t) => now - t < 60_000);
  if (timestamps.length >= 60) return false;
  timestamps.push(now);
  rlStore.set(key, timestamps);
  return true;
}

// ─── Публичные функции ────────────────────────────────────────────────────────

export async function translateMessage({
  messageId,
  dialogId,
  text,
  targetLang,
  requestedBy = null,
  isPrefetch = false,
}) {
  if (!text?.trim()) throw new Error("Empty text");
  if (!isValidLangCode(targetLang))
    throw new Error(`Invalid lang code: ${targetLang}`);
  if (text.length > 5000) throw new Error("Text too long");

  if (requestedBy && !isPrefetch) {
    if (!checkRateLimit(requestedBy)) throw new Error("RATE_LIMIT");
  }

  const detectedLang = detectLanguage(text);

  if (detectedLang && detectedLang === targetLang) {
    return {
      translatedText: text,
      detectedLang,
      targetLang,
      fromDb: false,
      sameLanguage: true,
    };
  }

  // MongoDB кэш
  const existing = await MessageTranslationModel.findOne({
    messageId,
    targetLang,
  });
  if (existing) {
    MessageTranslationModel.updateOne(
      { _id: existing._id },
      { $inc: { hitCount: 1 } },
    ).catch(() => {});
    return {
      translatedText: existing.translatedText,
      detectedLang: existing.detectedLang,
      targetLang,
      fromDb: true,
      sameLanguage: false,
    };
  }

  // GPT
  const translatedText = await callGPT(
    text,
    detectedLang || "auto",
    targetLang,
  );

  await MessageTranslationModel.create({
    messageId,
    dialogId,
    originalText: text,
    detectedLang,
    targetLang,
    translatedText,
    requestedBy,
    isPrefetch,
  });

  return {
    translatedText,
    detectedLang,
    targetLang,
    fromDb: false,
    sameLanguage: false,
  };
}

export function prefetchMessageTranslations({
  messageId,
  dialogId,
  text,
  participantLanguages,
}) {
  if (!text?.trim() || !participantLanguages?.length) return;

  const detectedLang = detectLanguage(text);
  const uniqueLangs = [
    ...new Set(
      participantLanguages
        .map((p) => p.lang)
        .filter((l) => isValidLangCode(l) && l !== detectedLang),
    ),
  ];

  if (!uniqueLangs.length) return;

  (async () => {
    for (const lang of uniqueLangs) {
      try {
        const exists = await MessageTranslationModel.exists({
          messageId,
          targetLang: lang,
        });
        if (exists) continue;
        const translated = await callGPT(text, detectedLang || "auto", lang);
        await MessageTranslationModel.create({
          messageId,
          dialogId,
          originalText: text,
          detectedLang,
          targetLang: lang,
          translatedText: translated,
          isPrefetch: true,
        });
        console.log(
          `[chatTranslation] prefetch ✓ msg=${messageId} lang=${lang}`,
        );
      } catch (err) {
        console.error(
          `[chatTranslation] prefetch ✗ msg=${messageId} lang=${lang}:`,
          err.message,
        );
      }
    }
  })();
}

export async function getMessageTranslations(messageId) {
  return MessageTranslationModel.find({ messageId }).select(
    "targetLang detectedLang translatedText translationMethod isPrefetch hitCount createdAt",
  );
}

export async function deleteTranslationsByDialog(dialogId) {
  return MessageTranslationModel.deleteMany({ dialogId });
}
