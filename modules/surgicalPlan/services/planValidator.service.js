// server/modules/surgicalPlan/services/planValidator.service.js

/* ============================================================
   КЛИНИЧЕСКАЯ ВАЛИДАЦИЯ ПЛАНА + ТАБЛИЦА «ДО/ПОСЛЕ»
   ============================================================
   Здесь нет ни одного обращения к модели. Всё, что дальше видит
   врач — числа, границы, конфликты — считается детерминированным
   кодом по каталогу и пресету. Значит, одинаковый план всегда даёт
   одинаковый вердикт, и его можно объяснить построчно.

   Схема разбора гарантирует только форму. Границы чисел она не
   гарантирует: structured outputs следит за типом, но не обязан
   соблюдать minimum/maximum. Поэтому диапазоны перепроверяются
   здесь, а не считаются проверенными выше.

   Разделение severity:
   - error   — план исполнять нельзя (конфликт, дубль, выход за
               границы, физически невозможный результат);
   - warning — исполнить можно, но врач обязан это увидеть
               (измерение уходит за пределы нормы);
   - info    — стоит знать (измерение возвращается в норму).
   ============================================================ */

const round = (v, digits = 2) =>
  v == null || Number.isNaN(v) ? null : Number(v.toFixed(digits));

/* ------------------------------------------------------------
   1. Структура: операции, параметры, границы, конфликты
   ------------------------------------------------------------ */
function validateOperations(plan, catalog) {
  const findings = [];
  const { OPERATION_MAP } = catalog.helpers;
  const seen = new Set();

  for (const operation of plan.operations) {
    const spec = OPERATION_MAP[operation.code];

    // Схема сюда такое пропустить не должна, но каталог мог
    // измениться между разбором и валидацией сохранённого плана.
    if (!spec) {
      findings.push({
        severity: "error",
        code: "UNKNOWN_OPERATION",
        operation: operation.code,
        message: `Операции «${operation.code}» нет в каталоге ${catalog.meta.code} версии ${catalog.meta.version}`,
      });
      continue;
    }

    if (seen.has(operation.code)) {
      findings.push({
        severity: "error",
        code: "DUPLICATE_OPERATION",
        operation: operation.code,
        message: `«${spec.label.ru}» встречается в плане дважды`,
      });
      continue;
    }
    seen.add(operation.code);

    for (const [name, paramSpec] of Object.entries(spec.params)) {
      const value = operation.params?.[name];

      if (value === undefined || value === null) {
        if (paramSpec.required) {
          findings.push({
            severity: "error",
            code: "MISSING_PARAM",
            operation: operation.code,
            message: `«${spec.label.ru}»: не задан параметр «${paramSpec.label.ru}»`,
          });
        }
        continue;
      }

      if (paramSpec.type === "number") {
        if (typeof value !== "number" || Number.isNaN(value)) {
          findings.push({
            severity: "error",
            code: "PARAM_NOT_NUMBER",
            operation: operation.code,
            message: `«${spec.label.ru}»: «${paramSpec.label.ru}» должен быть числом`,
          });
        } else if (value < paramSpec.min || value > paramSpec.max) {
          findings.push({
            severity: "error",
            code: "PARAM_OUT_OF_RANGE",
            operation: operation.code,
            message:
              `«${spec.label.ru}»: ${paramSpec.label.ru} ${value} ${paramSpec.unit} ` +
              `вне допустимого диапазона ${paramSpec.min}…${paramSpec.max} ${paramSpec.unit}`,
          });
        }
      }

      if (paramSpec.type === "enum" && !paramSpec.options.includes(value)) {
        findings.push({
          severity: "error",
          code: "PARAM_NOT_IN_ENUM",
          operation: operation.code,
          message: `«${spec.label.ru}»: недопустимое значение «${value}»`,
        });
      }
    }

    // Неизвестные параметры — признак рассинхрона каталога и схемы.
    for (const name of Object.keys(operation.params || {})) {
      if (!spec.params[name]) {
        findings.push({
          severity: "error",
          code: "UNKNOWN_PARAM",
          operation: operation.code,
          message: `«${spec.label.ru}»: неизвестный параметр «${name}»`,
        });
      }
    }
  }

  // Конфликты — по парам, каждая пара сообщается один раз.
  const codes = [...seen];
  for (let i = 0; i < codes.length; i += 1) {
    const spec = OPERATION_MAP[codes[i]];
    if (!spec) continue;
    for (let j = i + 1; j < codes.length; j += 1) {
      if (spec.conflictsWith.includes(codes[j])) {
        findings.push({
          severity: "error",
          code: "CONFLICTING_OPERATIONS",
          operation: codes[i],
          message: `«${spec.label.ru}» и «${OPERATION_MAP[codes[j]].label.ru}» несовместимы в одном плане`,
        });
      }
    }
  }

  return findings;
}

