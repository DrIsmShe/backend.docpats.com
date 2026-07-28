// server/modules/radiology/translation/caseFields.js
//
// Что в кейсе переводится, а что нет. Один манифест на три станции.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
//
//   ярлыки находок (findings[].label) — это ключи контролируемого словаря
//     (lexicon.js), а не текст. Врач выбирает находку из палитры, и палитра
//     приходит ключами; подписи к ним переводятся один раз в словаре
//     интерфейса, а не в каждом кейсе;
//
//   области осмотра (readingSystem.checklist) — то же самое: константы
//     модальности, общие для всех кейсов;
//
//   единицы и референсы (panel[].unit, refRange, value) — это запись чисел,
//     а не язык. «мг/дл» и «3.5–5.1» переводу не подлежат, а попытка
//     перевести значение испортила бы анализ;
//
//   источник (source.authority, licenseNote, url) — выходные данные реального
//     документа. Переведённое название невозможно найти.
//
// ПУТИ ВЕДУТ ПО КЛЮЧАМ, А НЕ ПО НОМЕРАМ, там где ключ есть:
// "findings.pneumothorax.explanation", а не "findings.0.explanation". Автор
// может переставить находки или удалить одну из середины — при нумерации
// перевод после этого встал бы к чужой находке, и врач прочитал бы разбор не
// того, что нашёл. Где ключа нет (изображения, варианты), нумерация
// безопасна: перестановка меняет собранный текст, а значит и хеш, и перевод
// сам помечается устаревшим.

import crypto from "node:crypto";

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** Собирает переводимые поля кейса: путь → текст. Пустые пропускаются. */
export function collectCaseFields(caseType, doc) {
  const out = {};
  const put = (path, value) => {
    const t = text(value);
    if (t) out[path] = t;
  };

  put("title", doc.title);

  if (caseType === "radiology") {
    put("clinicalContext", doc.clinicalContext);
    (doc.images ?? []).forEach((img, i) => put(`images.${i}.label`, img.label));
    for (const f of doc.findings ?? []) {
      if (f.key) put(`findings.${f.key}.explanation`, f.explanation);
    }
    put("impression.correctText", doc.impression?.correctText);
  }

  if (caseType === "labs") {
    put("clinicalContext", doc.clinicalContext);
    for (const p of doc.panel ?? []) {
      if (p.key) put(`panel.${p.key}.name`, p.name);
    }
    put("impression.correctText", doc.impression?.correctText);
    (doc.variants ?? []).forEach((v, i) => {
      put(`variants.${i}.label`, v.label);
      put(`variants.${i}.note`, v.note);
    });
  }

  if (caseType === "vp") {
    put("presentation", doc.presentation);
    for (const inv of doc.investigations ?? []) {
      if (!inv.key) continue;
      put(`investigations.${inv.key}.name`, inv.name);
      put(`investigations.${inv.key}.category`, inv.category);
      put(`investigations.${inv.key}.resultText`, inv.resultText);
    }
    put("diagnosis.correctText", doc.diagnosis?.correctText);
    (doc.variants ?? []).forEach((v, i) => {
      put(`variants.${i}.label`, v.label);
      put(`variants.${i}.presentation`, v.presentation);
      put(`variants.${i}.note`, v.note);
      for (const r of v.results ?? []) {
        if (r.key) put(`variants.${i}.results.${r.key}.resultText`, r.resultText);
      }
    });
  }

  return out;
}

/** Сверочные наборы диагноза — они живут в разных полях у разных станций. */
export function collectDiagnosisSets(caseType, doc) {
  const node = caseType === "vp" ? doc.diagnosis : doc.impression;
  return {
    diagnosisKeys: [...(node?.diagnosisKeys ?? [])],
    diagnosisSynonyms: [...(node?.diagnosisSynonyms ?? [])],
  };
}

/**
 * Отпечаток переводимого содержания. Изменился — перевод устарел.
 *
 * В хеш входят и сверочные наборы: автор добавил принятый синоним диагноза —
 * перевод обязан его получить, иначе врач на этом языке напишет верный
 * диагноз и не получит балл.
 */
export function sourceHashOf(caseType, doc) {
  const payload = JSON.stringify({
    fields: collectCaseFields(caseType, doc),
    diagnosis: collectDiagnosisSets(caseType, doc),
  });
  return crypto.createHash("sha1").update(payload).digest("hex");
}

/**
 * Накладывает перевод на выдаваемый кейс.
 *
 * Работает по той же карте путей и НЕ трогает ничего, чего в переводе нет:
 * недостающее поле остаётся на языке оригинала. Пустой экран хуже русского
 * текста — врач хотя бы увидит, что там написано, и сможет разобрать по
 * терминам.
 *
 * Мутирует переданный объект: это уже собранная для выдачи копия
 * (toReaderView), а не документ Mongoose.
 */
export function applyCaseFields(caseType, view, fields) {
  if (!fields) return view;
  const get = (path) => (fields instanceof Map ? fields.get(path) : fields[path]);
  const set = (path, assign) => {
    const value = get(path);
    if (text(value)) assign(value);
  };

  set("title", (v) => {
    view.title = v;
  });

  if (caseType === "radiology" || caseType === "labs") {
    set("clinicalContext", (v) => {
      view.clinicalContext = v;
    });
  }

  if (caseType === "radiology") {
    (view.images ?? []).forEach((img, i) => {
      set(`images.${i}.label`, (v) => {
        img.label = v;
      });
    });
    for (const f of view.findings ?? []) {
      set(`findings.${f.key}.explanation`, (v) => {
        f.explanation = v;
      });
    }
    if (view.impression) {
      set("impression.correctText", (v) => {
        view.impression.correctText = v;
      });
    }
  }

  if (caseType === "labs") {
    for (const p of view.panel ?? []) {
      set(`panel.${p.key}.name`, (v) => {
        p.name = v;
      });
    }
    if (view.impression) {
      set("impression.correctText", (v) => {
        view.impression.correctText = v;
      });
    }
  }

  if (caseType === "vp") {
    set("presentation", (v) => {
      view.presentation = v;
    });
    for (const inv of view.investigations ?? []) {
      set(`investigations.${inv.key}.name`, (v) => {
        inv.name = v;
      });
      set(`investigations.${inv.key}.category`, (v) => {
        inv.category = v;
      });
      set(`investigations.${inv.key}.resultText`, (v) => {
        inv.resultText = v;
      });
    }
    if (view.diagnosis) {
      set("diagnosis.correctText", (v) => {
        view.diagnosis.correctText = v;
      });
    }
  }

  return view;
}
