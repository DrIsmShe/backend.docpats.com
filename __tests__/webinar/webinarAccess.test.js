// server/__tests__/webinar/webinarAccess.test.js

/* ============================================================
   Кто попадает в вебинар и с какими правами.

   Это правила доступа, поэтому проверяются отдельно и подробно:
   ошибка здесь — не «неудобно», а посторонний человек в комнате,
   где обсуждают пациента.
   ============================================================ */

import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Webinar from "../../modules/webinar/models/Webinar.model.js";
import * as service from "../../modules/webinar/services/webinar.service.js";

const oid = () => new mongoose.Types.ObjectId();

// Разбираем выданный пропуск: Jitsi доверяет claim'ам, а не тому,
// что сервис положил рядом в ответ.
const claims = (token) => jwt.decode(token);

let host, coHost, invited, stranger;

beforeEach(() => {
  host = oid();
  coHost = oid();
  invited = oid();
  stranger = oid();
  // Секрет нужен только для выдачи токена; в проверках прав не участвует.
  process.env.JITSI_APP_SECRET = "test_secret_for_jitsi_room_tokens_32_chars";
});

const make = (overrides = {}) =>
  service.createWebinar({
    hostId: host,
    data: {
      title: "Разбор случая",
      accessMode: "link",
      coHostIds: [coHost],
      ...overrides,
    },
  });

describe("вебинар — права в комнате", () => {
  it("ведущий и соведущий модерируют, остальные нет", async () => {
    const webinar = await make();

    expect(webinar.isModerator(host)).toBe(true);
    expect(webinar.isModerator(coHost)).toBe(true);
    expect(webinar.isModerator(stranger)).toBe(false);
  });

  it("имя комнаты строится из id и совпадает у всех", async () => {
    const webinar = await make();
    // Разойдись имя в токене и в ссылке — участник упрётся в отказ,
    // и понять причину будет неоткуда.
    expect(webinar.roomName()).toBe(`webinar-${webinar._id.toString()}`);
  });
});

describe("вебинар — кого пускать", () => {
  it("по ссылке пускают любого", async () => {
    const webinar = await make({ accessMode: "link" });
    expect(webinar.mayJoin(stranger)).toBe(true);
  });

  it("по списку пускают только перечисленных", async () => {
    const webinar = await make({
      accessMode: "invited",
      invitedUserIds: [invited],
    });

    expect(webinar.mayJoin(invited)).toBe(true);
    expect(webinar.mayJoin(stranger)).toBe(false);
    // Ведущего и соведущего список не касается — иначе хозяин
    // не смог бы войти в собственную встречу.
    expect(webinar.mayJoin(host)).toBe(true);
    expect(webinar.mayJoin(coHost)).toBe(true);
  });

  it("в завершённую встречу не пускают никого, включая ведущего", async () => {
    const webinar = await make();
    webinar.status = "ended";

    expect(webinar.mayJoin(host)).toBe(false);
    expect(webinar.mayJoin(stranger)).toBe(false);
  });
});

describe("вебинар — выдача пропуска", () => {
  it("постороннему в закрытой встрече отказывают", async () => {
    const webinar = await make({
      accessMode: "invited",
      invitedUserIds: [invited],
    });

    await expect(
      service.issueWebinarToken({
        webinarId: webinar._id.toString(),
        userId: stranger,
      }),
    ).rejects.toThrow(/не пригласили/i);
  });

  it("приглашённый получает пропуск, но не права модератора", async () => {
    const webinar = await make({
      accessMode: "invited",
      invitedUserIds: [invited],
    });

    const result = await service.issueWebinarToken({
      webinarId: webinar._id.toString(),
      userId: invited,
    });

    expect(result.token).toBeTruthy();
    expect(result.room).toBe(webinar.roomName());
    expect(result.moderator).toBe(false);
    // Флаг рядом с токеном — для интерфейса. Решает же не он, а
    // подписанный claim: именно его читает Jitsi.
    expect(claims(result.token).context.user.moderator).toBe("false");
    expect(claims(result.token).room).toBe(webinar.roomName());
  });

  it("ведущий получает права модератора", async () => {
    const webinar = await make();

    const result = await service.issueWebinarToken({
      webinarId: webinar._id.toString(),
      userId: host,
    });

    expect(result.moderator).toBe(true);
    expect(claims(result.token).context.user.moderator).toBe("true");
  });

  it("первый вошедший переводит встречу в «идёт»", async () => {
    const webinar = await make();
    expect(webinar.status).toBe("scheduled");

    await service.issueWebinarToken({
      webinarId: webinar._id.toString(),
      userId: host,
    });

    const fresh = await Webinar.findById(webinar._id);
    expect(fresh.status).toBe("live");
  });

  it("несуществующая встреча — не 500, а понятный отказ", async () => {
    await expect(
      service.issueWebinarToken({
        webinarId: oid().toString(),
        userId: host,
      }),
    ).rejects.toThrow(/не найдена/i);
  });

  it("мусор вместо идентификатора отсекается до похода в базу", async () => {
    const spy = vi.spyOn(Webinar, "findById");
    await expect(
      service.issueWebinarToken({ webinarId: "не-id", userId: host }),
    ).rejects.toThrow(/Некорректный/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("вебинар — изменение и удаление", () => {
  it("соведущий модерирует комнату, но не переписывает условия входа", async () => {
    const webinar = await make();

    await expect(
      service.updateWebinar({
        webinarId: webinar._id.toString(),
        userId: coHost,
        patch: { accessMode: "link" },
      }),
    ).rejects.toThrow(/только ведущий/i);
  });

  it("ведущий закрывает встречу, и войти больше нельзя", async () => {
    const webinar = await make();

    await service.updateWebinar({
      webinarId: webinar._id.toString(),
      userId: host,
      patch: { status: "ended" },
    });

    await expect(
      service.issueWebinarToken({
        webinarId: webinar._id.toString(),
        userId: host,
      }),
    ).rejects.toThrow(/не пригласили/i);
  });

  it("посторонний не удалит чужую встречу", async () => {
    const webinar = await make();

    await expect(
      service.deleteWebinar({
        webinarId: webinar._id.toString(),
        userId: stranger,
      }),
    ).rejects.toThrow(/только ведущий/i);

    expect(await Webinar.findById(webinar._id)).not.toBeNull();
  });
});

describe("вебинар — список", () => {
  it("показывает свои, позванные и не показывает чужие", async () => {
    const mine = await make();
    const invitedOne = await make({
      accessMode: "invited",
      invitedUserIds: [stranger],
    });
    // Чужая встреча другого ведущего, куда никого не звали.
    await service.createWebinar({
      hostId: oid(),
      data: { title: "Чужая", accessMode: "link" },
    });

    const forHost = await service.listWebinars(host);
    expect(forHost.map((w) => String(w._id)).sort()).toEqual(
      [String(mine._id), String(invitedOne._id)].sort(),
    );

    const forStranger = await service.listWebinars(stranger);
    // Встреча «по ссылке» в списке не появляется: о ней узнают из
    // ссылки, а не из перечня всех встреч платформы.
    expect(forStranger.map((w) => String(w._id))).toEqual([
      String(invitedOne._id),
    ]);
  });
});
