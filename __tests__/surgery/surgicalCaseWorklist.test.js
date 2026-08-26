// server/__tests__/surgery/surgicalCaseWorklist.test.js

/* ============================================================
   Операционный дневник как рабочий список.

   Проверяется не «список отдаётся», а то, ради чего он вообще
   открывается: цифра в счётчике долгов и содержимое среза,
   который по ней открывается, должны совпадать. Если корзина
   «нет протокола» показывает 3, а по клику приходит 5 кейсов —
   врач перестаёт верить счётчику, и раздел снова становится
   архивом, куда заходят раз в месяц.

   Отдельно проверяется связывание пациента: путь к его модели
   был прописан на несуществующую папку, populate молча падал,
   и кейс приходил без имени — то есть без единственного поля,
   по которому запись ищут.
   ============================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

import SurgicalCase from "../../modules/surgery/surgicalCase.model.js";
import DoctorPrivatePatient from "../../common/models/Polyclinic/DoctorPrivatePatient.js";
import {
  listCases,
  getWorklist,
  getCaseById,
  deriveCaseFlags,
  WORK_BUCKETS,
} from "../../modules/surgery/surgicalCase.service.js";

const SURGEON = new mongoose.Types.ObjectId();
const OTHER_SURGEON = new mongoose.Types.ObjectId();

const DAY = 86400000;
const atStartOfDay = (offsetDays) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY);
};
/** Полдень нужного дня — чтобы тест не зависел от того, в какой час он бежит. */
const atNoon = (offsetDays) =>
  new Date(atStartOfDay(offsetDays).getTime() + 12 * 3600 * 1000);

async function makeCase(overrides = {}) {
  return SurgicalCase.create({
    surgeonId: SURGEON,
    procedure: "rhinoplasty",
    status: "planned",
    ...overrides,
  });
}

describe("deriveCaseFlags — что требуется от врача", () => {
  it("операция без даты просит назначить дату, а не подготовку", () => {
    const flags = deriveCaseFlags({ status: "planned", operationDate: null });
    expect(flags.nextAction).toBe("setDate");
    expect(flags.daysUntil).toBeNull();
  });

  it("прошедшая дата при статусе «запланирована» просит подтвердить выполнение", () => {
    const flags = deriveCaseFlags({
      status: "planned",
      operationDate: atNoon(-3),
      consentGiven: true,
      hasPlan: true,
    });
    expect(flags.nextAction).toBe("confirmDone");
    expect(flags.daysUntil).toBe(-3);
  });

  it("выполненная операция без плана просит протокол", () => {
    const flags = deriveCaseFlags({
      status: "completed",
      operationDate: atNoon(-1),
      hasPlan: false,
    });
    expect(flags.nextAction).toBe("writeProtocol");
  });

  it("наступивший контроль важнее назначения следующего", () => {
    const flags = deriveCaseFlags({
      status: "follow_up",
      operationDate: atNoon(-30),
      hasPlan: true,
      nextFollowUpAt: atNoon(-2),
    });
    expect(flags.nextAction).toBe("followUpDue");
    expect(flags.followUpOverdueDays).toBe(2);
  });

  it("готовность считается по чек-листу, а не по факту заполнения одного поля", () => {
    const flags = deriveCaseFlags({
      status: "planned",
      operationDate: atNoon(2),
      patientType: "private",
      privatePatientId: new mongoose.Types.ObjectId(),
      consentGiven: false,
      hasPlan: false,
      photos: [{ label: "before" }],
    });
    // пациент + дата + фото «до» есть; согласия и плана нет
    expect(flags.ready).toBe(3);
    expect(flags.readyOf).toBe(5);
    expect(flags.missing).toEqual(["consent", "plan"]);
    expect(flags.nextAction).toBe("prepare");
  });
});

