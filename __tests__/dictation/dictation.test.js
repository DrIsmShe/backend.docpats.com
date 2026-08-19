// __tests__/dictation/dictation.test.js
//
// Голосовая надиктовка: полный путь от аудио до черновика в карте.
//
// Внешние сервисы замоканы целиком — тест проверяет обвязку (очередь,
// атомарный захват, границы владения, маппинг в карту, ретеншн), а не
// качество распознавания и не медицинскую осмысленность текста. Реальные
// вызовы стоили бы денег и зависели бы от сети.
//
// Отдельно и подробно проверяется главное свойство модуля: в карту не
// попадает ничего, чего не было в надиктовке.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const transcribeMock = vi.fn();
const structureMock = vi.fn();
const uploadFileMock = vi.fn(async () => "https://r2.test/audio/x.webm");
const deleteFileMock = vi.fn(async () => true);

// Подменяем только сетевой вызов. cleanTranscript берём настоящий — постфильтр
// артефактов тишины проверяется тут же и мокать его было бы бессмысленно.
vi.mock("../../modules/dictation/providers/stt.provider.js", async (orig) => ({
  ...(await orig()),
  isConfigured: () => true,
  transcribe: (...args) => transcribeMock(...args),
}));

// Хранилище аудио — внешняя зависимость, в тесте сети нет.
vi.mock("../../modules/dictation/providers/audio.store.js", () => ({
  fetchAudio: async () => Buffer.from("fake-audio"),
}));

vi.mock("../../modules/dictation/providers/structure.provider.js", () => ({
  isConfigured: () => true,
  structure: (...args) => structureMock(...args),
}));

// Хранилище файлов: тест не должен ходить в R2 и не должен зависеть от
// наличия ключей. uploadMiddleware тянет sharp и AWS SDK — мокаем целиком.
vi.mock("../../common/middlewares/uploadMiddleware.js", () => ({
  upload: { single: () => (req, res, next) => next() },
  processFiles: (req, res, next) => next(),
  resizeImage: (req, res, next) => next(),
  uploadFile: (...args) => uploadFileMock(...args),
  deleteFile: (...args) => deleteFileMock(...args),
}));

import DictationJob from "../../modules/dictation/dictation.model.js";
import newPatientMedicalHistoryModel from "../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import * as service from "../../modules/dictation/dictation.service.js";
import { getSink, hasSink, listSinks } from "../../modules/dictation/sinks/index.js";
import {
  cleanTranscript,
  isPromptEcho,
} from "../../modules/dictation/providers/stt.provider.js";
import MedicalCode, {
  CODE_SYSTEMS,
  normalizeCode,
  buildSearchText,
} from "../../modules/medicalCodes/models/medicalCode.model.js";
import { resetSearchStrategy } from "../../modules/medicalCodes/services/codeSearch.service.js";

const DOCTOR = new mongoose.Types.ObjectId();
const PATIENT = new mongoose.Types.ObjectId();

const PATIENT_REF = {
  patientType: "private",
  patientRef: PATIENT,
  patientTypeModel: "DoctorPrivatePatient",
};

const FULL_DRAFT = {
  complaints: "Боль в правом подреберье третьи сутки",
  anamnesisMorbi: "Началось после погрешности в диете",
  anamnesisVitae: "Аллергий нет со слов пациента",
  statusPreasens: "Состояние удовлетворительное, температура 36.8",
  statusLocalis: "Живот мягкий, болезненный в правом подреберье",
  mainDiagnosisText: "Острый холецистит",
  mainDiagnosisCode: "K81.0",
  recommendations: "УЗИ органов брюшной полости, контроль через 3 дня",
  ctScanResults: null,
  mriResults: null,
  ultrasoundResults: null,
  laboratoryTestResults: "Лейкоциты 12.4",
};

async function makeJob(over = {}) {
  return DictationJob.create({
    doctorId: DOCTOR,
    ...PATIENT_REF,
    audioUrl: "https://r2.test/audio/x.webm",
    status: "uploaded",
    ...over,
  });
}

/** Прогоняет задание через обе стадии воркера. */
async function runToDraft() {
  await service.processNext(); // распознавание
  await service.processNext(); // структурирование
}

