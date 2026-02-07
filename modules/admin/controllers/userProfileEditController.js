import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";

/* ========== helpers ========== */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const clamp = (str, max) => (typeof str === "string" ? str.slice(0, max) : str);
const pick = (src = {}, whitelist = []) =>
  whitelist.reduce((acc, k) => {
    if (Object.prototype.hasOwnProperty.call(src, k)) acc[k] = src[k];
    return acc;
  }, {});
const isValidISODate = (s) => {
  if (!isNonEmptyString(s)) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
};

/** Проверка уникальности username, исключая текущего пользователя */
async function assertUsernameUnique(username, userId, session) {
  if (!isNonEmptyString(username)) return;
  const q = User.findOne({ username }).lean();
  if (session) q.session(session);
  const existing = await q;
  if (existing && existing._id.toString() !== String(userId)) {
    const err = new Error("Такое имя пользователя уже занято");
    err.status = 409;
    throw err;
  }
}

/* ========== controller ========== */
/**
 * PATCH /admin/user/edit-profile/profile/:userId
 * body: { user: { username?, country?, address?, company?, job?, about?, bio?, preferredLanguage?, dateOfBirth?, email?, firstName?, lastName? } }
 */
export async function userProfileEditController(req, res, next) {
  let session = null;
  try {
    const userId = req.params?.userId || req.userId;
    if (!userId) {
      return res.status(400).json({ ok: false, message: "Не передан userId" });
    }

    const raw = req.body?.user || {};
    if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Нет данных для обновления (user)" });
    }

    // разрешённые поля (убраны photo, avatar, socialLinks)
    const whitelist = [
      "username",
      "country",
      "address",
      "company",
      "job",
      "about",
      "bio",
      "preferredLanguage",
      "dateOfBirth",
      "email",
      "firstName",
      "lastName",
      "role", // ← добавляем
    ];
    const patch = pick(raw, whitelist);

    // нормализация/лимиты
    if (patch.about) patch.about = clamp(patch.about, 1200);
    if (patch.bio) patch.bio = clamp(patch.bio, 500);

    // dateOfBirth: ждём YYYY-MM-DD; если невалидно — удаляем из апдейта
    if (patch.dateOfBirth) {
      if (isValidISODate(patch.dateOfBirth)) {
        patch.dateOfBirth = new Date(patch.dateOfBirth);
      } else {
        delete patch.dateOfBirth;
      }
    }

    // Перекладываем плейн-поля в *Encrypted — сработают pre-хуки модели User
    if (isNonEmptyString(patch.firstName)) {
      patch.firstNameEncrypted = patch.firstName;
      delete patch.firstName;
    }
    if (isNonEmptyString(patch.lastName)) {
      patch.lastNameEncrypted = patch.lastName;
      delete patch.lastName;
    }
    if (isNonEmptyString(patch.email)) {
      patch.emailEncrypted = patch.email;
      delete patch.email;
    }

    // проверим уникальность username
    if (isNonEmptyString(patch.username)) {
      await assertUsernameUnique(patch.username, userId, session);
    }

    if (Object.keys(patch).length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Нет валидных полей для обновления" });
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: patch },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    ).lean(false);

    if (!updated) {
      return res
        .status(404)
        .json({ ok: false, message: "Пользователь не найден" });
    }

    return res.status(200).json({
      ok: true,
      user: updated.toJSON(),
      message: "Профиль успешно обновлён",
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Нарушение уникальности (возможно, username/email уже заняты)",
        keyValue: err?.keyValue,
      });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({
        ok: false,
        message: "Ошибка валидации",
        details: Object.fromEntries(
          Object.entries(err.errors || {}).map(([k, v]) => [k, v.message])
        ),
      });
    }
    const status = err.status || 400;
    return res
      .status(status)
      .json({ ok: false, message: err.message || "Bad Request" });
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
}

export default userProfileEditController;
