// server/modules/radiology/radiology-attempts/services/impressionGrader.js
//
// Оценка СВОБОДНОГО текста заключения — вторая половина гибридного
// скоринга. Устроена как реестр экстракторов education: бэкенд выбирается
// через env, по умолчанию — детерминированная эвристика (работает без
// ключей и внешних вызовов).
//
//   RADIOLOGY_IMPRESSION_GRADER = heuristic | claude   (по умолчанию heuristic)
//
// Почему heuristic по умолчанию: гибрид должен работать «из коробки» и в
// тестах, без обязательного ANTHROPIC_API_KEY и без похода во внешний
// сервис. claude — осознанное включение, точнее, но платно и вовне.
//
// Возвращает { score: 0..1, rationale, grader } либо null, если оценивать
// нечего (нет текста заключения или у кейса нет эталона для сверки).

function tokenize(text) {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3),
  );
}

// Эвристика: перекрытие с образцовым заключением + попадание в синонимы
// диагноза. Груба намеренно — это разумный костяк, который claude потом
// заменяет, не меняя контракт вызывающего кода.
function heuristicGrade({ impressionText, correctText, diagnosisSynonyms }) {
  const learner = tokenize(impressionText);
  if (learner.size === 0) return null;

  const answer = tokenize(correctText);
  let overlap = 0;
  if (answer.size > 0) {
    let hit = 0;
    for (const w of answer) if (learner.has(w)) hit += 1;
    overlap = hit / answer.size;
  }

  const synonyms = (diagnosisSynonyms ?? []).map((s) => s.toLowerCase());
  const learnerText = String(impressionText ?? "").toLowerCase();
  const diagnosisHit = synonyms.some((s) => s && learnerText.includes(s));

  // Без эталона (ни текста-образца, ни синонимов) объективно оценивать
  // нечего — не выдумываем балл.
  if (answer.size === 0 && synonyms.length === 0) return null;

  const score = Math.max(
    0,
    Math.min(1, 0.5 * overlap + 0.5 * (diagnosisHit ? 1 : 0)),
  );
  const rationale = diagnosisHit
    ? "Заключение упоминает верный диагноз; совпадение формулировок с эталоном учтено."
    : "Верный диагноз в заключении явно не назван; оценка по совпадению формулировок с эталоном.";
  return { score, rationale, grader: "heuristic" };
}

/**
 * @param {object} args
 * @param {string} args.impressionText  свободный текст учащегося
 * @param {string} args.correctText     образцовое заключение из кейса
 * @param {string[]} args.diagnosisSynonyms  синонимы верного диагноза
 * @returns {Promise<{score:number,rationale:string,grader:string}|null>}
 */
export async function gradeImpression(args) {
  const backend = process.env.RADIOLOGY_IMPRESSION_GRADER || "heuristic";

  if (backend === "claude") {
    // Точка расширения: здесь подключается тот же Anthropic-конвейер, что
    // и education-ingest (structured outputs, системная инструкция-рубрика).
    // Пока ключ/реализации нет — молча падаем на эвристику, чтобы гибрид не
    // ломался из-за ненастроенного окружения. Это осознанный откат, а не
    // ошибка: оценка всё равно будет, просто грубее.
    // TODO(radiology): claudeGrade(args) через common Anthropic client.
    return heuristicGrade(args);
  }

  return heuristicGrade(args);
}