beforeEach(() => {
  transcribeMock.mockReset();
  structureMock.mockReset();
  uploadFileMock.mockClear();
  deleteFileMock.mockClear();

  transcribeMock.mockResolvedValue({
    text: "Пациент жалуется на боль в правом подреберье третьи сутки...",
    model: "whisper-test",
    durationSec: 95,
  });
  structureMock.mockResolvedValue({ draft: { ...FULL_DRAFT }, model: "claude-test" });
});

describe("конвейер надиктовки", () => {
  it("проводит задание от аудио до готового черновика", async () => {
    const job = await makeJob();
    await runToDraft();

    const fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("drafted");
    expect(fresh.transcript).toContain("правом подреберье");
    expect(fresh.sttModel).toBe("whisper-test");
    expect(fresh.structureModel).toBe("claude-test");
    expect(fresh.durationSec).toBe(95);

    const draft = service.parseDraft(fresh.draftJson);
    expect(draft.mainDiagnosisText).toBe("Острый холецистит");
    expect(draft.mainDiagnosisCode).toBe("K81.0");
  });

  it("расшифровка и черновик шифруются в базе", async () => {
    const job = await makeJob();
    await runToDraft();

    // Читаем в обход геттеров — так лежит на диске.
    const raw = await DictationJob.collection.findOne({ _id: job._id });
    expect(raw.transcript).not.toContain("подреберье");
    expect(raw.draftJson).not.toContain("холецистит");

    // А через модель — открытый текст.
    const viaModel = await DictationJob.findById(job._id);
    expect(viaModel.transcript).toContain("подреберье");
  });

  it("захват стадии атомарный — платная расшифровка не выполняется дважды", async () => {
    const job = await makeJob();

    // Оба «воркера» стартуют одновременно на одной очереди из одного задания.
    // Второй имеет право подхватить СЛЕДУЮЩУЮ стадию того же задания — это
    // не гонка, а конвейер. Недопустимо другое: чтобы одну и ту же стадию
    // выполнили оба, то есть чтобы мы дважды заплатили за расшифровку.
    await Promise.all([service.processNext(), service.processNext()]);

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(structureMock.mock.calls.length).toBeLessThanOrEqual(1);

    const fresh = await DictationJob.findById(job._id);
    // Задание не осталось в промежуточном статусе с потерянным владельцем.
    expect(["transcribed", "drafted"]).toContain(fresh.status);
  });

  it("возвращает в очередь задание, брошенное упавшим воркером", async () => {
    const job = await makeJob();

    // Воркер захватил задание и умер, не дойдя до конца стадии.
    await DictationJob.updateOne(
      { _id: job._id },
      { $set: { status: "transcribing", attempts: 1 } },
      { timestamps: false },
    );
    await DictationJob.collection.updateOne(
      { _id: job._id },
      { $set: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    // До возврата очередь его не видит — оно висит мёртвым грузом.
    expect((await service.processNext()).picked).toBe(false);

    const { reclaimed } = await service.reclaimStale({ olderThanMs: 10 * 60 * 1000 });
    expect(reclaimed).toBe(1);

    const fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("uploaded");
    // Попытка не обнуляется: задание, которое вешает воркер раз за разом,
    // должно в итоге признаться неудачным, а не крутиться вечно.
    expect(fresh.attempts).toBe(1);

    // И теперь оно снова забирается очередью.
    expect((await service.processNext()).picked).toBe(true);
  });

  it("не трогает задание, которое воркер взял только что", async () => {
    const job = await makeJob();
    await DictationJob.updateOne({ _id: job._id }, { $set: { status: "structuring" } });

    const { reclaimed } = await service.reclaimStale({ olderThanMs: 10 * 60 * 1000 });
    expect(reclaimed).toBe(0);
    expect((await DictationJob.findById(job._id)).status).toBe("structuring");
  });

  it("возвращает задание в очередь при сбое и сдаётся после трёх попыток", async () => {
    transcribeMock.mockRejectedValue(new Error("сервис распознавания недоступен"));
    const job = await makeJob();

    await service.processNext();
    let fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("uploaded"); // вернулось в очередь
    expect(fresh.attempts).toBe(1);
    expect(fresh.lastError).toContain("недоступен");

    await service.processNext();
    await service.processNext();
    fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("failed");
    expect(fresh.attempts).toBe(3);

    // Больше не берём — иначе платили бы за заведомо мёртвое задание.
    const after = await service.processNext();
    expect(after.picked).toBe(false);
  });

  it("отдаёт распознавателю настоящее расширение записи, а не webm всегда", async () => {
    // Safari на iOS пишет mp4, Chrome — webm. Распознаватель определяет
    // формат по имени файла: соври ему — и надиктовки с айфона не пройдут.
    const job = await makeJob();
    await DictationJob.updateOne(
      { _id: job._id },
      { $set: { audioUrl: "https://r2.test/uploads/audio/abc.mp4" } },
    );

    await service.processNext();

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(transcribeMock.mock.calls[0][0].filename).toMatch(/\.mp4$/);
  });

  it("не повторяет то, что заведомо не пройдёт со второго раза", async () => {
    // Провайдеры бросают ValidationError, когда виновата сама запись:
    // не распозналась речь, не тот формат. Повтор дал бы тот же результат
    // за тройную цену, а врач ждал бы черновик, которого не будет.
    const { ValidationError } = await import("../../common/utils/errors.js");
    transcribeMock.mockRejectedValue(
      new ValidationError("В записи не распознана речь"),
    );
    const job = await makeJob();

    await service.processNext();

    const fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("failed");
    expect(fresh.attempts).toBe(1); // одна попытка, а не три
    expect(fresh.lastError).toContain("не распознана");
    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });
});

describe("что попадает в карту", () => {
  it("создаёт ЧЕРНОВИК истории болезни, а не подписанную запись", async () => {
    const job = await makeJob();
    await runToDraft();

    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);
    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);

    // Главное: запись не подписана. Подпись — действие врача, не машины.
    expect(record.status).toBe("draft");
    expect(record.signedAt).toBeNull();
    expect(record.signedByUserId).toBeNull();

    expect(String(record.createdBy)).toBe(String(DOCTOR));
    expect(String(record.doctorId)).toBe(String(DOCTOR));
    expect(record.createdByEmployee).toBeNull();
    expect(record.createdByClinicId).toBeNull();
    expect(record.patientType).toBe("private");
    expect(record.patientTypeModel).toBe("DoctorPrivatePatient");
    expect(String(record.patientRef)).toBe(String(PATIENT));
  });

  it("раскладывает поля черновика по полям карты", async () => {
    const job = await makeJob();
    await runToDraft();
    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);

    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);
    expect(record.complaints).toBe(FULL_DRAFT.complaints);
    expect(record.anamnesisMorbi).toBe(FULL_DRAFT.anamnesisMorbi);
    expect(record.anamnesisVitae).toBe(FULL_DRAFT.anamnesisVitae);
    expect(record.statusPreasens).toBe(FULL_DRAFT.statusPreasens);
    expect(record.statusLocalis).toBe(FULL_DRAFT.statusLocalis);
    expect(record.recommendations).toBe(FULL_DRAFT.recommendations);
    expect(record.laboratoryTestResults).toBe(FULL_DRAFT.laboratoryTestResults);
    expect(record.mainDiagnosis.text).toBe("Острый холецистит");
    expect(record.mainDiagnosis.code).toBe("K81.0");
  });

  it("НЕ выдумывает содержимое: пустые поля остаются пустыми", async () => {
    // Врач сказал только про жалобы — больше ничего.
    structureMock.mockResolvedValue({
      draft: {
        complaints: "Кашель две недели",
        anamnesisMorbi: null,
        anamnesisVitae: null,
        statusPreasens: null,
        statusLocalis: null,
        mainDiagnosisText: null,
        mainDiagnosisCode: null,
        recommendations: null,
        ctScanResults: null,
        mriResults: null,
        ultrasoundResults: null,
        laboratoryTestResults: null,
      },
      model: "claude-test",
    });

    const job = await makeJob();
    await runToDraft();
    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);

    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);
    expect(record.complaints).toBe("Кашель две недели");

    // Ни «без особенностей», ни «в норме», ни пустой строки — поля просто нет.
    for (const field of [
      "anamnesisMorbi",
      "anamnesisVitae",
      "statusPreasens",
      "statusLocalis",
      "recommendations",
      "ctScanResults",
      "laboratoryTestResults",
    ]) {
      expect(record[field] ?? null).toBeNull();
    }
    // Диагноза не было — вложенный объект не создаётся.
    expect(record.mainDiagnosis?.text ?? "").toBe("");
  });

  it("не заполняет legacy-зеркало diagnosis вручную — его ставит хук модели", async () => {
    const job = await makeJob();
    await runToDraft();
    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);

    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);
    // Хук синхронизирует зеркало из mainDiagnosis.text; расхождения быть не должно.
    expect(record.diagnosis).toBe(record.mainDiagnosis.text);
  });
});

