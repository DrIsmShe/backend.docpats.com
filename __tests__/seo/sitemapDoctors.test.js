// Профили врачей платформы в карте сайта.
//
// Секция «doctors» выписывала users._id, а страница
// /public/doctor-profile/doctor-details/:id читается эндпоинтом
// /doctor-profile/doctor-detail/:id, который делает DoctorProfile.findById(id)
// (modules/doctorsProfiles/controllers/DoctorDetailController.js). Это разные
// идентификаторы, поэтому КАЖДЫЙ адрес секции отдавал 404 «Doctor not found»,
// а страница показывала «Ошибка загрузки профиля врача». Снаружи секция при
// этом выглядела здоровой: файл есть, URL'ы есть, счётчик не нулевой — и
// поисковику неделями скармливался список битых страниц.
//
// То же правило уже записано для витрины клиники в
// modules/clinic/clinic-public/clinic-public.mapper.js. Тест держит оба
// файла на одном идентификаторе.

import { describe, it, expect, beforeEach } from "vitest";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import {
  buildSitemapSet,
  invalidateSitemapCache,
} from "../../common/sitemap/services/sitemap.service.js";

const BASE = process.env.FRONTEND_URL || "http://localhost:3000";

// Телефон задаётся явно и разным: phoneHash объявлен unique + sparse, но
// рядом стоит `default: null`, а sparse пропускает только ОТСУТСТВУЮЩЕЕ
// поле — не null. Две карточки без телефона в одной базе не уживаются.
let phoneSeq = 0;
async function makeDoctorWithProfile(userOverrides = {}) {
  const { userId } = await createTestDoctor(userOverrides);
  const profile = await DoctorProfile.create({
    userId,
    company: "Тестовая клиника",
    phoneNumber: `+99450100${String(++phoneSeq).padStart(4, "0")}`,
  });
  return { userId, profile };
}

describe("sitemap: профили врачей платформы", () => {
  beforeEach(() => invalidateSitemapCache());

  it("в адрес попадает DoctorProfile._id, а не users._id", async () => {
    const { userId, profile } = await makeDoctorWithProfile();

    const { files } = await buildSitemapSet();
    const doctors = files.get("doctors");

    expect(doctors).toContain(
      `<loc>${BASE}/public/doctor-profile/doctor-details/${profile._id}</loc>`,
    );
    expect(doctors).not.toContain(
      `/public/doctor-profile/doctor-details/${userId}`,
    );
  });

  it("врач без карточки DoctorProfile в секцию не попадает", async () => {
    // Показывать нечего: эндпоинт ищет именно карточку, и без неё адрес был
    // бы таким же 404, каким была вся секция до правки.
    await createTestDoctor();

    const { files } = await buildSitemapSet();

    expect(files.has("doctors")).toBe(false);
  });

  it("заблокированный врач не попадает, даже если рядом есть активный", async () => {
    const { profile } = await makeDoctorWithProfile();
    const blocked = await makeDoctorWithProfile({ isBlocked: true });

    const { files } = await buildSitemapSet();
    const doctors = files.get("doctors");

    expect(doctors).toContain(`doctor-details/${profile._id}`);
    expect(doctors).not.toContain(`doctor-details/${blocked.profile._id}`);
  });
});
