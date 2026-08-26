// server/jobs/radiologyDailyCases.job.js
// ─────────────────────────────────────────────────────────────────────
//   Cron-задача: ночная автогенерация учебных кейсов «Диагностической арены».
//
//   Каждую ночь: по ОДНОМУ лучевому кейсу на каждую модальность с готовой
//   системой чтения (cxr, ct, mri, us, ecg) + по одному кейсу станций
//   «Анализы» и «Виртуальный пациент». Темы — из программы
//   modules/radiology/ai/dailyTopics.js, содержимое придумывает ИИ
//   (ai/caseGenerator.js), после чего кейс проверяется вторым проходом
//   (ai/caseVerifier.js) свежим контекстом.
//
//   ДВЕ РАЗНЫЕ СУДЬБЫ, И РАЗЛИЧИЕ ЗДЕСЬ НЕ ТЕХНИЧЕСКОЕ.
//
//   «Анализы» и «Виртуальный пациент» самодостаточны: изображение им не
//   нужно, пациента не существует, все данные вымышлены. Такой кейс машина
//   доводит до конца сама — при ЧИСТОЙ рецензии он публикуется, и публикация
//   тут же ставит в очередь перевод на остальные языки (scheduleCaseTranslation).
//   Есть хоть одно замечание — остаётся черновиком и ждёт человека; порог
//   намеренно строгий, потому что модель систематически занижает серьёзность
//   (см. комментарий в collectPublishBlockers).
//
//   ТРЕТИЙ ПРОХОД доводит кейс до этого порога, а не обходит его. Замечания
//   рецензента отдаются редактору (ai/caseReviser.js), исправленная версия
//   рецензируется заново, и так до чистой рецензии либо до потолка кругов
//   (ai/autoFix.js). В кейс ложится исправленная версия ВМЕСТЕ с рецензией на
//   неё же и следом правок (aiRevision) — чтобы человек, открывший кейс,
//   видел, что цифры менял не он и что именно менялось. Не сошлось за три
//   круга — обычный черновик с оставшимися замечаниями.
//
//   Лучевой кейс ложится ЧЕРНОВИКОМ и без снимка — всегда. Снимка у
//   автогенератора нет и быть не может: ИИ его не рисует, а публикация
//   требует настоящего кадра с подтверждённой деидентификацией. Ночь
//   приносит текстовую часть и ПЛАН находок: что на снимке должно быть и где
//   искать. Владелец открывает /admin/radiology, загружает анонимный снимок и
//   переносит находки из плана на холст одним кликом.
//
//   Галочку «снимки деидентифицированы» машина не ставит НИКОГДА. Это
//   утверждение о реальном изображении, которого в момент генерации не
//   существует: подписать его может только человек, который снимок видел.
//
//   ОГРАНИЧИТЕЛЬ ОЧЕРЕДИ. Если по модальности уже накопилось
//   RADIOLOGY_AUTOGEN_MAX_PENDING неразобранных автокейсов — генерация по
//   ней пропускается. Без этого месяц простоя дал бы полторы сотни
//   черновиков, разобрать которые никто не сможет, и счёт за токены за
//   работу, которая никому не пригодилась.
//
//   Настройки (.env; после правки — pm2 restart all --update-env):
//     RADIOLOGY_AUTOGEN=off            полностью выключить автогенерацию
//     RADIOLOGY_AUTOGEN_PUBLISH=off    не публиковать автоматически (всё в черновики)
//     RADIOLOGY_AUTOGEN_AUTOFIX=off    не править кейс по замечаниям третьим проходом
//     RADIOLOGY_AUTOGEN_CRON="20 2 * * *"   расписание (по умолчанию 02:20 UTC)
//     RADIOLOGY_AUTOGEN_MAX_PENDING=6  потолок неразобранных автокейсов на станцию
//     RADIOLOGY_AUTOGEN_GAP_MS=2000    пауза между станциями
//
//   Подключение в index.js:
//     import { scheduleDailyCaseGeneration } from "./jobs/radiologyDailyCases.job.js";
//     scheduleDailyCaseGeneration();
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import User from "../common/models/Auth/users.js";
import RadiologyCase from "../modules/radiology/radiology-cases/models/radiologyCase.model.js";
import LabCase from "../modules/radiology/labs-station/models/labCase.model.js";
import VirtualPatientCase from "../modules/radiology/virtual-patient/models/vpCase.model.js";
import { createCase } from "../modules/radiology/radiology-cases/services/case.service.js";
import { createLabCase, setLabStatus } from "../modules/radiology/labs-station/lab.service.js";
import { createVpCase, setVpStatus } from "../modules/radiology/virtual-patient/vp.service.js";
import {
  generateRadiologyCase,
  generateLabCase,
  generateVpCase,
  isConfigured,
} from "../modules/radiology/ai/caseGenerator.js";
import { findCaseImageSources } from "../modules/radiology/ai/imageSourceFinder.js";
import {
  isAutogenAllowedByStore,
  setAutogenAllowed,
} from "../modules/radiology/radiology-cases/models/autogenSetting.model.js";
import {
  verifyRadiologyCase,
  verifyLabCase,
  verifyVpCase,
} from "../modules/radiology/ai/caseVerifier.js";
import {
  reviseRadiologyCase,
  reviseLabCase,
  reviseVpCase,
} from "../modules/radiology/ai/caseReviser.js";
import { runAutoFix } from "../modules/radiology/ai/autoFix.js";
import { MODEL } from "../modules/radiology/ai/aiRunner.js";
import { applyRadiologyAiRevision } from "../modules/radiology/radiology-cases/services/case.service.js";
import { applyLabAiRevision } from "../modules/radiology/labs-station/lab.service.js";
import { applyVpAiRevision } from "../modules/radiology/virtual-patient/vp.service.js";
import { saveAiReview } from "../modules/radiology/ai/aiReviewStore.js";
import { listReadingSystems } from "../modules/radiology/reading-systems/index.js";
import { pickTopic } from "../modules/radiology/ai/dailyTopics.js";

