// server/modules/radiology/translation/arenaCaseTranslation.model.js
//
// Перевод учебного кейса на один язык. Общая модель для трёх станций.
//
// ПОЧЕМУ НАКЛАДКОЙ, А НЕ КОПИЕЙ КЕЙСА. В банке вопросов перевод — это
// отдельный ExamItem с другим lang, и это верно: вопросы взаимозаменяемы,
// сессия берёт любые N штук. С кейсом так нельзя. На caseId ссылаются пять
// коллекций — попытки трёх станций, дуэли, очередь повторения и аудит. Пятая
// копия кейса означала бы, что дуэль на русском кейсе и на его турецком
// переводе — разные дуэли, что средний балл кейса раскололся на пять чисел, а
// очередь «работы над ошибками» считает один и тот же случай пятью разными.
//
// Поэтому кейс остаётся один, а перевод лежит рядом и накладывается при
// выдаче. Попытка, дуэль и статистика продолжают ссылаться на единственный
// caseId независимо от того, на каком языке врач его читал.
//
// ПОЧЕМУ sourceHash, А НЕ ВЕРСИЯ. У кейсов нет поля version (в отличие от
// ExamItem). Заводить его только ради переводов значило бы трогать модель,
// которой пользуется половина модуля. Хеш переведённых полей решает ту же
// задачу: автор поправил текст — хеш разошёлся — перевод помечен устаревшим.
//
// ДИАГНОЗЫ ЛЕЖАТ ОТДЕЛЬНО ОТ ОСТАЛЬНОГО ТЕКСТА. fields — это то, что врач
// читает. diagnosisKeys и diagnosisSynonyms — то, с чем сверяется его ответ
// (diagnosisMatcher.js). Разница не косметическая: ошибка в fields некрасива,
// ошибка в ключах молча обнуляет людям баллы за диагноз. Их и проверять надо
// отдельно, и в админке показывать отдельно.

import mongoose from "mongoose";

const { Schema } = mongoose;

export const ARENA_CASE_TYPES = ["radiology", "labs", "vp"];
export const ARENA_LANGUAGES = ["ru", "en", "az", "tr", "ar"];

const arenaCaseTranslationSchema = new Schema(
  {
    caseType: { type: String, enum: ARENA_CASE_TYPES, required: true, index: true },
    caseId: { type: Schema.Types.ObjectId, required: true, index: true },
    lang: { type: String, enum: ARENA_LANGUAGES, required: true, index: true },

    // Язык оригинала, с которого переводили. Нужен для повторного перевода и
    // для того, чтобы показать редактору, что с чем сверять.
    sourceLang: { type: String, enum: ARENA_LANGUAGES, default: "ru" },

    // Читаемый текст: путь → перевод.
    //
    // Пути ведут по структуре кейса и включают ключ элемента, а не его номер:
    // "findings.pneumothorax.explanation", а не "findings.0.explanation".
    // Автор может переставить находки местами или удалить одну из середины —
    // при нумерации перевод после этого встал бы не к той находке, и врач
    // прочитал бы разбор чужой находки как разбор своей.
    //
    // Массив, а не Map: ключи Map в mongoose не могут содержать точку, а все
    // пути здесь из точек и состоят. Кодировать точку заменителем значило бы
    // завести правило, о котором обязан помнить каждый, кто сюда заглянет, —
    // и однажды не вспомнит. Массив хранит путь как есть.
    fields: {
      type: [
        {
          _id: false,
          path: { type: String, required: true },
          text: { type: String, default: "" },
        },
      ],
      default: [],
    },

    // Сверочные наборы для оценки диагноза на этом языке.
    diagnosisKeys: { type: [String], default: [] },
    diagnosisSynonyms: { type: [String], default: [] },

    // "auto" — машинный; "reviewed" — выправлен человеком и защищён от
    // перезаписи автопереводом.
    status: { type: String, enum: ["auto", "reviewed"], default: "auto", index: true },

    // Отпечаток переведённого текста оригинала. Разошёлся — перевод устарел.
    sourceHash: { type: String, default: null },

    model: { type: String, default: null },
    promptVersion: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "arena_case_translations" },
);

// Перевод кейса на язык может быть только один. Уникальность на уровне базы:
// перевод ставится в очередь, и повторная постановка (ретрай воркера, двойное
// нажатие) иначе создала бы вторую запись — а какая из двух наложится на кейс,
// зависело бы от порядка выдачи.
arenaCaseTranslationSchema.index(
  { caseType: 1, caseId: 1, lang: 1 },
  { unique: true },
);

const ArenaCaseTranslation =
  mongoose.models.ArenaCaseTranslation ||
  mongoose.model("ArenaCaseTranslation", arenaCaseTranslationSchema);

export default ArenaCaseTranslation;