describe("правка врачом до прикрепления", () => {
  it("сохраняет правку и пускает в карту уже исправленное", async () => {
    const job = await makeJob();
    await runToDraft();

    await service.updateDraft(job._id, DOCTOR, {
      mainDiagnosisText: "Хронический холецистит, обострение",
      mainDiagnosisCode: null,
    });

    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);
    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);
    expect(record.mainDiagnosis.text).toBe("Хронический холецистит, обострение");
    expect(record.mainDiagnosis.code).toBe("");
  });

  it("игнорирует поля вне белого списка — подменить пациента правкой нельзя", async () => {
    const job = await makeJob();
    await runToDraft();

    const foreign = new mongoose.Types.ObjectId();
    await service.updateDraft(job._id, DOCTOR, {
      complaints: "Головная боль",
      patientRef: foreign,
      doctorId: foreign,
      status: "attached",
    });

    const fresh = await DictationJob.findById(job._id);
    expect(String(fresh.patientRef)).toBe(String(PATIENT));
    expect(String(fresh.doctorId)).toBe(String(DOCTOR));
    expect(fresh.status).toBe("drafted");
    expect(service.parseDraft(fresh.draftJson).complaints).toBe("Головная боль");
  });

  it("не даёт править черновик, которого ещё нет", async () => {
    const job = await makeJob();
    await expect(
      service.updateDraft(job._id, DOCTOR, { complaints: "x" }),
    ).rejects.toThrow(/drafted/);
  });
});

