// server/modules/radiology/ai/autoFix.js
//
// ЦИКЛ «ПРАВКА → ПЕРЕПРОВЕРКА»: доводит черновик кейса до чистой рецензии.
//
// Собирает вместе редактора (ai/caseReviser.js) и рецензента
// (ai/caseVerifier.js): пока рецензент возвращает замечания, редактор их
// правит, и результат рецензируется заново — свежим вызовом, который не видит
// ни рассуждений редактора, ни прошлой рецензии.
//
// Гейт публикации при этом НЕ обходится и не ослабляется. Он считает
// неразобранные замечания сохранённой рецензии; когда последняя рецензия
// чистая, считать нечего — блокировать больше нечего. Отметки «разобрано»
// цикл не ставит: их ставит человек, и подделывать их машиной значило бы
// врать гейту вместо того, чтобы чинить кейс.
//
// ТРИ СТОП-УСЛОВИЯ, и каждое из них — про деньги и про качество сразу:
//
//   clean          — рецензент не нашёл замечаний. Обычный выход.
//   лимит кругов   — maxRounds (по умолчанию 3). Каждый круг это два вызова
//                    Opus с рассуждением; кейс, не сошедшийся за три круга,
//                    почти всегда упирается в спор по существу, а не в
//                    небрежность, и его должен читать врач.
//   нет прогресса  — замечаний не стало меньше. Значит редактор и рецензент
//                    разошлись во мнениях, и следующий круг будет топтанием:
//                    один правит обратно, другой снова возражает.
//   срок вышел      — deadlineAt. Круг стоит двух вызовов Opus с рассуждением,
//                    и цикл висит внутри HTTP-запроса: nginx рвёт соединение
//                    на 240 с (proxy_read_timeout), а работа при этом идёт
//                    дальше и молча доводится до конца. Пользователь видит
//                    «Network Error» на успешно опубликованном кейсе — худший
//                    из возможных сигналов. Поэтому цикл обязан успеть
//                    вернуться сам, а не быть оборванным снаружи.
//
// ВОЗВРАЩАЕТСЯ ЛУЧШИЙ ИЗ ВИДЕННЫХ вариантов, а не последний. Круг может
// ухудшить кейс (правка по спорному замечанию ломает то, что было верным), и
// отдавать заведомо худшую версию только потому, что она свежее, — плохой
// размен.
//
// ЧЕГО ЦИКЛ НЕ ДЕЛАЕТ. Редактор и рецензент — одна модель, их ошибки не
// независимы. Цикл вычищает внутренние противоречия (ради этого он и сделан),
// но общее для обоих заблуждение — правдоподобный неверный референс, ошибочная
// «типичная» картина — переживает любое число кругов. «Замечаний нет» здесь
// означает «противоречий не осталось», а не «кейс верен».

const DEFAULT_MAX_ROUNDS = 3;

const issueCount = (review) => review?.issues?.length ?? 0;

/**
 * ТОЧЕЧНАЯ ПРАВКА: один круг по заданному списку замечаний.
 *
 * Отдельная функция, а не режим цикла, из-за правила «возвращаем лучшую
 * версию». Оно меряет качество числом замечаний и для полного прохода верно, а
 * для точечной правки — ровно наоборот: автор просит исправить ОДНО замечание
 * из четырёх, после правки рецензент честно возвращает оставшиеся три, и цикл
 * счёл бы это ухудшением (1 → 3) и откатил сделанное. Автор нажал кнопку и не
 * увидел никаких изменений.
 *
 * Здесь результат правки принимается всегда: что править — решил человек.
 * Перепроверка при этом остаётся обязательной, потому что сохранённая рецензия
 * должна относиться к новой версии кейса, а не к той, которой уже нет.
 */
export async function runTargetedFix({ draft, issues, revise, verify }) {
  const usage = { inputTokens: 0, outputTokens: 0 };
  const revised = await revise(draft, issues);
  usage.inputTokens += revised.usage?.inputTokens ?? 0;
  usage.outputTokens += revised.usage?.outputTokens ?? 0;

  const review = await verify(revised.draft);
  usage.inputTokens += review.usage?.inputTokens ?? 0;
  usage.outputTokens += review.usage?.outputTokens ?? 0;

  return {
    draft: revised.draft,
    review,
    rounds: [
      {
        round: 1,
        issuesBefore: issues.length,
        issuesAfter: issueCount(review),
        verdict: review.verdict,
        changes: revised.changes ?? [],
        disputed: revised.disputed ?? [],
        summary: review.summary ?? "",
      },
    ],
    converged: issueCount(review) === 0,
    stoppedBy: "targeted",
    changes: revised.changes ?? [],
    disputed: revised.disputed ?? [],
    usage,
  };
}