describe("Корзины рабочего списка", () => {
  beforeEach(async () => {
    await Promise.all([
      // сегодня оперирую
      makeCase({ operationDate: atNoon(0) }),
      // на неделе
      makeCase({ operationDate: atNoon(3) }),
      makeCase({ operationDate: atNoon(6) }),
      // за пределами недели — не должно попасть ни в «сегодня», ни в «неделю»
      makeCase({ operationDate: atNoon(20) }),
      // выполнена, но протокола нет
      makeCase({ status: "completed", operationDate: atNoon(-5) }),
      // выполнена и протокол есть — долгом не считается
      makeCase({
        status: "completed",
        operationDate: atNoon(-6),
        planEncrypted: "ciphertext",
      }),
      // контроль просрочен
      makeCase({
        status: "follow_up",
        operationDate: atNoon(-40),
        planEncrypted: "ciphertext",
        nextFollowUpAt: atNoon(-4),
      }),
      // контроль назначен на будущее — не долг
      makeCase({
        status: "follow_up",
        operationDate: atNoon(-10),
        planEncrypted: "ciphertext",
        nextFollowUpAt: atNoon(5),
      }),
      // дата прошла, статус не изменили
      makeCase({ operationDate: atNoon(-2) }),
      // без даты
      makeCase({ operationDate: null }),
      // чужой хирург — не должен попасть никуда
      makeCase({ surgeonId: OTHER_SURGEON, operationDate: atNoon(0) }),
    ]);
  });

  it("считает каждый долг отдельно и не смешивает «сегодня» с «неделей»", async () => {
    const { buckets, total } = await getWorklist(SURGEON);

    expect(total).toBe(10); // чужой кейс не считается
    expect(buckets.today).toBe(1);
    // «Неделя» — только +3 и +6: сегодняшняя операция ушла в свою корзину,
    // а +20 в неделю не попадает.
    expect(buckets.week).toBe(2);
    // Выполненная с планом долгом не считается — иначе счётчик никогда не
    // обнулится и врач перестанет на него смотреть.
    expect(buckets.needs_protocol).toBe(1);
    // Контроль на будущее не просрочен.
    expect(buckets.followup_due).toBe(1);
    expect(buckets.stale_planned).toBe(1);
    expect(buckets.no_date).toBe(1);
  });

  it("счётчик и список по корзине дают одно и то же число", async () => {
    const { buckets } = await getWorklist(SURGEON);

    for (const key of WORK_BUCKETS) {
      const { total } = await listCases(SURGEON, { bucket: key, limit: 50 });
      expect(`${key}:${total}`).toBe(`${key}:${buckets[key]}`);
    }
  });

  it("удалённый кейс уходит и из счётчиков, и из списка", async () => {
    const doc = await SurgicalCase.findOne({
      surgeonId: SURGEON,
      operationDate: { $ne: null },
      status: "planned",
    }).sort({ operationDate: 1 });
    doc.deletedAt = new Date();
    await doc.save();

    const { total } = await getWorklist(SURGEON);
    expect(total).toBe(9);
  });

  it("«впереди» — это режим расписания, а не долг: он шире, чем «сегодня»", async () => {
    const upcoming = await listCases(SURGEON, { bucket: "upcoming", limit: 50 });
    const today = await listCases(SURGEON, { bucket: "today", limit: 50 });
    expect(upcoming.total).toBeGreaterThan(today.total);
    upcoming.items.forEach((c) => {
      expect(new Date(c.operationDate).getTime()).toBeGreaterThanOrEqual(
        atStartOfDay(0).getTime(),
      );
    });
  });

  it("неизвестная корзина не расширяет выборку молча", async () => {
    const all = await listCases(SURGEON, { limit: 50 });
    const bogus = await listCases(SURGEON, { bucket: "не-корзина", limit: 50 });
    expect(bogus.total).toBe(all.total);
  });
});

describe("Список: сортировка и флаги", () => {
  it("расписание идёт вперёд по времени, журнал — назад", async () => {
    await Promise.all([
      makeCase({ operationDate: atNoon(1) }),
      makeCase({ operationDate: atNoon(5) }),
      makeCase({ operationDate: atNoon(3) }),
    ]);

    const asc = await listCases(SURGEON, { sort: "date_asc", limit: 50 });
    const desc = await listCases(SURGEON, { sort: "date_desc", limit: 50 });

    const asDays = (r) =>
      r.items.map((c) => Math.round((new Date(c.operationDate) - atNoon(0)) / DAY));
    expect(asDays(asc)).toEqual([1, 3, 5]);
    expect(asDays(desc)).toEqual([5, 3, 1]);
  });

  it("в списке нет расшифрованного плана, но есть признак его наличия", async () => {
    await makeCase({
      status: "completed",
      operationDate: atNoon(-1),
      planEncrypted: "ciphertext",
    });
    const { items } = await listCases(SURGEON, { limit: 50 });
    expect(items[0].planEncrypted).toBeUndefined();
    expect(items[0].plan).toBeUndefined();
    expect(items[0].hasPlan).toBe(true);
    expect(items[0].flags.nextAction).not.toBe("writeProtocol");
  });
});

describe("Связывание пациента", () => {
  let patient;

  beforeEach(async () => {
    patient = new DoctorPrivatePatient({
      doctorProfileId: new mongoose.Types.ObjectId(),
      doctorUserId: SURGEON,
      externalId: "AMB-4471",
    });
    patient.firstName = "Лейла";
    patient.lastName = "Мамедова";
    await patient.save();

    await makeCase({
      patientType: "private",
      privatePatientId: patient._id,
      operationDate: atNoon(2),
    });
  });

  it("список отдаёт имя пациента, а не только название операции", async () => {
    const { items } = await listCases(SURGEON, { limit: 50 });
    expect(items[0].patient).toBeTruthy();
    expect(items[0].patient.lastName).toBe("Мамедова");
    expect(items[0].patient.externalId).toBe("AMB-4471");
  });

  it("карточка кейса тоже открывается с пациентом", async () => {
    const doc = await SurgicalCase.findOne({ surgeonId: SURGEON });
    const found = await getCaseById(doc._id, SURGEON);
    expect(found.patient?.firstName).toBe("Лейла");
  });

  it("поиск по фамилии находит кейс, хотя фамилия зашифрована", async () => {
    const { total, items } = await listCases(SURGEON, {
      q: "мамедова",
      limit: 50,
    });
    expect(total).toBe(1);
    expect(items[0].patient.lastName).toBe("Мамедова");
  });

  it("поиск по внешнему номеру карты работает по подстроке", async () => {
    const { total } = await listCases(SURGEON, { q: "4471", limit: 50 });
    expect(total).toBe(1);
  });

  it("промах поиска даёт пустой результат, а не весь журнал", async () => {
    await makeCase({ operationDate: atNoon(1) });
    const { total, items } = await listCases(SURGEON, {
      q: "несуществующая",
      limit: 50,
    });
    expect(total).toBe(0);
    expect(items).toEqual([]);
  });

  it("поиск не выводит кейсы чужого хирурга", async () => {
    await SurgicalCase.create({
      surgeonId: OTHER_SURGEON,
      procedure: "facelift",
      patientType: "private",
      privatePatientId: patient._id,
      operationDate: atNoon(1),
    });
    const { total } = await listCases(SURGEON, { q: "Мамедова", limit: 50 });
    expect(total).toBe(1);
  });
});
