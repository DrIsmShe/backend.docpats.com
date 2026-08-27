// __tests__/education/programTitle.test.js
//
// ТЕХНИЧЕСКОЕ НАЗВАНИЕ ЧЕРНОВИКА — на всех пяти языках интерфейса.
//
// Мастер импорта заводит тест до того, как известно, о чём он, и подставляет
// название из локали оператора. Разобрав первый кусок, модель предлагает
// осмысленное название, и импорт заменяет им техническое — но только его:
// название, введённое человеком, трогать нельзя.
//
// Признаком «техническое» служила регулярка из русских слов, и тест,
// заказанный из азербайджанской админки, назывался «Generasiya: …», под неё
// не подходил и оставался с техническим названием навсегда — на витрине
// висело «Generasiya: Prion xəstəlikləri» вместо темы.
//
// Список префиксов обязан совпадать с ключами draftProgramTitle в
// client/public/locales/<lang>/education.json — этот тест и есть напоминание.

import { describe, it, expect } from "vitest";
import { isProvisionalProgramTitle } from "../../modules/education/constants.js";

describe("isProvisionalProgramTitle", () => {
  it("узнаёт черновик генерации на всех пяти языках", () => {
    const titles = [
      "Генерация: Прионные болезни",
      "Generated: Prion diseases",
      "Generasiya: Prion xəstəlikləri",
      "Oluşturma: Prion hastalıkları",
      "إنشاء: أمراض البريون",
    ];
    for (const title of titles) {
      expect(isProvisionalProgramTitle(title), title).toBe(true);
    }
  });

  it("узнаёт черновик импорта из файла и ручного ввода", () => {
    const titles = [
      "Черновик импорта: Отоларингология",
      "Import draft: Otolaryngology",
      "İdxal qaralaması: Otorinolarinqologiya",
      "İçe aktarma taslağı: Kulak burun boğaz",
      "مسودة استيراد: أنف وأذن وحنجرة",
      "Ручной ввод: Кардиология",
      "Əl ilə daxiletmə: Kardiologiya",
    ];
    for (const title of titles) {
      expect(isProvisionalProgramTitle(title), title).toBe(true);
    }
  });

  it("узнаёт и голый префикс без темы — так назывались старые черновики", () => {
    expect(isProvisionalProgramTitle("Черновик генерации")).toBe(true);
    expect(isProvisionalProgramTitle("Generasiya")).toBe(true);
  });

  it("не трогает название, введённое человеком", () => {
    const titles = [
      "Prion xəstəlikləri",
      "USMLE Step 1",
      "Кардиология для резидентов",
      "Импортозамещение в медтехнике", // начинается на «импорт», но не префикс мастера
      "",
      null,
      undefined,
    ];
    for (const title of titles) {
      expect(isProvisionalProgramTitle(title), String(title)).toBe(false);
    }
  });
});
