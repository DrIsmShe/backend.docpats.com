// Обратная связь: приём обращений, переписка и разбор.
//
// Проверяем то, что отличает работающую обратную связь от ящика, куда
// пишут в пустоту: чужое обращение недоступно, ответ приходит на языке
// того, кто писал, закрыть без объяснения нельзя, а текст обращения не
// утекает в уведомления — там он оказался бы на чужом экране блокировки.

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

// Уведомления — по-настоящему ходят в веб-пуш и сокеты; здесь важно, ЧТО
// им передали, а не как они это доставят.
vi.mock("../../modules/notifications/services/notification.service.js", () => ({
  notify: vi.fn(async () => ({ _id: "n1" })),
}));

import { notify } from "../../modules/notifications/services/notification.service.js";
import Feedback from "../../modules/feedback/models/feedback.model.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import {
  создать,
  мои,
  одно,
  дописать,
  очередь,
  сводка,
  ответить,
  сменитьСостояние,
} from "../../modules/feedback/services/feedback.service.js";

const id = () => new mongoose.Types.ObjectId();

function актёр(ownerId = id(), extra = {}) {
  return { ownerType: "user", ownerId, clinicId: null, role: null, ...extra };
}

const обращениеДанные = (поля = {}) => ({
  kind: "bug",
  area: "video",
  subject: "Не грузится ролик",
  body: "Загружаю файл в «Мои ролики», доходит до конца и пишет «не удалось».",
  locale: "ru",
  ...поля,
});

beforeEach(() => {
  notify.mockClear();
});

describe("приём обращения", () => {
  it("сохраняет обращение и сразу подтверждает приём", async () => {
    // Человек должен видеть, что письмо дошло, не дожидаясь разбора.
    const а = актёр();
    const о = await создать({ actor: а, data: обращениеДанные() });

    expect(о.status).toBe("new");
    expect(о.messages).toHaveLength(2);
    expect(о.messages[0].authorType).toBe("author");
    expect(о.messages[1].authorType).toBe("system");
    expect(о.messages[1].text).toMatch(/обращение получено/i);
  });

  it("подтверждение приходит на языке обращения", async () => {
    const о = await создать({
      actor: актёр(),
      data: обращениеДанные({ locale: "tr" }),
    });
    expect(о.messages[1].text).toMatch(/mesajınız alındı/i);
  });

  it("запоминает окружение — без него разбор ошибки начинается с допроса", async () => {
    const о = await создать({
      actor: актёр(),
      data: обращениеДанные(),
      context: { url: "/doctor/videos", userAgent: "Mozilla/5.0 (Android 14)" },
    });

    expect(о.context.url).toBe("/doctor/videos");
    expect(о.context.userAgent).toMatch(/Android/);
  });

  it("роль автора — снимок на момент обращения", async () => {
    // Врач уйдёт из клиники, пациент станет сотрудником; кто написал —
    // важно на момент, когда написал.
    const { userId } = await createTestDoctor();

    const о = await создать({
      actor: актёр(userId),
      data: обращениеДанные(),
    });
    expect(о.authorRole).toBe("doctor");
  });

  it("больше десяти незакрытых обращений не принимает", async () => {
    const а = актёр();
    for (let i = 0; i < 10; i += 1) {
      await создать({ actor: а, data: обращениеДанные({ subject: `Раз ${i}` }) });
    }

    await expect(
      создать({ actor: а, data: обращениеДанные({ subject: "Одиннадцатое" }) }),
    ).rejects.toThrow(/в работе/i);
  });

  it("закрытые обращения предел не занимают", async () => {
    // Иначе активный человек однажды упирается в стену и перестаёт писать.
    const а = актёр();
    const админ = id();

    for (let i = 0; i < 10; i += 1) {
      const о = await создать({ actor: а, data: обращениеДанные({ subject: `Р${i}` }) });
      await сменитьСостояние({
        adminId: админ,
        id: о._id,
        status: "done",
        resolution: "Исправлено",
      });
    }

    await expect(
      создать({ actor: а, data: обращениеДанные({ subject: "Ещё одно" }) }),
    ).resolves.toBeTruthy();
  });
});

describe("уведомления", () => {
  it("администратор узнаёт о новом обращении, но текста в уведомлении нет", async () => {
    const { userId: админ } = await createTestDoctor({
      role: "admin",
      isDoctor: false,
    });

    const о = await создать({
      actor: актёр(),
      data: обращениеДанные({ body: "Тут пациент упоминает свой диагноз" }),
    });

    expect(notify).toHaveBeenCalled();
    const письмо = notify.mock.calls[0][0];
    expect(String(письмо.userId)).toBe(String(админ));
    expect(JSON.stringify(письмо)).not.toContain("диагноз");
    expect(письмо.link).toContain(String(о._id));
  });

  it("ошибка ушедшего уведомления не роняет приём обращения", async () => {
    // Обращение важнее уведомления: потерять письмо человека хуже, чем
    // не позвонить в колокольчик.
    notify.mockRejectedValueOnce(new Error("сокет отвалился"));
    await expect(
      создать({ actor: актёр(), data: обращениеДанные() }),
    ).resolves.toBeTruthy();
  });
});

