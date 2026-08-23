// Мультиязычная витрина: выбор языка описания и набор языков для hreflang.
//
// До этого description и slogan были обычными строками: интерфейс говорил на
// пяти языках, а клиника — на одном. Для рынка, где «ЛОР Баку» и
// «otorinolarinqoloq Bakı» дают разные выдачи, это присутствие ровно в одной.
//
// Здесь проверяется поведение, на которое опираются и страница, и разметка:
// фолбэк на язык оригинала и честный список языков.

import { describe, it, expect } from "vitest";
import {
  pickLocalized,
  clinicLanguages,
  toPublicClinicDTO,
} from "../../modules/clinic/clinic-public/clinic-public.mapper.js";

const clinic = {
  name: "DOCPATS Medical Club",
  slug: "docpats-medical-club",
  description: "Многопрофильная клиника в Баку.",
  slogan: "Здоровье начинается здесь",
  originalLanguage: "ru",
  descriptionI18n: { az: "Bakıda çoxprofilli klinika.", en: "" },
  sloganI18n: { az: "Sağlamlıq burada başlayır" },
};

describe("витрина: выбор языка", () => {
  it("отдаёт перевод, когда он есть", () => {
    expect(pickLocalized(clinic.description, clinic.descriptionI18n, "az")).toBe(
      "Bakıda çoxprofilli klinika.",
    );
  });

  it("без перевода отдаёт язык оригинала, а не пустоту", () => {
    // Клиника, заполнившая только русское описание, должна выглядеть одинаково
    // на всех языках — иначе четыре версии из пяти будут пустыми страницами.
    expect(pickLocalized(clinic.description, clinic.descriptionI18n, "tr")).toBe(
      clinic.description,
    );
  });

  it("пустой перевод считается отсутствующим", () => {
    expect(pickLocalized(clinic.description, clinic.descriptionI18n, "en")).toBe(
      clinic.description,
    );
  });

  it("переживает Map вместо объекта (так отдаёт mongoose без lean)", () => {
    const asMap = new Map([["az", "Mapdan gələn mətn"]]);
    expect(pickLocalized("оригинал", asMap, "az")).toBe("Mapdan gələn mətn");
  });
});

describe("витрина: языки для hreflang", () => {
  it("перечисляет только языки с собственным текстом", () => {
    // en заполнен пустой строкой, tr не заполнен вовсе — их в списке быть не
    // должно: связывать hreflang-ом версии с одинаковым текстом бессмысленно.
    expect(clinicLanguages(clinic)).toEqual(["ru", "az"]);
  });

  it("клиника без переводов остаётся одноязычной", () => {
    expect(clinicLanguages({ originalLanguage: "az" })).toEqual(["az"]);
  });

  it("язык оригинала входит в список всегда", () => {
    const only = clinicLanguages({ originalLanguage: "en", descriptionI18n: {} });
    expect(only).toEqual(["en"]);
  });
});

describe("витрина: DTO", () => {
  it("собирает описание и слоган на запрошенном языке", () => {
    const dto = toPublicClinicDTO(clinic, [], null, [], [], [], [], {
      locale: "az",
    });

    expect(dto.description).toBe("Bakıda çoxprofilli klinika.");
    expect(dto.slogan).toBe("Sağlamlıq burada başlayır");
    expect(dto.language).toBe("az");
    expect(dto.availableLanguages).toEqual(["ru", "az"]);
  });

  it("на язык без перевода отдаёт оригинал и сообщает об этом в language", () => {
    const dto = toPublicClinicDTO(clinic, [], null, [], [], [], [], {
      locale: "tr",
    });

    // language — это язык, на котором текст ОТДАН, а не который просили:
    // по нему страница и edge-функция строят canonical.
    expect(dto.language).toBe("ru");
    expect(dto.description).toBe(clinic.description);
  });

  it("без locale ведёт себя как раньше", () => {
    const dto = toPublicClinicDTO(clinic, [], null, [], [], [], []);

    expect(dto.description).toBe(clinic.description);
    expect(dto.language).toBe("ru");
  });
});