/* ------------------------------------------------------------
   2. Предсказанные измерения

   before может отсутствовать целиком (нет калибровки) — тогда
   абсолютных значений не будет, но дельта всё равно известна:
   ротация на +5° есть +5° независимо от того, какой угол был.
   Показывать «+5°» без «до» честно и полезно; выдумывать «до»,
   чтобы заполнить колонку, — нет.
   ------------------------------------------------------------ */
function predictMeasurements(plan, catalog, preset, before) {
  const { OPERATION_MAP } = catalog.helpers;

  const deltas = {}; // код измерения → накопленная дельта (identity)
  const directions = {}; // код измерения → "increase" | "decrease" | "mixed"

  for (const operation of plan.operations) {
    const spec = OPERATION_MAP[operation.code];
    if (!spec) continue;

    for (const effect of spec.effects) {
      if (effect.kind === "identity") {
        const value = operation.params?.[effect.param];
        if (typeof value !== "number" || Number.isNaN(value)) continue;
        deltas[effect.measurement] =
          (deltas[effect.measurement] || 0) + effect.sign * value;
      }

      if (effect.kind === "qualitative") {
        const prev = directions[effect.measurement];
        directions[effect.measurement] =
          prev && prev !== effect.direction ? "mixed" : effect.direction;
      }
    }
  }

  // identity → абсолютные значения «после», где известно «до»
  const after = {};
  for (const [code, delta] of Object.entries(deltas)) {
    const base = before?.[code];
    if (typeof base === "number") after[code] = base + delta;
  }

  // derived — только когда все слагаемые посчитаны.
  //
  // Считаем производное и для «после», и для «до». Второе не
  // избыточно: антропометрия отдаёт измеренные величины (проекцию,
  // длину), а Goode из них выводится. Без пересчёта «до» строка
  // таблицы вышла бы с заполненным «после» и пустым «до» — ровно
  // тот полузаполненный вид, из-за которого таблице перестают верить.
  const beforeDerived = {};
  for (const rule of catalog.derived) {
    const afterInputs = {};
    const beforeInputs = {};
    let afterComplete = true;
    let beforeComplete = true;

    for (const dep of rule.from) {
      const afterValue = after[dep] ?? before?.[dep];
      if (typeof afterValue === "number") afterInputs[dep] = afterValue;
      else afterComplete = false;

      const beforeValue = before?.[dep];
      if (typeof beforeValue === "number") beforeInputs[dep] = beforeValue;
      else beforeComplete = false;
    }

    // Производное «после» показываем только если хоть один вход
    // реально изменился — иначе это просто повтор исходного.
    const touched = rule.from.some((dep) => dep in after);

    if (afterComplete && touched) {
      const value = rule.compute(afterInputs);
      if (typeof value === "number" && !Number.isNaN(value)) {
        after[rule.measurement] = value;
      }
    }

    if (beforeComplete) {
      const value = rule.compute(beforeInputs);
      if (typeof value === "number" && !Number.isNaN(value)) {
        beforeDerived[rule.measurement] = value;
      }
    }
  }

  return { deltas, directions, after, beforeDerived };
}

/* ------------------------------------------------------------
   3. Таблица строк для UI + предупреждения по нормам
   ------------------------------------------------------------ */
