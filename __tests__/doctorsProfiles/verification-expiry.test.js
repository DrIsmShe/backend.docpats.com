// __tests__/doctorsProfiles/verification-expiry.test.js
//
// Срок допуска врача.
//
// Проверяется главное свойство: «подтверждён» перестаёт быть вечным.
// До этих правок verificationStatus: "approved" стоял навсегда — лицензия
// истекала в 2026-м, а врач оставался допущенным к рецептам в 2030-м.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile, {
  допускДействует,
  действуетДо,
} from "../../common/models/DoctorProfile/profileDoctor.js";
import {
  ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ,
  обязательныеСобраны,
  срокДопуска,
} from "../../common/models/DoctorVerification/DocumentFiles.js";
import { чегоНеХватает } from "../../modules/admin/services/doctorVerification.service.js";

const oid = () => new mongoose.Types.ObjectId();
const через = (дней) => new Date(Date.now() + дней * 86400000);

/** Документ в том виде, в каком его читают помощники. */
const док = (documentType, поля = {}) => ({
  documentType,
  status: "approved",
  isArchivedByDoctor: false,
  expiresAt: null,
  expiryConfirmed: false,
  ...поля,
});

const полныйНабор = (поля = {}) => [
  док("license", поля),
  док("diploma"),
  док("specialization", поля),
  док("passport"),
];

describe("допускДействует", () => {
  it("не подтверждён — допуска нет", () => {
    expect(допускДействует({ verificationStatus: "pending" })).toBe(false);
    expect(допускДействует({ verificationStatus: "rejected" })).toBe(false);
    expect(допускДействует({ verificationStatus: "suspended" })).toBe(false);
    expect(допускДействует({ verificationStatus: "expired" })).toBe(false);
  });

  it("нет профиля — допуска нет, а не исключение", () => {
    expect(допускДействует(null)).toBe(false);
    expect(допускДействует(undefined)).toBe(false);
  });

  it("подтверждён без срока — допуск бессрочный", () => {
    // Так выглядят все допуски, выданные до появления срока. Закрыть их
    // молча было бы хуже любой просрочки.
    expect(
      допускДействует({
        verificationStatus: "approved",
        verificationExpiresAt: null,
      }),
    ).toBe(true);
  });

  it("подтверждён со сроком в будущем — допуск есть", () => {
    expect(
      допускДействует({
        verificationStatus: "approved",
        verificationExpiresAt: через(10),
      }),
    ).toBe(true);
  });

  it("ГЛАВНОЕ: подтверждён, но срок вышел — допуска нет", () => {
    expect(
      допускДействует({
        verificationStatus: "approved",
        verificationExpiresAt: через(-1),
      }),
    ).toBe(false);
  });

  it("продление администратора перебивает дату документов", () => {
    const профиль = {
      verificationStatus: "approved",
      verificationExpiresAt: через(-5), // лицензия истекла пять дней назад
      verificationExtendedUntil: через(30), // продлено на месяц
    };
    expect(допускДействует(профиль)).toBe(true);
    expect(действуетДо(профиль).getTime()).toBe(
      new Date(профиль.verificationExtendedUntil).getTime(),
    );
  });

  it("истёкшее продление не воскрешает допуск", () => {
    expect(
      допускДействует({
        verificationStatus: "approved",
        verificationExpiresAt: через(-10),
        verificationExtendedUntil: через(-2),
      }),
    ).toBe(false);
  });

  it("продление не сокращает срок документов", () => {
    // Продление до более ранней даты — это ошибка ввода, и она не должна
    // отнимать допуск, который держится на действующем документе.
    const профиль = {
      verificationStatus: "approved",
      verificationExpiresAt: через(100),
      verificationExtendedUntil: через(5),
    };
    expect(действуетДо(профиль).getTime()).toBe(
      new Date(профиль.verificationExpiresAt).getTime(),
    );
    expect(допускДействует(профиль)).toBe(true);
  });
});

