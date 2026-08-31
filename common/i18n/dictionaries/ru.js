// common/i18n/dictionaries/ru.js
//
// Сообщения сервера, которые видит человек. Ключ — код, значение —
// текст. Подстановки записываются как {{имя}}.
//
// Русский — язык оригинала: тексты писались здесь, остальные словари
// переведены с них.

export default {
  "common.unauthorized": "Не авторизован",
  "common.forbidden": "Доступ запрещён",
  "common.notFound": "Не найдено",
  "common.badId": "Неверный формат идентификатора",
  "common.serverError": "Внутренняя ошибка сервера",
  "common.tooManyRequests": "Слишком много попыток. Попробуйте позже.",
  "common.validationFailed": "Проверьте заполненные поля",
  "common.saveFailed": "Не удалось сохранить",
  "common.deleteFailed": "Не удалось удалить",
  "common.loadFailed": "Не удалось загрузить данные",
  "patient.notFound": "Пациент не найден",
  "patient.required": "Нужно указать пациента",
  "clinic.notFound": "Клиника не найдена",
  "clinic.membershipRequired": "Нужно членство в клинике",
  "clinic.featureNotInPlan": "Этот раздел входит в тарифы Business и Enterprise",
  "clinic.analyticsNotInPlan": "Аналитика по клинике входит в тарифы Business и Enterprise",
  "prescription.notFound": "Рецепт не найден",
  "prescription.needsItem": "Нужна хотя бы одна позиция с международным названием (МНН)",
  "prescription.onlyActiveEditable": "Править можно только активный рецепт. Отмените его и выпишите новый.",
  "prescription.alreadyDispensed": "По рецепту уже был отпуск — править нельзя. Отмените его и выпишите новый.",
  "consent.duplicatePending": "Запрос этому пациенту уже отправлен и ждёт ответа. Дождитесь ответа или отзовите прежний запрос.",
  "consent.alreadyGranted": "Пациент уже открыл клинике эти данные — запрашивать их повторно не нужно.",
};
