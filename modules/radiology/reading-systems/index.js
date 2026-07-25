// server/modules/radiology/reading-systems/index.js
//
// Реестр систем чтения — устроен как реестр экстракторов education
// (education-ingest/extractors/index.js) и платёжных провайдеров: набор
// плагинов, доступ по ключу-модальности. Добавить модальность = добавить
// файл-плагин и одну строку сюда, не трогая ядро.
//
// Именно этот реестр — техническое воплощение принципа «одна система на
// одно исследование».

import chestXray from "./chestXray.system.js";
import ecg from "./ecg.system.js";
import ct from "./ct.system.js";
import us from "./us.system.js";
import mri from "./mri.system.js";
import { findingsForModality } from "../lexicon/lexicon.js";

const SYSTEMS = {
  cxr: chestXray,
  ecg,
  ct,
  us,
  mri,
};

/** Система чтения по модальности или undefined, если плагина ещё нет. */
export function getReadingSystem(modality) {
  return SYSTEMS[modality];
}

/** Есть ли готовая система чтения для этой модальности. */
export function hasReadingSystem(modality) {
  return Boolean(SYSTEMS[modality]);
}

/** Список готовых систем — для UI авторинга и конфигурации ридера. */
export function listReadingSystems() {
  return Object.values(SYSTEMS).map((s) => ({
    modality: s.modality,
    title: s.title,
    description: s.description,
    viewer: s.viewer,
    checklist: s.checklist,
    passThreshold: s.scoring.passThreshold,
    // Палитра ярлыков находок этой модальности — нужна редактору авторинга
    // (какие находки вообще можно разметить) и ридеру (из чего выбирать).
    findingPalette: findingsForModality(s.modality),
  }));
}