function buildRows({ catalog, preset, before, deltas, directions, after, patientGender }) {
  const { MEASUREMENT_MAP, getNorm, interpretValue } = preset.helpers;
  const findings = [];
  const rows = [];

  const codes = new Set([
    ...Object.keys(deltas),
    ...Object.keys(directions),
    ...Object.keys(after),
  ]);

  for (const code of codes) {
    const measurement = MEASUREMENT_MAP[code];
    if (!measurement) continue;

    const norm = getNorm(code, patientGender);
    const beforeValue = typeof before?.[code] === "number" ? before[code] : null;
    const afterValue = typeof after[code] === "number" ? after[code] : null;

    // Производные измерения дельты не накапливают — считаем её из
    // «до» и «после», иначе в таблице у Goode пустая колонка.
    const delta =
      code in deltas
        ? deltas[code]
        : beforeValue != null && afterValue != null
          ? afterValue - beforeValue
          : null;

    const statusBefore =
      beforeValue != null ? interpretValue(beforeValue, norm) : "unknown";
    const statusAfter =
      afterValue != null ? interpretValue(afterValue, norm) : "unknown";

    rows.push({
      code,
      label: measurement.label.ru,
      unit: measurement.unit,
      // quantified: число выведено геометрически.
      // directional: известно только направление — числа не будет.
      kind: code in deltas || afterValue != null ? "quantified" : "directional",
      direction: directions[code] || null,
      before: round(beforeValue),
      after: round(afterValue),
      delta: round(delta),
      norm,
      statusBefore,
      statusAfter,
    });

    if (afterValue == null) continue;

    // Физически невозможный результат — не предупреждение, а ошибка.
    if (
      (measurement.type === "distance" || measurement.type === "ratio") &&
      afterValue <= 0
    ) {
      findings.push({
        severity: "error",
        code: "IMPOSSIBLE_RESULT",
        measurement: code,
        message: `«${measurement.label.ru}» после плана — ${round(afterValue)} ${measurement.unit}. Такого не бывает: пересмотрите величины.`,
      });
      continue;
    }

    if (statusBefore === "within_norm" && statusAfter !== "within_norm") {
      findings.push({
        severity: "warning",
        code: "LEAVES_NORM",
        measurement: code,
        message:
          `«${measurement.label.ru}» уходит из нормы: ` +
          `${round(beforeValue)} → ${round(afterValue)} ${measurement.unit} ` +
          `(норма ${norm.min}–${norm.max})`,
      });
    }

    if (statusBefore !== "within_norm" && statusAfter === "within_norm") {
      findings.push({
        severity: "info",
        code: "ENTERS_NORM",
        measurement: code,
        message:
          `«${measurement.label.ru}» возвращается в норму: ` +
          `${round(beforeValue)} → ${round(afterValue)} ${measurement.unit}`,
      });
    }

    if (
      statusBefore !== "within_norm" &&
      statusAfter !== "within_norm" &&
      statusBefore !== statusAfter
    ) {
      findings.push({
        severity: "warning",
        code: "CROSSES_NORM",
        measurement: code,
        message:
          `«${measurement.label.ru}» перескакивает через норму: ` +
          `${round(beforeValue)} → ${round(afterValue)} ${measurement.unit} ` +
          `(норма ${norm.min}–${norm.max})`,
      });
    }
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { rows, findings };
}

/* ------------------------------------------------------------
   ОСНОВНАЯ ФУНКЦИЯ
   ------------------------------------------------------------ */
export function validatePlan({
  plan,
  catalog,
  preset,
  measurements = null,
  patientGender = "unknown",
}) {
  const structural = validateOperations(plan, catalog);

  const { deltas, directions, after, beforeDerived } = predictMeasurements(
    plan,
    catalog,
    preset,
    measurements,
  );

  // Измеренное всегда важнее пересчитанного: если антропометрия уже
  // отдала Goode, берём её значение, а выведенное служит лишь
  // подстановкой на случай, когда его не передали.
  const beforeEffective = { ...beforeDerived, ...(measurements || {}) };

  const { rows, findings: clinical } = buildRows({
    catalog,
    preset,
    before: beforeEffective,
    deltas,
    directions,
    after,
    patientGender,
  });

  const findings = [...structural, ...clinical];

  // Пустой план — не «исполнимый план без работы», а нечего исполнять.
  // Случай живой: просьбу вне каталога («сузить крылья» в боковой
  // проекции) разбор честно уносит в outOfScope и оставляет ноль
  // операций. Пропустить такое как ok значило бы отрисовать исходник
  // и выдать его за результат.
  if (plan.operations.length === 0) {
    findings.push({
      severity: "error",
      code: "EMPTY_PLAN",
      message: "В плане нет ни одной операции — исполнять нечего.",
    });
  }

  // Блокирующий вопрос без ответа — тоже причина не рисовать
  // результат: рисовать по недопонятому плану хуже, чем не рисовать.
  for (const item of plan.clarifications || []) {
    if (item.blocking) {
      findings.push({
        severity: "error",
        code: "BLOCKING_CLARIFICATION",
        message: item.question,
        detail: item.why,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error");

  return {
    ok: errors.length === 0,
    findings,
    measurements: {
      before: measurements || null,
      after: Object.keys(after).length > 0 ? after : null,
      rows,
    },
  };
}

export default validatePlan;