describe("границы владения", () => {
  it("чужое задание не читается, не правится и не прикрепляется", async () => {
    const stranger = new mongoose.Types.ObjectId();
    const job = await makeJob();
    await runToDraft();

    await expect(service.getJob(job._id, stranger)).rejects.toThrow(/другому врачу/);
    await expect(
      service.updateDraft(job._id, stranger, { complaints: "x" }),
    ).rejects.toThrow(/другому врачу/);
    await expect(service.attachJob(job._id, stranger)).rejects.toThrow(/другому врачу/);
  });

  it("в списке врача только его задания", async () => {
    const other = new mongoose.Types.ObjectId();
    await makeJob();
    await makeJob({ doctorId: other });

    const mine = await service.listJobs(DOCTOR);
    expect(mine).toHaveLength(1);
  });
});

describe("аудио и ретеншн", () => {
  it("удаляет аудио ПОСЛЕ прикрепления, а не после расшифровки", async () => {
    const job = await makeJob();

    await service.processNext();
    expect(deleteFileMock).not.toHaveBeenCalled(); // после расшифровки — ещё лежит
    await service.processNext();
    expect(deleteFileMock).not.toHaveBeenCalled(); // после структурирования — тоже

    // Врач должен иметь возможность переслушать, пока не подтвердил запись.
    const fresh = await DictationJob.findById(job._id);
    expect(fresh.audioUrl).toBeTruthy();

    await service.attachJob(job._id, DOCTOR);
    expect(deleteFileMock).toHaveBeenCalledTimes(1);

    const after = await DictationJob.findById(job._id);
    expect(after.audioUrl).toBeNull();
    expect(after.audioDeletedAt).toBeTruthy();
    // Расшифровка остаётся: она отвечает на вопрос «откуда в карте эта фраза».
    expect(after.transcript).toContain("подреберье");
  });

  it("отказ стирает аудио сразу и не пускает задание в карту", async () => {
    const job = await makeJob();
    await runToDraft();

    await service.discardJob(job._id, DOCTOR);
    expect(deleteFileMock).toHaveBeenCalledTimes(1);

    const fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("expired");
    expect(fresh.audioUrl).toBeNull();
    expect(await newPatientMedicalHistoryModel.countDocuments()).toBe(0);
  });

  it("прикреплённое задание нельзя отбросить задним числом", async () => {
    const job = await makeJob();
    await runToDraft();
    await service.attachJob(job._id, DOCTOR);

    await expect(service.discardJob(job._id, DOCTOR)).rejects.toThrow(/уже прикреплено/);
  });

  it("стирает расшифровку задания, не дошедшего до карты", async () => {
    // У прикреплённого задания расшифровка объясняет фразу в карте. У
    // отброшенного объяснять нечего — держать текст приёма незачем.
    const job = await makeJob();
    await service.processNext(); // расшифровка
    await service.processNext(); // черновик
    await service.discardJob(job._id, DOCTOR);

    let fresh = await DictationJob.findById(job._id);
    expect(fresh.transcript).toBeTruthy(); // сразу после отказа ещё лежит

    // Проматываем срок хранения.
    await DictationJob.collection.updateOne(
      { _id: job._id },
      { $set: { updatedAt: new Date(Date.now() - 30 * 86400000) } },
    );

    const out = await service.runRetention();
    expect(out.scrubbed).toBe(1);

    fresh = await DictationJob.findById(job._id);
    expect(fresh.transcript).toBeFalsy();
    expect(fresh.draftJson).toBeFalsy();
  });

  it("ретеншн помечает брошенное просроченным и стирает аудио", async () => {
    const old = new Date(Date.now() - 8 * 86400000);
    const job = await makeJob();
    await DictationJob.collection.updateOne(
      { _id: job._id },
      { $set: { createdAt: old } },
    );

    const out = await service.runRetention();
    expect(out.expired).toBe(1);

    const fresh = await DictationJob.findById(job._id);
    expect(fresh.status).toBe("expired");
    expect(fresh.audioUrl).toBeNull();
  });
});

