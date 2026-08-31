// __tests__/notifications/localize.test.js
//
// Уведомление читается на языке того, кто читает.
//
// Здесь был дефект, который снаружи выглядел как недоделанный перевод:
// уведомление складывалось готовой русской фразой в момент создания.
// Язык записи навсегда оказывался языком того, кто её вызвал, — турецкий
// врач получал русский текст, потому что запись создал русскоязычный
// коллега. Переключение интерфейса на это не влияло никак.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Notification from "../../common/models/Notification/notification.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import { notify } from "../../modules/notifications/services/notification.service.js";
import {
  localizeNotification,
  localizeNotifications,
  renderNotification,
} from "../../modules/notifications/services/localize.service.js";

const oid = () => new mongoose.Types.ObjectId();
const reqAs = (lang) => ({ lang, headers: { "x-language": lang } });

describe("уведомления на языке читателя", () => {
  it("одна запись читается на пяти языках", async () => {
    const doc = await notify({
      userId: oid(),
      type: "appointment_confirmed",
      title: "Приём подтверждён",
      message: "Доктор Иванов подтвердил ваш приём",
      i18n: {
        title: "app.notify.appointmentConfirmed.title",
        message: "app.notify.appointmentConfirmed.message",
        params: { doctorName: "Иванов", when: "2026-09-01T10:00:00.000Z" },
      },
    });

    const seen = ["ru", "en", "az", "tr", "ar"].map(
      (l) => localizeNotification(doc, reqAs(l)).title,
    );
    // Все пять — разные: ни один язык не подменён русским.
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe("Приём подтверждён");
    expect(seen[1]).toBe("Appointment confirmed");
    // Имя — не перевод, оно остаётся собой в любой фразе.
    expect(localizeNotification(doc, reqAs("tr")).message).toContain("Иванов");
  });

  it("дата подставляется на языке читателя, а не в русском формате", async () => {
    const codes = {
      i18n: {
        message: "app.notify.newBooking.message",
        params: { when: "2026-09-01T10:00:00.000Z" },
      },
      title: "",
      message: "",
    };
    const ru = renderNotification(codes, "ru").message;
    const en = renderNotification(codes, "en").message;
    // Месяц назван словом на своём языке, а не цифрой из ISO.
    expect(ru).toMatch(/сентября/);
    expect(en).toMatch(/September/);
    expect(ru).not.toContain("2026-09-01T10:00:00.000Z");
  });

  it("подставляемый ярлык тоже переводится, а не остаётся русским", async () => {
    const codes = {
      i18n: {
        message: "app.notify.addedToClinic.message",
        // Роль передана кодом — иначе внутри английской фразы стояло бы
        // русское «врача».
        params: { role: "app.role.doctor" },
      },
      title: "",
      message: "",
    };
    expect(renderNotification(codes, "en").message).toContain("doctor");
    expect(renderNotification(codes, "en").message).not.toMatch(/[А-Яа-я]/);
    expect(renderNotification(codes, "ru").message).toContain("врача");
  });

  it("запись без кодов остаётся как есть — старые уведомления не портятся", async () => {
    const doc = await Notification.create({
      userId: oid(),
      type: "system_message",
      title: "Старое уведомление",
      message: "Текст, записанный до появления кодов",
    });
    const out = localizeNotification(doc, reqAs("en"));
    expect(out.title).toBe("Старое уведомление");
    expect(out.message).toBe("Текст, записанный до появления кодов");
  });

  it("кода нет в словаре — показываем русский текст, а не пустоту и не код", () => {
    const out = renderNotification(
      {
        i18n: { title: "app.notify.никогдаТакогоНеБыло", params: {} },
        title: "Запасной заголовок",
        message: "Запасной текст",
      },
      "en",
    );
    expect(out.title).toBe("Запасной заголовок");
  });

  it("браузерное уведомление уходит на языке из профиля получателя", async () => {
    // Пользователь заводится помощником: модель User требует набор
    // зашифрованных полей и хэшей, вручную их не собрать.
    const { userId } = await createTestDoctor({ preferredLanguage: "tr" });

    const doc = await notify({
      userId,
      type: "appointment_confirmed",
      title: "Приём подтверждён",
      message: "Доктор подтвердил ваш приём",
      i18n: { title: "app.notify.appointmentConfirmed.title", params: {} },
    });

    // В базе лежит и русский запасной текст, и код: пуш ушёл по-турецки,
    // а список каждый читатель увидит на своём языке.
    expect(doc.title).toBe("Приём подтверждён");
    expect(doc.i18n.title).toBe("app.notify.appointmentConfirmed.title");
    expect(localizeNotification(doc, reqAs("tr")).title).toBe("Randevu onaylandı");
  });

  it("список переводится целиком", async () => {
    const userId = oid();
    for (const code of [
      "app.notify.appointmentCompleted.title",
      "app.notify.rateAppointment.title",
    ]) {
      await notify({
        userId,
        type: "system_message",
        title: "русский заголовок",
        message: "русский текст",
        i18n: { title: code, params: {} },
      });
    }
    const list = await Notification.find({ userId }).lean();
    const titles = localizeNotifications(list, reqAs("en")).map((n) => n.title);
    expect(titles).toContain("Appointment completed");
    expect(titles).toContain("Rate your appointment");
  });
});
