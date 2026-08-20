// server/modules/surgicalPlan/catalog/index.js

/* ============================================================
   РЕЕСТР КАТАЛОГОВ
   ============================================================
   Каталог операций (что можно запланировать) всегда идёт в паре
   с пресетом антропометрии (что можно измерить). План без
   пресета не с чем сверять, пресет без каталога нечем менять.

   Пресет берём прямым импортом файла, а не через публичный API
   модуля anthropometry. Тот в index.js тянет за собой роутеры,
   контроллеры и модели — целую половину модуля ради структуры
   с числами. Здесь нужен чистый датасет, и такой импорт даёт
   разбор плана, который тестируется без поднятия anthropometry.
   ============================================================ */

import rhinoplastyLateralPreset from "../../anthropometry/presets/rhinoplasty.lateral.js";

import rhinoplastyLateralCatalog from "./rhinoplasty.lateral.js";

import { ValidationError } from "../../../common/utils/errors.js";

const REGISTRY = {
  [rhinoplastyLateralCatalog.meta.code]: {
    catalog: rhinoplastyLateralCatalog,
    preset: rhinoplastyLateralPreset,
  },
};

export const PROCEDURE_CODES = Object.keys(REGISTRY);

/**
 * Каталог + пресет по коду процедуры.
 * Бросает ValidationError — код процедуры приходит из запроса,
 * то есть это ошибка клиента, а не поломка сервера.
 */
export function getCatalog(procedureCode) {
  const entry = REGISTRY[procedureCode];
  if (!entry) {
    throw new ValidationError(`Неизвестная процедура: ${procedureCode}`, {
      supported: PROCEDURE_CODES,
    });
  }
  return entry;
}

export default { getCatalog, PROCEDURE_CODES };