describe("реестр приёмников", () => {
  it("зарегистрированные приёмники доступны, несуществующий — нет", () => {
    // Раньше «clinic» стоял здесь примером НЕсуществующего приёмника —
    // он и был несуществующим, пока не появился. Пример заменён на
    // заведомо выдуманный ключ: иначе тест ломается каждый раз, когда
    // добавляется новый модуль-получатель, и ломается не по делу.
    expect(listSinks()).toContain("myClinic");
    expect(listSinks()).toContain("clinic");
    expect(hasSink("myClinic")).toBe(true);
    expect(hasSink("clinic")).toBe(true);
    expect(hasSink("nowhere-at-all")).toBe(false);
    expect(getSink("myClinic")).toBeTruthy();
    expect(getSink("clinic")).toBeTruthy();
  });

  it("задание с неизвестным приёмником не прикрепляется", async () => {
    const job = await makeJob();
    await runToDraft();
    await DictationJob.collection.updateOne(
      { _id: job._id },
      { $set: { sink: "nowhere" } },
    );

    await expect(service.attachJob(job._id, DOCTOR)).rejects.toThrow(/недоступен/);
  });
});

describe("постфильтр расшифровки", () => {
  it("вырезает артефакты тишины, которые распознаватель выдумывает", () => {
    const out = cleanTranscript(
      "Жалобы на кашель. Субтитры сделал DimaTorzok\nПродолжение следует...",
    );
    expect(out).toContain("Жалобы на кашель");
    expect(out).not.toMatch(/Субтитры|Продолжение следует/i);
  });

  it("не трогает нормальный медицинский текст", () => {
    const text = "Живот мягкий, безболезненный. Печень не увеличена.";
    expect(cleanTranscript(text)).toBe(text);
  });
});