/**
 * Довести черновик до чистой рецензии.
 *
 * @param {object}   args
 * @param {object}   args.draft    исходный черновик кейса
 * @param {object}   [args.review] уже посчитанная рецензия; нет — будет вызван verify
 * @param {(draft: object, issues: object[]) => Promise<object>} args.revise
 *        правка по замечаниям: возвращает { draft, changes, disputed }
 * @param {(draft: object) => Promise<object>} args.verify
 *        рецензия черновика: возвращает { verdict, issues, errorCount, summary }
 * @param {number}   [args.maxRounds]
 * @param {number}   [args.deadlineAt] Date.now()-метка, после которой новый
 *        круг не начинается. Уже начатый круг доводится до конца: бросать его
 *        значило бы заплатить за вызов модели и выкинуть ответ.
 * @returns {Promise<{
 *   draft: object, review: object, rounds: object[], converged: boolean,
 *   stoppedBy: "clean"|"max_rounds"|"no_progress"|"error",
 *   changes: object[], disputed: object[], usage: {inputTokens: number, outputTokens: number}
 * }>}
 */
export async function runAutoFix({
  draft,
  review = null,
  revise,
  verify,
  maxRounds = DEFAULT_MAX_ROUNDS,
  deadlineAt = null,
}) {
  const usage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (u) => {
    usage.inputTokens += u?.inputTokens ?? 0;
    usage.outputTokens += u?.outputTokens ?? 0;
  };

  // Стартовая рецензия. Её отсутствие — нормальный вход: автор мог нажать
  // «исправить» на кейсе, который ещё не проверялся.
  let currentReview = review;
  if (!currentReview) {
    currentReview = await verify(draft);
    addUsage(currentReview.usage);
  }

  let currentDraft = draft;
  // Лучший результат: с наименьшим числом замечаний. Правки к нему копим
  // отдельно — автор должен видеть, чем именно та версия отличается от его.
  let best = {
    draft: currentDraft,
    review: currentReview,
    changes: [],
    disputed: [],
    roundIndex: 0,
  };
  const rounds = [];
  let stoppedBy = "clean";

  for (let round = 1; round <= maxRounds; round += 1) {
    if (issueCount(currentReview) === 0) {
      stoppedBy = "clean";
      break;
    }
    if (deadlineAt && Date.now() >= deadlineAt) {
      stoppedBy = "deadline";
      break;
    }

    const before = issueCount(currentReview);
    let revised;
    let nextReview;
    try {
      revised = await revise(currentDraft, currentReview.issues);
      addUsage(revised.usage);
      nextReview = await verify(revised.draft);
      addUsage(nextReview.usage);
    } catch (err) {
      // Сбой модели в середине цикла не отменяет уже полученного: отдаём
      // лучший вариант и честно говорим, почему остановились. Первый круг —
      // исключение: там отдавать нечего, и ошибку должен увидеть автор.
      if (round === 1) throw err;
      stoppedBy = "error";
      rounds.push({ round, issuesBefore: before, error: err?.message ?? String(err) });
      break;
    }

    const after = issueCount(nextReview);
    rounds.push({
      round,
      issuesBefore: before,
      issuesAfter: after,
      verdict: nextReview.verdict,
      changes: revised.changes ?? [],
      disputed: revised.disputed ?? [],
      summary: nextReview.summary ?? "",
    });

    currentDraft = revised.draft;
    currentReview = nextReview;

    if (after < issueCount(best.review)) {
      best = {
        draft: currentDraft,
        review: currentReview,
        // Правки накапливаются от исходного черновика: до лучшей версии автор
        // дошёл через все предыдущие круги, и дифф должен покрывать их все.
        changes: [...best.changes, ...(revised.changes ?? [])],
        disputed: revised.disputed ?? [],
        roundIndex: round,
      };
    }

    if (after === 0) {
      stoppedBy = "clean";
      break;
    }
    if (after >= before) {
      // Топтание на месте: спор по существу, а не небрежность. Дальше круги
      // только жгут токены.
      stoppedBy = "no_progress";
      break;
    }
    if (round === maxRounds) stoppedBy = "max_rounds";
  }

  return {
    draft: best.draft,
    review: best.review,
    rounds,
    converged: issueCount(best.review) === 0,
    stoppedBy,
    changes: best.changes,
    // Несогласие показываем от круга, давшего лучший вариант: замечания
    // прошлых кругов уже исправлены, и их спор автору не нужен.
    disputed: best.disputed,
    usage,
  };
}
