// server/modules/radiology/reading-systems/ecg.system.js
//
// Система чтения ЭКГ. ЭКГ — это лента (изображение), поэтому она проходит
// через тот же движок станции «Снимки»: холст с зумом и измерением,
// разметка находок на ленте, скоринг. Отличается только протоколом осмотра
// и палитрой находок (из lexicon по модальности "ecg").
//
// Чек-лист — классический системный разбор ЭКГ по порядку: сначала ритм и
// частота, затем ось, зубцы/интервалы, и только потом ST/T. Порядок и есть
// «читать правильно»: не прыгать к элевации ST, а пройти всё.

import { defineReadingSystem } from "./base.js";

export default defineReadingSystem({
  modality: "ecg",
  title: "Электрокардиограмма",
  description:
    "ЭКГ в 12 отведениях: системный разбор (ритм, частота, ось, интервалы, ST/T), разметка находок на ленте и заключение.",
  viewer: {
    multiSlice: false,
    // measure нужен для интервалов (PR, QRS, QT) — линейка по ленте.
    tools: ["zoom", "pan", "measure", "roi"],
    windowPresets: [],
  },
  checklist: [
    { key: "rhythm", label: "Ритм: синусовый или нет" },
    { key: "rate", label: "Частота (ЧСС)" },
    { key: "axis", label: "Электрическая ось сердца" },
    { key: "p_wave", label: "Зубцы P (форма, наличие)" },
    { key: "pr", label: "Интервал PR" },
    { key: "qrs", label: "Комплекс QRS (ширина, форма)" },
    { key: "st", label: "Сегмент ST (элевация/депрессия)" },
    { key: "t_wave", label: "Зубцы T" },
    { key: "qt", label: "Интервал QT" },
  ],
  scoring: {
    // На ЭКГ система осмотра важна не меньше самой находки — вес чек-листа
    // чуть выше, чем у рентгена.
    weights: {
      detection: 0.3,
      classification: 0.15,
      checklist: 0.2,
      diagnosis: 0.3,
      aiImpression: 0.05,
    },
    matchRadius: 0.1,
    falseAlarmPenalty: 1,
    passThreshold: 0.7,
  },
});