const DEFAULT_CRON = "20 2 * * *"; // 02:20 UTC — заведомо вне часов пик
const DEFAULT_MAX_PENDING = 6;
const DEFAULT_GAP_MS = 2000;

export function isAutogenEnabled() {
  return String(process.env.RADIOLOGY_AUTOGEN ?? "").trim().toLowerCase() !== "off";
}

// Искать ли снимки-кандидаты сразу при генерации лучевого кейса.
//
// Включено по умолчанию: без ссылок автор получает текст, к которому нечем
// приложить кадр, — ровно та причина, по которой черновики копились
// неразобранными. Выключатель нужен, потому что это лишний вызов модели с
// веб-поиском на каждый кейс: если счёт окажется заметным, поиск можно
// оставить только ручной кнопкой в админке.
function findImagesEnabled() {
  return (
    String(process.env.RADIOLOGY_AUTOGEN_FIND_IMAGES ?? "").trim().toLowerCase() !== "off"
  );
}

// Автопубликация станций без снимков. Включена по умолчанию: там кейс
// самодостаточен, а «ждать человека» означало бы, что арена не наполняется.
// Выключатель нужен на случай, если качество разъедется.
function isAutoPublishEnabled() {
  return String(process.env.RADIOLOGY_AUTOGEN_PUBLISH ?? "").trim().toLowerCase() !== "off";
}

// Третий проход: машина правит кейс по замечаниям рецензента и перепроверяет
// себя (modules/radiology/ai/autoFix.js). Включён по умолчанию — без него
// почти любое замечание означало черновик, ждущий человека, и порог «ни одного
// замечания» делал автопубликацию редкой.
//
// Цена: каждый круг — два вызова Opus с рассуждением поверх генерации. Отсюда
// выключатель: если счёт окажется заметнее пользы, ночь вернётся к прежнему
// поведению «есть замечания — черновик».
function isAutoFixEnabled() {
  return String(process.env.RADIOLOGY_AUTOGEN_AUTOFIX ?? "").trim().toLowerCase() !== "off";
}

// Ключ показателя/обследования для кейсов, которые собирает машина. Модель
// отдаёт только названия, а модели данных требуют стабильный ключ: на него
// ссылаются эталон (significantAbnormal / necessary), варианты и разбор.
// Ключ должен быть детерминированным в пределах кейса и не зависеть от
// текста — иначе правка названия рассогласовала бы эталон.
const rowKey = (prefix, index) => `${prefix}${index + 1}`;

