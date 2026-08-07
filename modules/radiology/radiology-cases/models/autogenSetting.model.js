// server/modules/radiology/radiology-cases/models/autogenSetting.model.js
//
// ВЫКЛЮЧАТЕЛЬ НОЧНОЙ АВТОГЕНЕРАЦИИ, КОТОРЫЙ ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК.
//
// До сих пор ночную генерацию можно было выключить только переменной
// RADIOLOGY_AUTOGEN=off в .env, а это значит: зайти по SSH, поправить файл,
// сделать pm2 restart all --update-env. Владелец продукта не должен ходить в
// консоль, чтобы перестать тратить деньги на кейсы, которые он не успевает
// разбирать.
//
// ПОЧЕМУ В БАЗЕ, А НЕ В ПАМЯТИ. Флаг в переменной процесса умирает вместе с
// перезапуском сервера — и генерация, которую владелец выключил вечером,
// сама включилась бы ночью после любого рестарта. Это худший вид сюрприза:
// счёт приходит за то, что считалось отключённым.
//
// ДВА ВЫКЛЮЧАТЕЛЯ, И ЭТО НАМЕРЕННО:
//   • .env RADIOLOGY_AUTOGEN=off — аварийный, жёстче: не даёт даже
//     зарегистрировать cron. Нужен, когда что-то пошло не так на сервере.
//   • эта запись — рабочий, из интерфейса: cron остаётся, но при
//     срабатывании ничего не делает. Включается обратно одной кнопкой.
// Выключено, если выключен ХОТЬ ОДИН: разрешать генерацию вопреки явному
// запрету в .env нельзя.

import mongoose from "mongoose";

const { Schema } = mongoose;

const autogenSettingSchema = new Schema(
  {
    // Ключ на случай, если у арены появятся другие переключатели: запись
    // одна на область, а не одна на всю базу.
    key: { type: String, required: true, unique: true, default: "radiology" },
    enabled: { type: Boolean, default: true },
    // Кто и когда переключил — вопрос «почему ночью ничего не сгенерировалось»
    // возникает через неделю, и ответ на него должен быть в базе, а не в
    // памяти того, кто нажал.
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "radiology_autogen_settings" },
);

const AutogenSetting =
  mongoose.models.RadiologyAutogenSetting ||
  mongoose.model("RadiologyAutogenSetting", autogenSettingSchema);

export default AutogenSetting;

/**
 * Разрешена ли автогенерация хранимой настройкой.
 *
 * Записи нет — считаем разрешённой: так ведёт себя свежая установка, где
 * никто ничего не выключал. Ошибка чтения базы тоже трактуется как «можно»:
 * пропустить ночь из-за мигнувшей сети хуже, чем сгенерировать лишний кейс.
 */
export async function isAutogenAllowedByStore() {
  try {
    const doc = await AutogenSetting.findOne({ key: "radiology" }).lean();
    return doc ? doc.enabled !== false : true;
  } catch {
    return true;
  }
}

/** Переключить и вернуть новое значение. */
export async function setAutogenAllowed(enabled, actorId = null) {
  const doc = await AutogenSetting.findOneAndUpdate(
    { key: "radiology" },
    { enabled: Boolean(enabled), updatedBy: actorId },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return doc.enabled !== false;
}