describe("срок допуска по документам", () => {
  it("берётся самая ранняя подтверждённая дата — допуск на слабейшем звене", () => {
    const документы = [
      док("license", { expiresAt: через(1000), expiryConfirmed: true }),
      док("specialization", { expiresAt: через(200), expiryConfirmed: true }),
      док("diploma"), // у диплома срока нет
      док("passport", { expiresAt: через(3000), expiryConfirmed: true }),
    ];
    const срок = срокДопуска(документы);
    expect(Math.round((срок - Date.now()) / 86400000)).toBe(200);
  });

  it("НЕподтверждённая дата в срок не идёт", () => {
    // Иначе врач продлевал бы себе допуск, вписав 2099 год.
    const документы = [
      док("license", { expiresAt: через(10), expiryConfirmed: false }),
    ];
    expect(срокДопуска(документы)).toBeNull();
  });

  it("отклонённый и заархивированный документ в срок не идут", () => {
    const документы = [
      док("license", {
        status: "rejected",
        expiresAt: через(5),
        expiryConfirmed: true,
      }),
      док("specialization", {
        isArchivedByDoctor: true,
        expiresAt: через(7),
        expiryConfirmed: true,
      }),
      док("diploma", { expiresAt: через(50), expiryConfirmed: true }),
    ];
    const срок = срокДопуска(документы);
    expect(Math.round((срок - Date.now()) / 86400000)).toBe(50);
  });

  it("ни одной даты — бессрочно", () => {
    expect(срокДопуска(полныйНабор())).toBeNull();
  });
});

describe("обязательные документы", () => {
  it("обязательных четыре: лицензия, диплом, специализация, личность", () => {
    expect(ОБЯЗАТЕЛЬНЫЕ_ДОКУМЕНТЫ).toHaveLength(4);
    expect(обязательныеСобраны(полныйНабор())).toBe(true);
  });

  it("удостоверение личности — паспорт ИЛИ карточка", () => {
    // Требовать паспорт там, где ходят с id-картой, значит требовать
    // документ, который врачу незачем заводить.
    const сКарточкой = [
      док("license"),
      док("diploma"),
      док("specialization"),
      док("id_card"),
    ];
    expect(обязательныеСобраны(сКарточкой)).toBe(true);
  });

  it("без специализации набор не полон", () => {
    const неполный = [док("license"), док("diploma"), док("passport")];
    expect(обязательныеСобраны(неполный)).toBe(false);
    expect(чегоНеХватает(неполный)).toEqual(["specialization"]);
  });

  it("документ на проверке не считается собранным", () => {
    const наПроверке = полныйНабор().map((д) =>
      д.documentType === "license" ? { ...д, status: "pending" } : д,
    );
    expect(обязательныеСобраны(наПроверке)).toBe(false);
  });

  it("пустой набор перечисляет всё недостающее", () => {
    expect(чегоНеХватает([])).toEqual([
      "license",
      "diploma",
      "specialization",
      "passport|id_card",
    ]);
  });
});

describe("профиль в базе", () => {
  /* Телефон обязателен не по смыслу теста, а по уникальному индексу
     phoneHash: два профиля без телефона схлопываются в дубль по null. */
  it.each(["suspended", "expired"])(
    "статус %s принимается схемой",
    async (status) => {
      const профиль = await DoctorProfile.create({
        userId: oid(),
        firstName: "Тест",
        lastName: "Врач",
        phoneNumber: `+99450${Math.floor(1000000 + Math.random() * 8999999)}`,
        verificationStatus: status,
      });
      expect(профиль.verificationStatus).toBe(status);
      // isVerified выводится из статуса — не должен остаться true.
      expect(профиль.isVerified).toBe(false);
    },
  );

  it("одобрение поднимает isVerified, снятие по сроку опускает", async () => {
    const профиль = await DoctorProfile.create({
      userId: oid(),
      firstName: "Тест",
      lastName: "Врач",
      phoneNumber: "+994505550001",
      verificationStatus: "approved",
      verificationExpiresAt: через(-1),
    });
    expect(профиль.isVerified).toBe(true);
    // Но допуска нет: статус говорит одно, дата другое, и решает дата.
    expect(допускДействует(профиль)).toBe(false);
  });
});