function maxPending() {
  const n = Number(process.env.RADIOLOGY_AUTOGEN_MAX_PENDING);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_MAX_PENDING;
}

function gapMs() {
  const n = Number(process.env.RADIOLOGY_AUTOGEN_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_GAP_MS;
}

// Автор автокейсов. У cron-задачи нет сессии, а createdBy у кейса —
// ссылка на реального человека: пишем туда старшего админа, чтобы в карточке
// было видно ответственного, а не пустое поле. Админа нет (свежая база,
// тесты) — createdBy останется null, модель это допускает.
async function systemAuthorId() {
  const admin = await User.findOne({ role: "admin", isDeleted: { $ne: true } })
    .select("_id")
    .sort({ createdAt: 1 })
    .lean();
  return admin?._id ?? null;
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// Подсказка модели на втором круге программы: без неё повтор темы дал бы
// практически тот же кейс.
const REPEAT_HINT =
  "Эта тема уже разбиралась. Возьми другой клинический сценарий: другой возраст, пол, повод обращения и иной набор сопутствующих данных.";

// ─── Станции ─────────────────────────────────────────────────────────
//
// Каждая станция описана одинаково: где считать очередь, как сгенерировать,
// как проверить вторым проходом и можно ли публиковать без человека.
// Различие между ними ровно одно и оно принципиальное: лучевой кейс без
// снимка опубликовать нельзя, а «Анализы» и «Виртуальный пациент» —
// самодостаточны, у них и поля «деидентифицирован» нет, потому что нет ни
// снимка, ни пациента: данные вымышлены от начала до конца.

const STATIONS = {
  radiology: {
    label: "снимки",
    Model: RadiologyCase,
    // Публикация требует настоящего кадра — его загружает человек.
    canAutoPublish: false,
    async generate(topic, { modality }) {
      return generateRadiologyCase({
        modality,
        topic: topic.topic,
        difficulty: topic.difficulty,
        hint: topic.repeat ? REPEAT_HINT : undefined,
      });
    },
    async create(draft, topic, { modality, authorId, now }) {
      // ПОИСК СНИМКА СРАЗУ ПОСЛЕ ГЕНЕРАЦИИ.
      //
      // Кейс придуман по теме, изображения не существует — и автор оставался
      // с готовым текстом, не зная, где взять кадр. Ссылки ищутся здесь же и
      // ложатся в черновик: открыл кейс — увидел кандидатов.
      //
      // Отказ поиска НЕ роняет создание кейса: кейс без ссылок хуже кейса со
      // ссылками, но несравнимо лучше, чем ничего.
      let imageSources = [];
      let imageSearchAdvice = "";
      if (findImagesEnabled()) {
        try {
          const found = await findCaseImageSources({
            topic: draft.title || topic.topic,
            modality,
          });
          imageSources = found.sources;
          imageSearchAdvice = found.advice;
          console.log(`   🔎 снимков-кандидатов найдено: ${imageSources.length}`);
        } catch (err) {
          console.warn(`   ⚠️ поиск снимков не удался: ${err?.message ?? err}`);
        }
      }

      return createCase(
        {
          modality,
          title: draft.title || topic.topic,
          clinicalContext: draft.clinicalContext,
          difficulty: draft.difficulty || topic.difficulty,
          // Снимка нет — его добавит человек. Гейт публикации это и стережёт.
          images: [],
          findings: [],
          plannedFindings: draft.plannedFindings,
          impression: draft.impression,
          source: { kind: "ai_generated" },
          // Деидентификацию подтверждает только человек и только по снимку.
          deidentified: false,
          tags: ["auto", `auto:${topic.key}`],
          autoGen: autoGenField(topic, draft, now),
          imageSources,
          imageSearchAdvice,
          imageSearchAt: imageSources.length ? now : null,
        },
        authorId,
        "system",
      );
    },
    verify: (draft, { modality }) =>
      verifyRadiologyCase({ modality, draft: { ...draft, plannedFindings: draft.plannedFindings ?? [] } }),
    // ТРЕТИЙ ПРОХОД и у лучевой станции. Публиковать её кейсы машина
    // по-прежнему не может (canAutoPublish: false — кадра не существует), но
    // это не причина оставлять текст неисправленным: к автору черновик должен
    // приезжать с разобранными противоречиями, а не с двумя абзацами замечаний
    // поверх кейса, которые ему предстоит вычитывать вручную.
    //
    // Правится только текст: applyRadiologyAiRevision не трогает координаты
    // находок, кадры и галочку деидентификации. Ночью размеченных находок и
    // нет — кейс состоит из плана и заключения, ровно того, что редактор
    // править вправе.
    //
    // Перепроверка здесь идёт БЕЗ снимка: его ещё не существует. Взгляд на
    // кадр добавится позже, когда автор загрузит его и нажмёт «Запустить
    // агента» (ai/caseAgent.js) — там рецензент сверит текст с изображением.
    revise: (draft, issues, { modality }) =>
      reviseRadiologyCase({ draft, issues, modality }),
    applyRevision: (caseId, draft, meta) =>
      applyRadiologyAiRevision(caseId, draft, meta),
    detail: (draft) => ({ plannedFindings: draft.plannedFindings?.length ?? 0 }),
  },

  labs: {
    label: "анализы",
    Model: LabCase,
    canAutoPublish: true,
    generate: (topic) =>
      generateLabCase({
        topic: topic.topic,
        difficulty: topic.difficulty,
        hint: topic.repeat ? REPEAT_HINT : undefined,
      }),
    async create(draft, topic, { authorId, now }) {
      // Модель отдаёт панель без ключей — присваиваем их здесь, ровно так же,
      // как это делает форма в админке. Эталон significantAbnormal строится
      // из флага significant: список ключей, которые врач обязан отметить.
      const panel = (draft.panel ?? []).map((p, i) => ({
        key: rowKey("p", i),
        name: p.name,
        value: p.value,
        unit: p.unit ?? "",
        refRange: p.refRange ?? "",
      }));
      const significantAbnormal = (draft.panel ?? [])
        .map((p, i) => (p.significant ? rowKey("p", i) : null))
        .filter(Boolean);

      return createLabCase(
        {
          title: draft.title || topic.topic,
          clinicalContext: draft.clinicalContext,
          difficulty: draft.difficulty || topic.difficulty,
          panel,
          significantAbnormal,
          impression: draft.impression,
          source: { kind: "ai_generated" },
          autoGen: autoGenField(topic, draft, now),
        },
        authorId,
        "system",
      );
    },
    verify: (draft) => verifyLabCase({ draft }),
    // Третий проход: правка по замечаниям и запись исправленной версии в уже
    // созданный черновик. applyLabAiRevision сам восстанавливает ключи
    // показателей по названиям — эталон и варианты не должны разъехаться.
    revise: (draft, issues) => reviseLabCase({ draft, issues }),
    applyRevision: (caseId, draft, meta) => applyLabAiRevision(caseId, draft, meta),
    publish: (caseId, authorId) => setLabStatus(caseId, "published", authorId, "system"),
    detail: (draft) => ({
      panel: draft.panel?.length ?? 0,
      significant: (draft.panel ?? []).filter((p) => p.significant).length,
    }),
  },

  vp: {
    label: "виртуальный пациент",
    Model: VirtualPatientCase,
    canAutoPublish: true,
    generate: (topic) =>
      generateVpCase({
        topic: topic.topic,
        difficulty: topic.difficulty,
        hint: topic.repeat ? REPEAT_HINT : undefined,
      }),
    async create(draft, topic, { authorId, now }) {
      const investigations = (draft.investigations ?? []).map((inv, i) => ({
        key: rowKey("i", i),
        name: inv.name,
        category: inv.category ?? "",
        resultText: inv.resultText ?? "",
        necessary: Boolean(inv.necessary),
      }));

      return createVpCase(
        {
          title: draft.title || topic.topic,
          presentation: draft.presentation,
          difficulty: draft.difficulty || topic.difficulty,
          investigations,
          diagnosis: draft.diagnosis,
          source: { kind: "ai_generated" },
          autoGen: autoGenField(topic, draft, now),
        },
        authorId,
        "system",
      );
    },
    verify: (draft) => verifyVpCase({ draft }),
    revise: (draft, issues) => reviseVpCase({ draft, issues }),
    applyRevision: (caseId, draft, meta) => applyVpAiRevision(caseId, draft, meta),
    publish: (caseId, authorId) => setVpStatus(caseId, "published", authorId, "system"),
    detail: (draft) => ({
      investigations: draft.investigations?.length ?? 0,
      necessary: (draft.investigations ?? []).filter((i) => i.necessary).length,
    }),
  },
};

function autoGenField(topic, draft, now) {
  return {
    isAuto: true,
    topicKey: topic.key,
    generatedAt: now,
    model: draft.model ?? "",
    autoPublished: false,
  };
}

/**
 * Одна единица работы: сгенерировать кейс, проверить вторым проходом и —
 * если станция это позволяет и замечаний нет — опубликовать.
 *
 * Порядок «создать, потом проверить» выбран намеренно: рецензия сохраняется
 * В КЕЙС, и её замечания сами становятся блокировщиком публикации
 * (unresolvedAiIssues в гейте). Проверяй мы до сохранения — замечания жили бы
 * только в логе, и человек, открывший черновик, их бы не увидел.
 */
async function generateOne({ station, topicKey: poolKey, modality, authorId, now, limit }) {
  const cfg = STATIONS[station];
  const scope = modality ? { modality, "autoGen.isAuto": true } : { "autoGen.isAuto": true };

  // Очередь неразобранных. Для станций с автопубликацией она почти всегда
  // пуста — тем ценнее ограничитель, если качество вдруг просядет и черновики
  // начнут копиться.
  const pending = await cfg.Model.countDocuments({
    ...scope,
    status: { $in: ["draft", "rejected"] },
  });
  if (pending >= limit) {
    return { skipped: `в работе уже ${pending} автокейсов` };
  }

  // Разобранные темы берём по ВСЕМ статусам, включая архив: тема, которую
  // однажды забраковали, вернётся только на втором круге.
  const usedKeys = await cfg.Model.distinct("autoGen.topicKey", scope);
  const totalAuto = await cfg.Model.countDocuments(scope);

  const topic = pickTopic(poolKey, usedKeys, totalAuto);
  if (!topic) return { skipped: "нет тем в программе" };

  const ctx = { modality, authorId, now };
  const draft = await cfg.generate(topic, ctx);
  const doc = await cfg.create(draft, topic, ctx);

  // Второй проход. Его отказ не отменяет уже созданный черновик: кейс есть,
  // просто он не будет опубликован автоматически и подождёт человека.
  let review = null;
  try {
    review = await cfg.verify(draft, ctx);
    await saveAiReview({ CaseModel: cfg.Model, caseId: doc._id, review });
  } catch (err) {
    console.error(`⚠️  Автокейс [${station}]: рецензия не выполнена:`, err?.message ?? err);
  }

  // ТРЕТИЙ ПРОХОД: машина правит себя по замечаниям.
  //
  // Порог публикации остаётся прежним — «ни одного замечания», — но теперь
  // кейс до него доводится, а не отбраковывается на первом же придирчивом
  // пункте. Правки ложатся в уже созданный черновик, и рецензия в кейсе
  // заменяется на ту, что относится к исправленной версии: иначе человек
  // открыл бы кейс с одними цифрами и замечаниями к другим.
  //
  // Отказ третьего прохода ничего не ломает: остаётся черновик с исходными
  // замечаниями — ровно то, что было до появления автоправки.
  let revision = null;
  if (review?.issues?.length && cfg.revise && isAutoFixEnabled()) {
    try {
      revision = await runAutoFix({
        draft,
        review,
        revise: (current, issues) => cfg.revise(current, issues, ctx),
        verify: (current) => cfg.verify(current, ctx),
      });
      await cfg.applyRevision(doc._id, revision.draft, {
        rounds: revision.rounds.length,
        stoppedBy: revision.stoppedBy,
        converged: revision.converged,
        changes: revision.changes,
        disputed: revision.disputed,
        model: MODEL,
      });
      await saveAiReview({ CaseModel: cfg.Model, caseId: doc._id, review: revision.review });
      review = revision.review;
      console.log(
        `   🛠 автоправка [${station}]: кругов ${revision.rounds.length}, замечаний осталось ${
          review.issues.length
        } (${revision.stoppedBy})`,
      );
    } catch (err) {
      console.error(`⚠️  Автокейс [${station}]: автоправка не выполнена:`, err?.message ?? err);
    }
  }

  // Публикуем только станции без снимков и только при чистой рецензии.
  // «Есть хоть одно замечание» — намеренно строгий порог: калибровка
  // показала, что модель систематически ЗАНИЖАЕТ серьёзность, поэтому
  // делить замечания на «блокирующие» и «терпимые» здесь нельзя.
  let published = false;
  if (
    cfg.canAutoPublish &&
    isAutoPublishEnabled() &&
    review &&
    review.verdict === "clean" &&
    review.issues.length === 0
  ) {
    // Публикация проходит ТОТ ЖЕ гейт, что и ручная (collectLabBlockers /
    // collectVpBlockers), и она же запускает перевод на остальные языки.
    await cfg.publish(doc._id, authorId);
    await cfg.Model.updateOne({ _id: doc._id }, { $set: { "autoGen.autoPublished": true } });
    published = true;
  }

  return {
    created: {
      station,
      modality,
      caseId: String(doc._id),
      topicKey: topic.key,
      title: doc.title,
      published,
      issues: review?.issues?.length ?? null,
      // Кругов автоправки: 0 означает «вышло чисто с первого раза» и это не то
      // же самое, что «правки не потребовались, потому что их отключили» —
      // отсюда отдельное null при выключенном третьем проходе.
      fixRounds: revision ? revision.rounds.length : null,
      // Детали считаем по ТОЙ версии, которая легла в базу: после правки
      // панель может стать другой, и цифра из исходного черновика вводила бы
      // в заблуждение при разборе ночного прогона.
      ...cfg.detail(revision?.draft ?? draft),
    },
  };
}

/**
 * Один прогон автогенерации: по кейсу на каждую модальность лучевой станции
 * плюс по кейсу на «Анализы» и «Виртуального пациента».
 *
 * Ошибка одной станции НЕ останавливает остальные: отказ модели на
 * «травматическом пневмотораксе» не должен стоить сети кейса по ЭКГ.
 *
 * @param {object} [opts]
 * @param {Date}   [opts.now]        отметка времени (в тестах — фиксированная)
 * @param {string[]} [opts.modalities] переопределение списка модальностей
 * @param {string[]} [opts.stations]   какие станции без снимков включать
 * @param {object} [opts.sink]       объект-накопитель: заполняется ПО ХОДУ работы,
 *                                   чтобы админка видела прогресс, а не только итог
 * @returns {Promise<{created: object[], skipped: object[], failed: object[]}>}
 */
export async function runDailyCaseGeneration({
  now = new Date(),
  modalities,
  stations = ["labs", "vp"],
  sink,
} = {}) {
  const result = sink ?? {};
  result.created ??= [];
  result.skipped ??= [];
  result.failed ??= [];

  if (!isAutogenEnabled()) {
    console.log("🤖 Автокейсы арены: выключены (RADIOLOGY_AUTOGEN=off)");
    return result;
  }
  // Выключатель из админки. Проверяется ЗДЕСЬ, при каждом прогоне, а не при
  // регистрации cron: иначе выключение требовало бы перезапуска сервера — то
  // самое, от чего кнопка и избавляет.
  if (!(await isAutogenAllowedByStore())) {
    console.log("🤖 Автокейсы арены: выключены владельцем в админке");
    result.disabled = true;
    return result;
  }
  if (!isConfigured()) {
    console.log("🤖 Автокейсы арены: ИИ не настроен (нет ANTHROPIC_API_KEY) — пропуск");
    return result;
  }

  const modalityList = modalities ?? listReadingSystems().map((s) => s.modality);
  const authorId = await systemAuthorId();
  const limit = maxPending();

  // План работ: лучевые модальности + станции без снимков. Порядок такой,
  // чтобы при обрыве прогона в первую очередь были сделаны лучевые кейсы —
  // те, что дольше всего ждут человека.
  const plan = [
    ...modalityList.map((modality) => ({
      station: "radiology",
      topicKey: modality,
      modality,
      name: modality,
    })),
    ...stations.map((station) => ({ station, topicKey: station, name: station })),
  ];

  for (const item of plan) {
    // ОСТАНОВКА ПО ПРОСЬБЕ ВЛАДЕЛЬЦА — между пунктами плана, а не внутри.
    //
    // Прервать на середине запроса к модели нельзя без потерь: ответ уже
    // оплачен, а кейс из него ещё не собран. Между пунктами прогон рвётся
    // чисто — сделанное сохранено, несделанное просто не начато.
    if (stopRequested) {
      result.stopped = true;
      const left = plan.length - plan.indexOf(item);
      console.log(`🛑 Автокейсы арены: остановлено владельцем, не начато пунктов: ${left}`);
      break;
    }

    try {
      const out = await generateOne({ ...item, authorId, now, limit });
      if (out.skipped) {
        result.skipped.push({ modality: item.name, station: item.station, reason: out.skipped });
      } else {
        result.created.push(out.created);
        const c = out.created;
        console.log(
          `🤖 Автокейс [${item.name}] «${c.title}» — ${c.published ? "ОПУБЛИКОВАН" : "черновик"}` +
            (c.issues ? `, замечаний рецензента: ${c.issues}` : ""),
        );
      }
    } catch (err) {
      result.failed.push({
        modality: item.name,
        station: item.station,
        message: err?.message ?? String(err),
      });
      console.error(`❌ Автокейс [${item.name}] не создан:`, err?.message ?? err);
    }

    await sleep(gapMs());
  }

  const publishedCount = result.created.filter((c) => c.published).length;
  console.log(
    `🤖 Автокейсы арены: создано ${result.created.length} (опубликовано сразу ${publishedCount}), пропущено ${result.skipped.length}, ошибок ${result.failed.length}`,
  );
  return result;
}

// ─── Фоновый запуск и его состояние ──────────────────────────────────
//
// Прогон идёт минуты: пять модальностей, каждая — отдельный запрос к модели с
// рассуждением. Держать на нём HTTP-соединение нельзя: nginx перед сервером
// рвёт ответ раньше (proxy_read_timeout), и админка получала бы таймаут при
// том, что кейсы на самом деле создаются. Поэтому кнопка в админке ЗАПУСКАЕТ
// работу и сразу отвечает, а результат забирается отдельным запросом.
//
// Состояние в памяти процесса — этого достаточно: прогон не переживает
// перезапуск сервера по определению, а cron заведёт новый следующей ночью.
let running = false;
let lastRun = null;
let stopRequested = false;
let runningScope = null;

/**
 * РАЗДЕЛЫ ГЕНЕРАЦИИ.
 *
 * Кнопка «сгенерировать всё» есть, но нужна не всегда: снимки требуют от
 * автора работы с холстом, а анализы и виртуальный пациент доходят до
 * публикации сами. Держать про запас двадцать неразобранных лучевых
 * черновиков ради двух готовых лабораторных — плохой размен, поэтому
 * разделы запускаются и останавливаются по отдельности.
 */
export const AUTOGEN_SCOPES = {
  all: { stations: ["labs", "vp"], modalities: undefined, title: "все разделы" },
  // modalities: [] — ни одной лучевой модальности в плане.
  labs: { stations: ["labs"], modalities: [], title: "анализы" },
  vp: { stations: ["vp"], modalities: [], title: "виртуальный пациент" },
  // stations: [] — только лучевые модальности, без станций без снимков.
  radiology: { stations: [], modalities: undefined, title: "снимки" },
};

/** Состояние автогенерации для админки. */
export function getAutogenState() {
  return {
    running,
    enabled: isAutogenEnabled(),
    lastRun,
    // Что именно идёт сейчас: админка подсвечивает кнопку своего раздела, а
    // не все сразу.
    scope: runningScope,
    // Остановка запрошена, но текущий пункт ещё доделывается. Без этого
    // признака кнопка выглядит нажатой впустую: прогон продолжает идти.
    stopping: running && stopRequested,
  };
}

/**
 * Попросить прогон остановиться.
 *
 * Именно попросить: прогон прервётся на границе пунктов плана, доделав
 * начатый. Мгновенно оборвать нельзя — ответ модели уже оплачен, и бросать
 * его на полпути значит платить и не получать ничего.
 */
export function stopDailyCaseGeneration() {
  if (running) stopRequested = true;
  return getAutogenState();
}

/**
 * Полное состояние для админки: к состоянию прогона добавляется хранимый
 * выключатель ночной генерации.
 *
 * Разделены намеренно: «остановить идущий прогон» и «не запускать ночью» —
 * разные действия, и путать их нельзя. Первое разовое, второе действует, пока
 * его не отменят.
 */
export async function getAutogenFullState() {
  const state = getAutogenState();
  return {
    ...state,
    // Жёсткий выключатель из .env: если он выключен, кнопка в админке ничего
    // не решает, и владелец должен это видеть, а не гадать.
    envEnabled: isAutogenEnabled(),
    nightlyEnabled: await isAutogenAllowedByStore(),
  };
}

/**
 * Включить или выключить НОЧНУЮ генерацию.
 *
 * Идущий прогон это не трогает: чтобы прервать его, есть отдельная кнопка.
 * Выключение действует до тех пор, пока владелец не включит обратно, и
 * переживает перезапуск сервера — иначе выключенная вечером генерация сама
 * ожила бы ночью после любого рестарта.
 */
export async function setNightlyAutogen(enabled, actorId = null) {
  const value = await setAutogenAllowed(enabled, actorId);
  console.log(`🤖 Автокейсы арены: ночная генерация ${value ? "ВКЛЮЧЕНА" : "ВЫКЛЮЧЕНА"} владельцем`);
  return getAutogenFullState();
}

/**
 * Запустить прогон в фоне и сразу вернуть состояние.
 *
 * Повторный вызов во время работы НЕ запускает второй прогон: иначе двойной
 * клик (или совпадение ручного запуска с ночным) удвоил бы и счёт за токены,
 * и число черновиков.
 */
export function startDailyCaseGeneration({ scope = "all" } = {}) {
  if (running) return getAutogenState();

  const plan = AUTOGEN_SCOPES[scope] ?? AUTOGEN_SCOPES.all;

  running = true;
  stopRequested = false;
  runningScope = AUTOGEN_SCOPES[scope] ? scope : "all";
  const startedAt = new Date();
  lastRun = {
    startedAt,
    finishedAt: null,
    scope: runningScope,
    created: [],
    skipped: [],
    failed: [],
    stopped: false,
    error: null,
  };

  // Намеренно без await: вызывающий код не ждёт окончания. lastRun передан
  // накопителем — он наполняется по мере готовности модальностей, и опрос из
  // админки показывает движение, а не пустоту до самого конца.
  runDailyCaseGeneration({
    now: startedAt,
    sink: lastRun,
    stations: plan.stations,
    modalities: plan.modalities,
  })
    .then(() => {
      lastRun.finishedAt = new Date();
    })
    .catch((err) => {
      lastRun.error = err?.message ?? String(err);
      lastRun.finishedAt = new Date();
      console.error("❌ Автокейсы арены: прогон упал:", err);
    })
    .finally(() => {
      running = false;
      stopRequested = false;
      runningScope = null;
    });

  return getAutogenState();
}

export function scheduleDailyCaseGeneration() {
  if (!isAutogenEnabled()) {
    console.log("⏰ Автокейсы арены: cron НЕ активен (RADIOLOGY_AUTOGEN=off)");
    return;
  }
  const expression = process.env.RADIOLOGY_AUTOGEN_CRON || DEFAULT_CRON;
  if (!cron.validate(expression)) {
    // Кривое выражение из .env иначе уронило бы старт всего сервера.
    console.error(
      `❌ Автокейсы арены: некорректное RADIOLOGY_AUTOGEN_CRON="${expression}" — cron не запущен`,
    );
    return;
  }
  // Через тот же вход, что и кнопка в админке: если владелец запустил прогон
  // руками за минуту до расписания, ночной не станет вторым параллельным.
  cron.schedule(expression, () => {
    startDailyCaseGeneration();
  });
  console.log(`⏰ Автокейсы арены: cron активен (${expression} UTC)`);
}