// ── Эхо подсказки ────────────────────────────────────────────────────────────
//
// Whisper на фрагменте без разборчивой речи возвращает переданный prompt
// дословно. Так в черновик приёма попадал сам глоссарий: «МКБ-10, ЭКГ, УЗИ,
// КТ, МРТ, ФГДС, ЭхоКГ, СОЭ, СРБ» — по одному повтору на каждый кусок записи.
// Длины хватало, чтобы пройти проверку MIN_TRANSCRIPT_CHARS.
describe("эхо подсказки распознавателя", () => {
  it("узнаёт глоссарий, вернувшийся вместо речи", () => {
    expect(isPromptEcho("МКБ-10, ЭКГ, УЗИ, КТ, МРТ, ФГДС, ЭхоКГ, СОЭ, СРБ.")).toBe(true);
  });

  it("узнаёт его же, повторённый несколько раз", () => {
    const line = "МКБ-10, ЭКГ, УЗИ, КТ, МРТ, ФГДС, ЭхоКГ, СОЭ, СРБ.";
    expect(isPromptEcho(`${line} ${line} ${line}`)).toBe(true);
  });

  it("узнаёт эхо из другой строки словаря", () => {
    expect(isPromptEcho("пальпация, перкуссия, аускультация, гиперемия, отёк, инфильтрат")).toBe(true);
  });

  it("не считает эхом живую речь врача", () => {
    expect(
      isPromptEcho(
        "Пациент жалуется на боль в эпигастрии в течение недели. Назначена ФГДС и УЗИ брюшной полости.",
      ),
    ).toBe(false);
  });

  it("не считает эхом короткую, но настоящую фразу с терминами", () => {
    expect(isPromptEcho("Сделали ЭКГ, синусовый ритм, отклонений нет")).toBe(false);
  });

  it("пустой текст эхом не считает — это отдельный случай", () => {
    expect(isPromptEcho("")).toBe(false);
    expect(isPromptEcho(null)).toBe(false);
  });
});

// ── Справочник МКБ в сквозном пути ────────────────────────────────────────────
//
// Проверяется не подбор кодов (это __tests__/dictation/codeSuggest.test.js), а
// то, что официальное название доезжает до карты и НЕ отстаёт от кода, когда
// врач правит код руками.

describe("название кода в карте", () => {
  async function seedCatalog() {
    const rows = [
      { code: "K81.0", en: "Acute cholecystitis", ru: "Острый холецистит" },
      { code: "K81.1", en: "Chronic cholecystitis", ru: "Хронический холецистит" },
    ];
    await MedicalCode.insertMany(
      rows.map(({ code, en, ru }) => {
        const doc = {
          system: CODE_SYSTEMS.ICD10CM,
          code,
          codeNormalized: normalizeCode(code),
          titles: { en, ru, az: "", tr: "", ar: "" },
          parentCode: "K81",
          isBillable: true,
        };
        return { ...doc, searchText: buildSearchText(doc) };
      }),
    );
  }

  beforeEach(async () => {
    resetSearchStrategy();
    await seedCatalog();
  });

  it("подставляет официальное название к названному коду", async () => {
    const job = await makeJob();
    await runToDraft();

    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);
    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);

    expect(record.mainDiagnosis.code).toBe("K81.0");
    expect(record.mainDiagnosis.codeTitle).toBe("Острый холецистит");
    // Формулировка врача остаётся отдельно от официального названия.
    expect(record.mainDiagnosis.text).toBe("Острый холецистит");
  });

  it("обновляет название, когда врач меняет код правкой", async () => {
    const job = await makeJob();
    await runToDraft();

    await service.updateDraft(job._id, DOCTOR, {
      mainDiagnosisCode: "K81.1",
      mainDiagnosisText: "Хронический холецистит",
    });

    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);
    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);

    // Название от прежнего кода здесь было бы прямой ошибкой в карте.
    expect(record.mainDiagnosis.code).toBe("K81.1");
    expect(record.mainDiagnosis.codeTitle).toBe("Хронический холецистит");
  });

  it("снимает название, когда врач стирает код", async () => {
    const job = await makeJob();
    await runToDraft();

    await service.updateDraft(job._id, DOCTOR, { mainDiagnosisCode: null });

    const { medicalHistoryId } = await service.attachJob(job._id, DOCTOR);
    const record = await newPatientMedicalHistoryModel.findById(medicalHistoryId);

    expect(record.mainDiagnosis.code).toBe("");
    expect(record.mainDiagnosis.codeTitle).toBe("");
  });
});
