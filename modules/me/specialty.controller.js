// server/modules/me/specialty.controller.js
//
// Специальность текущего врача и раздел ленты новостей, который ей отвечает.
//
// Нужен ленте медицинских новостей: она размечена предметными областями
// («infectious», «ophthalmology»), а в профиле врача лежит название профессии
// («Phthisiatrician»). Сопоставление живёт в specialtyFeedMap.js — на сервере,
// потому что клиенту незачем знать все 101 название справочника.

import mongoose from "mongoose";
import User from "../../common/models/Auth/users.js";
import { asyncHandler } from "../../common/middlewares/errorHandler.js";
import { feedSectionFor } from "./specialtyFeedMap.js";

/**
 * GET /api/me/specialty
 *
 * Отвечает и когда специальность не указана, и когда для неё нет своего
 * раздела: в обоих случаях feedSection = null, а интерфейс показывает общую
 * ленту. Ошибкой это не является — у терапевта своего раздела и не должно
 * быть.
 */
export const getMySpecialty = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId)
    .select("role specialization")
    .lean();

  if (!user) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }

  let name = null;

  if (user.specialization) {
    // populate() здесь не используем: модель Specialization регистрируется в
    // другом модуле, и при холодном старте ссылка может быть ещё не готова.
    // Прямое чтение коллекции надёжнее и дешевле одного join.
    const doc = await mongoose.connection.db
      .collection("specializations")
      .findOne({ _id: user.specialization }, { projection: { name: 1 } });
    name = doc?.name || null;
  }

  res.json({
    success: true,
    role: user.role,
    specialization: name,
    feedSection: feedSectionFor(name),
  });
});

export default { getMySpecialty };