describe("кабинет автора", () => {
  it("показывает только свои обращения", async () => {
    const я = актёр();
    const чужой = актёр();
    await создать({ actor: я, data: обращениеДанные({ subject: "Моё" }) });
    await создать({ actor: чужой, data: обращениеДанные({ subject: "Чужое" }) });

    const список = await мои({ actor: я });
    expect(список).toHaveLength(1);
    expect(список[0].subject).toBe("Моё");
  });

  it("чужое обращение не открывается даже по прямой ссылке", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    await expect(одно({ actor: актёр(), id: о._id })).rejects.toThrow(/не найдено/i);
  });

  it("непрочитанный ответ виден в списке", async () => {
    const я = актёр();
    const о = await создать({ actor: я, data: обращениеДанные() });

    expect((await мои({ actor: я }))[0].hasNewReply).toBe(false);

    await ответить({ adminId: id(), id: о._id, text: "Смотрим" });
    expect((await мои({ actor: я }))[0].hasNewReply).toBe(true);

    await одно({ actor: я, id: о._id });
    expect((await мои({ actor: я }))[0].hasNewReply).toBe(false);
  });

  it("в закрытое обращение дописать нельзя", async () => {
    const я = актёр();
    const о = await создать({ actor: я, data: обращениеДанные() });
    await сменитьСостояние({
      adminId: id(),
      id: о._id,
      status: "declined",
      resolution: "Так задумано",
    });

    await expect(
      дописать({ actor: я, id: о._id, text: "А всё-таки" }),
    ).rejects.toThrow(/закрыто/i);
  });
});

describe("разбор", () => {
  it("ответ администратора снимает состояние «новое»", async () => {
    // Обращение, на которое ответили, не может оставаться неразобранным.
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    const после = await ответить({ adminId: id(), id: о._id, text: "Проверяем" });

    expect(после.status).toBe("in_review");
    expect(после.messages.at(-1).authorType).toBe("admin");
  });

  it("заготовка приходит на языке обращения, а не разбирающего", async () => {
    const о = await создать({
      actor: актёр(),
      data: обращениеДанные({ locale: "az" }),
    });
    const после = await ответить({
      adminId: id(),
      id: о._id,
      templateKey: "need_details",
    });

    expect(после.messages.at(-1).text).toMatch(/təfərrüat/i);
  });

  it("свой текст важнее заготовки", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    const после = await ответить({
      adminId: id(),
      id: о._id,
      text: "Уже чиним, сегодня выкатим",
      templateKey: "need_details",
    });

    expect(после.messages.at(-1).text).toBe("Уже чиним, сегодня выкатим");
  });

  it("пустой ответ отправить нельзя", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    await expect(
      ответить({ adminId: id(), id: о._id, text: "   " }),
    ).rejects.toThrow(/пустой/i);
  });

  it("смена состояния сама пишет автора в переписку", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    const после = await сменитьСостояние({
      adminId: id(),
      id: о._id,
      status: "planned",
    });

    expect(после.messages.at(-1).authorType).toBe("system");
    expect(после.messages.at(-1).text).toMatch(/план работ/i);
  });

  it("автоприписку можно отключить", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    const было = о.messages.length;
    const после = await сменитьСостояние({
      adminId: id(),
      id: о._id,
      status: "in_progress",
      autoReply: false,
    });

    expect(после.messages).toHaveLength(было);
    expect(после.status).toBe("in_progress");
  });

  it("закрыть без итога нельзя", async () => {
    // «Отклонено» без объяснения хуже, чем отсутствие ответа.
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    await expect(
      сменитьСостояние({ adminId: id(), id: о._id, status: "declined" }),
    ).rejects.toThrow(/итог/i);
  });

  it("итог попадает в переписку вместе с автоприпиской", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    const после = await сменитьСостояние({
      adminId: id(),
      id: о._id,
      status: "done",
      resolution: "Починили загрузку: дело было в правилах доступа хранилища",
    });

    expect(после.messages.at(-1).text).toMatch(/правилах доступа/);
    expect(после.handledBy).toBeTruthy();
    expect(после.handledAt).toBeTruthy();
  });

  it("очередь фильтруется по «ждут ответа»", async () => {
    // Эти обращения и теряются: снаружи выглядят разобранными.
    const ждёт = await создать({ actor: актёр(), data: обращениеДанные({ subject: "Ждёт" }) });
    const отвечено = await создать({
      actor: актёр(),
      data: обращениеДанные({ subject: "Отвечено" }),
    });
    await ответить({ adminId: id(), id: отвечено._id, text: "Ответили" });

    const { items } = await очередь({ waiting: true });
    expect(items.map((и) => и.subject)).toEqual(["Ждёт"]);
    expect(String(items[0]._id)).toBe(String(ждёт._id));
  });

  it("сводка считает открытые отдельно от закрытых", async () => {
    const о = await создать({ actor: актёр(), data: обращениеДанные() });
    await создать({ actor: актёр(), data: обращениеДанные({ subject: "Второе" }) });
    await сменитьСостояние({
      adminId: id(),
      id: о._id,
      status: "done",
      resolution: "Сделано",
    });

    const с = await сводка();
    expect(с.byStatus.done).toBe(1);
    expect(с.open).toBe(1);
  });

  it("переписка не растёт бесконечно", async () => {
    // Документ Mongo имеет предел, и упереться в него на живом обращении
    // означало бы потерять и ответ, и всё, что было до него.
    const о = await Feedback.findById(
      (await создать({ actor: актёр(), data: обращениеДанные() }))._id,
    );

    о.messages = Array.from({ length: 101 }, () => ({
      authorType: "author",
      text: "ещё",
    }));

    await expect(о.save()).rejects.toThrow(/реплик/i);
  });
});
