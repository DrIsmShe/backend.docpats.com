// modules/clinic/clinic-medical/controllers/patientCardPdf.controller.js
//
// Печать медицинской карты одним листом.
//
// Данные берём у той же сводки, что рисует экран: два источника для одного
// содержимого рано или поздно разойдутся, и расхождение обнаружится на
// бумаге у пациента на руках.
//
// Ошибки генератора заворачиваем в next(err) по той же причине, что и в
// рецепте: buildPatientCardPdf бросает синхронно, если нет шрифтов Noto, и
// без обёртки бросок уходил бы в Unhandled Rejection — ответ не отправлен,
// у клиента вечное «Готовим…».

import patientSummaryService from "../services/patientSummary.service.js";

export async function patientCardPdfController(req, res, next) {
  try {
    const patient = req.clinicPatient;
    const summary = await patientSummaryService.getPatientSummary({ patient });

    const { buildPatientCardPdf } = await import("../pdf/patientCardPdf.js");

    // Возраст не храним — он вычисляется из даты рождения и через год
    // протух бы. Считаем на момент печати.
    let age = null;
    const dob = patient?.dateOfBirth ? new Date(patient.dateOfBirth) : null;
    if (dob && !Number.isNaN(dob.getTime())) {
      const now = new Date();
      age = now.getUTCFullYear() - dob.getUTCFullYear();
      const before =
        now.getUTCMonth() < dob.getUTCMonth() ||
        (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
      if (before) age -= 1;
      if (age < 0 || age > 130) age = null;
    }

    const pdfBuffer = await buildPatientCardPdf({
      summary,
      patient: {
        // virtuals: true — имя, телефон и почта пациента зашифрованы и
        // отдаются виртуальными полями; обычный toObject() их теряет.
        ...(typeof patient.toObject === "function"
          ? patient.toObject({ virtuals: true })
          : patient),
        age,
      },
      clinic: req.clinic || null,
      lang: req.query?.lang || req.tenantContext?.lang || "ru",
    });

    res.setHeader("Content-Type", "application/pdf");
    // inline, а не attachment: врач чаще смотрит карту на экране и печатает
    // из просмотрщика, чем сохраняет файл. Имя пациента в имя файла не
    // ставим — оно видно всем, кто увидит папку загрузок.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="patient-card-${patient._id}.pdf"`,
    );
    return res.status(200).end(pdfBuffer);
  } catch (err) {
    return next(err);
  }
}

export default { patientCardPdfController };
