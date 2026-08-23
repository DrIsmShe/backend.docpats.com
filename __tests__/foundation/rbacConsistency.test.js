// Согласованность двух уровней прав.
//
// В клиническом модуле есть ГРУБЫЙ каталог (common/auth/permissions.js:
// ресурс × read/write/delete) и ЗЕРНИСТЫЙ для медкарты
// (clinic-medical/rbac/clinicMedicalRBAC.js: сущность × create/read/list/
// update/sign/amend/export/delete).
//
// Зернистый нужен: центральный каталог не умеет выразить «медсестра заносит
// прививки, но не подписывает приём» — у него на всю медкарту один
// medical_record.write. Сплющить медицину до трёх действий значило бы выдать
// медсестре право создавать и подписывать приёмы.
//
// Но два независимых источника истины на один вопрос — это то, из чего
// вырастают дыры. Поэтому уровни связаны правилом: ЛЮБОЕ зернистое действие
// обязано быть подкреплено грубым правом. Зернистый уровень может только
// СУЖАТЬ, никогда не расширять.
//
// Этот тест и есть связка. Расхождение здесь — упавший тест, а не тихая дыра.

import { describe, it, expect } from "vitest";
import {
  RBAC_MATRIX,
} from "../../modules/clinic/clinic-medical/rbac/clinicMedicalRBAC.js";
import {
  ROLE_PERMISSIONS,
  RESOURCES,
  ROLES,
} from "../../common/auth/permissions.js";

// Сущность медкарты → ресурс общего каталога.
const RESOURCE_OF = {
  encounter: RESOURCES.MEDICAL_RECORD,
  allergy: RESOURCES.MEDICAL_RECORD,
  chronic_disease: RESOURCES.MEDICAL_RECORD,
  operation: RESOURCES.MEDICAL_RECORD,
  family_history: RESOURCES.MEDICAL_RECORD,
  immunization: RESOURCES.MEDICAL_RECORD,
  imaging: RESOURCES.MEDICAL_RECORD,
  lab_result: RESOURCES.MEDICAL_RECORD,
  prescription: RESOURCES.PRESCRIPTION,
  exam_template: RESOURCES.EXAMINATION_TEMPLATE,
};

// Зернистый глагол → грубое действие. Чтение и выгрузка — это read;
// всё, что меняет запись, включая подпись и отмену, — write.
const ACTION_OF = {
  read: "read",
  list: "read",
  export: "read",
  create: "write",
  update: "write",
  sign: "write",
  amend: "write",
  cancel: "write",
  complete: "write",
  delete: "delete",
};

/** "clinic.medical.lab_result.export" → { entity, verb } */
function parse(action) {
  const m = String(action).match(/^clinic\.medical\.([a-z_]+)\.([a-z_]+)$/);
  return m ? { entity: m[1], verb: m[2] } : null;
}


// ─── Известные расхождения ────────────────────────────────────────────────
//
// Осталось семь строк, и все они про lab_technician — роль, которой нет в
// ROLES (см. ниже). Назначить её никому нельзя, поэтому и права её недостижимы:
// это не дыра, а мёртвая настройка незаконченной функции.
//
// Прежде здесь было тридцать пять строк. Двадцать восемь закрыты дописыванием
// грубого каталога, и вот почему это было правильно: медицинские сервисы
// проверяют И грубое право тоже (requirePerm("medical_record", …)), а маршруты
// — зернистое. Проходят оба. Значит расхождение означало не «лишнее
// разрешение», а НЕРАБОТАЮЩУЮ функцию: матрица разрешает, каталог отказывает,
// отказ побеждает. Фармацевт не мог прочитать аллергии, хотя обязан по работе.
//
// Инвариант работает для всего остального, любое НОВОЕ расхождение уронит
// тест, а устаревшая строка отсюда — тоже уронит.
const KNOWN_DIVERGENCES = new Set([
  "lab_technician: clinic.medical.encounter.list → нет medical_record.read",
  "lab_technician: clinic.medical.encounter.read → нет medical_record.read",
  "lab_technician: clinic.medical.lab_result.create → нет medical_record.write",
  "lab_technician: clinic.medical.lab_result.export → нет medical_record.read",
  "lab_technician: clinic.medical.lab_result.list → нет medical_record.read",
  "lab_technician: clinic.medical.lab_result.read → нет medical_record.read",
  "lab_technician: clinic.medical.lab_result.update → нет medical_record.write",
]);

