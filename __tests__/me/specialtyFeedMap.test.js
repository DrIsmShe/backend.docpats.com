// __tests__/me/specialtyFeedMap.test.js
//
// Сопоставление «профессия врача → раздел ленты новостей».
//
// Ошибка здесь молчаливая: врач просто увидит чужие материалы и решит, что по
// его специальности ничего не пишут. Поэтому проверяется не только то, что
// сопоставление есть, но и то, что оно не выдумывает раздел там, где его нет.

import { describe, it, expect } from "vitest";
import { feedSectionFor } from "../../modules/me/specialtyFeedMap.js";

describe("раздел ленты по специальности", () => {
  it("ведёт узкие профессии в свой раздел", () => {
    expect(feedSectionFor("Otolaryngologist")).toBe("ent");
    expect(feedSectionFor("Ophthalmologist")).toBe("ophthalmology");
    expect(feedSectionFor("Cardiologist")).toBe("cardiology");
    expect(feedSectionFor("Hematologist")).toBe("hematology");
  });

  it("понимает профессии, чьё название не совпадает с областью", () => {
    // Фтизиатр лечит туберкулёз — своего раздела нет, но инфекции есть.
    expect(feedSectionFor("Phthisiatrician")).toBe("infectious");
    // Гепатолог — это гастроэнтерология.
    expect(feedSectionFor("Hepatologist")).toBe("gastroenterology");
    // Проктолог тоже.
    expect(feedSectionFor("Coloproctologist")).toBe("gastroenterology");
    // Челюстно-лицевой хирург ближе к стоматологии, чем к общей хирургии.
    expect(feedSectionFor("Maxillofacial Surgeon")).toBe("dentistry");
  });

  it("детские специальности ведёт в предмет, а не в педиатрию", () => {
    // Детскому онкологу нужна онкология, а не общая педиатрия: предмет важнее
    // возраста пациента.
    expect(feedSectionFor("Pediatric Oncologist")).toBe("oncology");
    expect(feedSectionFor("Pediatric Neurologist")).toBe("neurology");
    expect(feedSectionFor("Child Psychiatrist")).toBe("psychiatry");
    // А сам педиатр и неонатолог — в педиатрию.
    expect(feedSectionFor("Pediatrician")).toBe("pediatrics");
    expect(feedSectionFor("Neonatologist")).toBe("pediatrics");
  });

  it("не выдумывает раздел для широкого профиля", () => {
    // Своего раздела у терапевта нет, и подсунуть ему чужой хуже, чем
    // показать всю ленту: он решит, что по его специальности не пишут.
    for (const name of [
      "Therapist",
      "Family Doctor",
      "Internal Medicine Doctor",
      "Geriatrician",
      "Clinical Pharmacologist",
      "Forensic Medical Examiner",
    ]) {
      expect(feedSectionFor(name)).toBeNull();
    }
  });

  it("не падает на пустом и незнакомом значении", () => {
    expect(feedSectionFor(null)).toBeNull();
    expect(feedSectionFor("")).toBeNull();
    expect(feedSectionFor("   ")).toBeNull();
    expect(feedSectionFor("Космический доктор")).toBeNull();
  });

  it("выдаёт только те разделы, что есть в ленте", () => {
    // Ключи уходят в запрос к ленте как есть. Опечатка не даст ошибки —
    // раздел просто окажется пустым, и это не с чем будет связать.
    const KNOWN = new Set([
      "oncology", "infectious", "hematology", "genetics", "psychiatry",
      "neurology", "ophthalmology", "ent", "dermatology", "rheumatology",
      "orthopedics", "gynecology", "urology", "gastroenterology",
      "endocrinology", "nephrology", "pediatrics", "radiology",
      "rehabilitation", "dentistry", "sports_medicine", "emergency",
      "anesthesiology", "allergy", "pulmonology", "cardiology", "surgery",
    ]);

    const professions = [
      "Pulmonologist", "Nephrologist", "Phthisiatrician", "Hepatologist",
      "Dermatologist", "Endocrinologist", "Infectious Disease Specialist",
      "Urologist", "Gastroenterologist", "Cardiologist", "Hematologist",
      "Rheumatologist", "Allergist-Immunologist", "Medical Geneticist",
      "Pediatrician", "Gynecologist", "Obstetrician", "Oncologist",
      "Neurologist", "Psychiatrist", "Andrologist", "Radiologist",
      "Ophthalmologist", "Otolaryngologist", "Dentist", "Physiotherapist",
      "Emergency Medicine Doctor", "Sports Doctor", "Plastic Surgeon",
      "Orthopedic Trauma Surgeon", "Oculoplastic Surgeon", "Toxicologist",
    ];

    for (const name of professions) {
      const section = feedSectionFor(name);
      expect(section, `${name} → ${section}`).not.toBeNull();
      expect(KNOWN.has(section), `${name} → неизвестный раздел ${section}`).toBe(true);
    }
  });
});
