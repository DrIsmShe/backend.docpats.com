// server/modules/radiology/reading-systems/ct.system.js
//
// Система чтения КТ. Работает через тот же движок станции «Снимки»: холст,
// разметка находок, скоринг. Отличается протоколом осмотра и тем, что КТ
// смотрят в разных окнах — их перечисляем в windowPresets (на этапе готовых
// срезов это подсказка оператору, а не интерактивное окно).

import { defineReadingSystem } from "./base.js";

export default defineReadingSystem({
  modality: "ct",
  title: "Компьютерная томография",
  description:
    "КТ: системный просмотр в нужных окнах, разметка находок и заключение.",
  viewer: {
    multiSlice: true,
    tools: ["zoom", "pan", "measure", "roi"],
    windowPresets: ["lung", "mediastinum", "soft", "bone"],
  },
  checklist: [
    { key: "windows", label: "Просмотр в нужных окнах (лёгочное/мягкотканное/костное)" },
    { key: "parenchyma", label: "Паренхима органа (лёгкие/печень/мозг — по зоне)" },
    { key: "vessels", label: "Сосуды и средостение/забрюшинное пространство" },
    { key: "cavities", label: "Полости и свободная жидкость/газ" },
    { key: "lymph", label: "Лимфатические узлы" },
    { key: "bones", label: "Костные структуры" },
  ],
  scoring: {
    weights: {
      detection: 0.35,
      classification: 0.15,
      checklist: 0.15,
      diagnosis: 0.25,
      aiImpression: 0.1,
    },
    matchRadius: 0.09,
    falseAlarmPenalty: 1,
    passThreshold: 0.7,
  },
});