describe("права: зернистый уровень не шире грубого", () => {
  // lab_technician объявлен в матрице медкарты, но в ROLES его нет, а членство
  // валидируется именно по ROLES (ALLOWED_ROLES = Object.values(ROLES)).
  // Значит роль НЕДОСТИЖИМА: назначить её никому нельзя, и вся её строка в
  // матрице — мёртвая настройка. Безопасности это не угрожает (прав без роли
  // не бывает), но выглядит как незаконченная функция: либо роль собирались
  // ввести и не довели, либо убрали из каталога и забыли про матрицу.
  // Заводить новую роль рефакторингом нельзя — это решение о продукте.
  const KNOWN_UNREGISTERED_ROLES = new Set(["lab_technician"]);

  it("каждая роль медкарты известна общему каталогу", () => {
    const known = new Set(Object.values(ROLES));
    const unknown = Object.keys(RBAC_MATRIX).filter(
      (r) => !known.has(r) && !KNOWN_UNREGISTERED_ROLES.has(r),
    );
    expect(unknown).toEqual([]);
  });

  it("недостижимые роли не разрастаются", () => {
    const known = new Set(Object.values(ROLES));
    const stale = [...KNOWN_UNREGISTERED_ROLES].filter((r) => known.has(r));
    expect(stale, "роль появилась в каталоге — уберите её из списка").toEqual([]);
  });

  it("каждое действие разбирается по схеме сущность.глагол", () => {
    const unparsed = [];
    for (const actions of Object.values(RBAC_MATRIX)) {
      for (const action of actions) {
        const parsed = parse(action);
        if (!parsed || !RESOURCE_OF[parsed.entity] || !ACTION_OF[parsed.verb]) {
          unparsed.push(action);
        }
      }
    }
    expect(unparsed).toEqual([]);
  });

  it("зернистое действие подкреплено грубым правом", () => {
    const violations = [];

    for (const [role, actions] of Object.entries(RBAC_MATRIX)) {
      const coarse = ROLE_PERMISSIONS[role] || {};
      for (const action of actions) {
        const parsed = parse(action);
        if (!parsed) continue;
        const resource = RESOURCE_OF[parsed.entity];
        const needed = ACTION_OF[parsed.verb];
        if (!coarse[resource]?.[needed]) {
          const line = `${role}: ${action} → нет ${resource}.${needed}`;
          if (!KNOWN_DIVERGENCES.has(line)) violations.push(line);
        }
      }
    }

    // Каждое нарушение означает, что медкарта разрешает больше, чем каталог,
    // и по каталогу такую роль уже не проверить.
    expect(violations).toEqual([]);
  });

  it("замороженный список не разрастается и не протухает", () => {
    // Обе стороны важны. Разрастание — это новые расхождения, добавленные в
    // обход решения. Протухание — строки, которые уже неактуальны: их надо
    // убирать, иначе список перестаёт означать «здесь ждут решения».
    const live = new Set();
    for (const [role, actions] of Object.entries(RBAC_MATRIX)) {
      const coarse = ROLE_PERMISSIONS[role] || {};
      for (const action of actions) {
        const parsed = parse(action);
        if (!parsed) continue;
        const resource = RESOURCE_OF[parsed.entity];
        const needed = ACTION_OF[parsed.verb];
        if (!coarse[resource]?.[needed]) {
          live.add(`${role}: ${action} → нет ${resource}.${needed}`);
        }
      }
    }

    const stale = [...KNOWN_DIVERGENCES].filter((l) => !live.has(l));
    expect(stale, "эти расхождения уже устранены — уберите их из списка").toEqual([]);
  });
});
