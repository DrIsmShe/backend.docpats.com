// controllers/friendsController.js
import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import Specialization from "../../../common/models/Articles/articlesCategories.js"; // модель из твоего файла

/** ===== helpers ===== */
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

const decryptSafe = (userDoc) => {
  try {
    if (userDoc && typeof userDoc.decryptFields === "function") {
      return userDoc.decryptFields();
    }
  } catch (_) {}
  return { firstName: "Имя", lastName: "Фамилия" };
};

const pickAvatar = (profile) => profile?.profileImage || null;

const countryAsString = (src) => {
  if (!src) return "";
  if (typeof src === "string") return src.trim();
  if (Array.isArray(src))
    return src.map(countryAsString).filter(Boolean).join(", ").trim();
  if (typeof src === "object") {
    const keys = ["title", "name", "label", "ru", "en"];
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
};

// --- универсальный сбор ID специализаций из разных форматов поля
const asObjectIdString = (v) => {
  if (!v) return null;
  if (typeof v === "string") return isObjectId(v) ? v : null;
  if (v instanceof mongoose.Types.ObjectId) return String(v);
  if (typeof v === "object") {
    if (v._id && isObjectId(v._id)) return String(v._id);
    if (v.id && isObjectId(v.id)) return String(v.id);
  }
  return null;
};

const asNameString = (v) => {
  if (!v) return "";
  if (typeof v === "string") return isObjectId(v) ? "" : v.trim();
  if (typeof v === "object") return (v.name || v.title || "").toString().trim();
  return "";
};

const collectSpecIdsAndNames = (val) => {
  const ids = [];
  const names = [];
  const push = (x) => {
    const id = asObjectIdString(x);
    if (id) return ids.push(id);
    const name = asNameString(x);
    if (name) names.push(name);
  };
  if (Array.isArray(val)) val.forEach(push);
  else push(val);
  return { ids, names };
};

// собрать специализации из профиля и/или пользователя в виде {ids, names}
const pickSpecPayload = (prof, user) => {
  const fields = [
    prof?.specializations,
    prof?.specialization,
    prof?.speciality,
    prof?.specialities,
    user?.specializations,
    user?.specialization,
    user?.speciality,
    user?.specialities,
  ];
  const ids = [];
  const names = [];
  for (const f of fields) {
    const { ids: i, names: n } = collectSpecIdsAndNames(f);
    if (i.length) ids.push(...i);
    if (n.length) names.push(...n);
  }
  return { ids, names };
};

const uniq = (arr) => {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!x) continue;
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
};

/** =========================================================
 *  Получить список всех доступных докторов
 *  Возвращает: [{ userId, profileId, firstName, lastName, avatar, specialization, specializations, country }]
 * ========================================================= */
export const getDoctorsList = async (req, res) => {
  try {
    // без .lean(), чтобы decryptFields() отработал
    const users = await User.find({ role: "doctor", isDoctor: true })
      .select(
        "_id firstNameEncrypted lastNameEncrypted specialization specializations country"
      )
      .exec();

    const userIds = users.map((u) => u._id);
    const profiles = await ProfileDoctor.find({ userId: { $in: userIds } })
      .select(
        "_id userId profileImage specialization specializations speciality country"
      )
      .lean();

    const profileByUserId = new Map(profiles.map((p) => [String(p.userId), p]));

    // --- соберём ВСЕ id специализаций, чтобы одним запросом получить имена
    const allSpecIds = new Set();
    for (const u of users) {
      const p = profileByUserId.get(String(u._id));
      const { ids } = pickSpecPayload(p, u);
      ids.forEach((id) => allSpecIds.add(id));
    }

    const specDocs = await Specialization.find({
      _id: { $in: Array.from(allSpecIds) },
    })
      .select("_id name")
      .lean();

    const specNameById = new Map(specDocs.map((s) => [String(s._id), s.name]));

    const result = users.map((doc) => {
      const dec = decryptSafe(doc);
      const prof = profileByUserId.get(String(doc._id));

      const { ids, names } = pickSpecPayload(prof, doc);
      const fromIds = ids.map((id) => specNameById.get(id)).filter(Boolean);
      const specList = uniq([...names, ...fromIds]);

      const country =
        countryAsString(prof?.country) || countryAsString(doc?.country) || "";

      return {
        userId: String(doc._id),
        profileId: prof ? String(prof._id) : null,
        firstName: dec.firstName,
        lastName: dec.lastName,
        avatar: pickAvatar(prof),
        specialization: specList.join(", "), // строка для совместимости
        specializations: specList, // МАССИВ имён — основа для фронта
        country,
      };
    });

    return res.status(200).json({ doctors: result });
  } catch (error) {
    console.error("❌ getDoctorsList:", error);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/** =========================================================
 *  Добавить коллегу в друзья
 * ========================================================= */
export const addFriend = async (req, res) => {
  const { friendId } = req.body;
  const currentUserId = req.userId;

  if (!friendId || !isObjectId(friendId)) {
    return res.status(400).json({ message: "Некорректный ID коллеги" });
  }
  if (!currentUserId || !isObjectId(currentUserId)) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  if (String(currentUserId) === String(friendId)) {
    return res.status(400).json({ message: "Нельзя добавить себя в друзья" });
  }

  try {
    const [currentUser, friendUser] = await Promise.all([
      User.findById(currentUserId).select("_id friends").lean(),
      User.findById(friendId).select("_id role isDoctor").lean(),
    ]);

    if (!currentUser) {
      return res
        .status(404)
        .json({ message: "Текущий пользователь не найден" });
    }
    if (!friendUser || friendUser.role !== "doctor" || !friendUser.isDoctor) {
      return res
        .status(404)
        .json({ message: "Пользователь для добавления не является доктором" });
    }

    const already = (currentUser.friends || []).some(
      (f) => String(f.userId) === String(friendId)
    );
    if (already) {
      return res
        .status(400)
        .json({ message: "Этот пользователь уже у вас в друзьях" });
    }

    const pushRes = await User.updateOne(
      { _id: currentUserId },
      { $push: { friends: { userId: friendUser._id, addedAt: new Date() } } }
    );

    if (pushRes.modifiedCount !== 1) {
      return res.status(500).json({ message: "Не удалось добавить в друзья" });
    }

    return res.status(200).json({ message: "Друг успешно добавлен" });
  } catch (error) {
    console.error("❌ addFriend:", error);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/** =========================================================
 *  Удалить коллегу из друзей (User._id или ProfileDoctor._id)
 * ========================================================= */
export const removeFriend = async (req, res) => {
  const { friendId } = req.params;
  const currentUserId = req.userId;

  if (!isObjectId(currentUserId)) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  if (!isObjectId(friendId)) {
    return res.status(400).json({ message: "Некорректный ID друга" });
  }

  try {
    let targetUserId = new mongoose.Types.ObjectId(friendId);
    let matchedBy = "userId";

    const me = await User.findById(currentUserId)
      .select("friends.userId")
      .lean();
    const hasByUserId = me?.friends?.some(
      (f) => String(f.userId) === String(friendId)
    );

    if (!hasByUserId) {
      const prof = await ProfileDoctor.findOne({
        $or: [{ _id: friendId }, { userId: friendId }],
      })
        .select("userId")
        .lean();

      if (!prof?.userId) {
        return res
          .status(404)
          .json({ message: "Друг не найден (не удалось сопоставить ID)" });
      }
      targetUserId = new mongoose.Types.ObjectId(prof.userId);
      matchedBy = "profileId";
    }

    const pullRes = await User.updateOne(
      { _id: currentUserId },
      { $pull: { friends: { userId: targetUserId } } }
    );

    if (pullRes.modifiedCount === 0) {
      return res.status(404).json({ message: "Друг не найден в вашем списке" });
    }

    return res
      .status(200)
      .json({ message: `Друг успешно удалён (${matchedBy})` });
  } catch (error) {
    console.error("❌ removeFriend:", error);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/** =========================================================
 *  Получить список моих друзей
 *  Возвращает: [{ id, userId, profileId, firstName, lastName, avatar, addedAt, specialization, specializations, country }]
 * ========================================================= */
export const getMyFriends = async (req, res) => {
  const currentUserId = req.userId;

  if (!currentUserId || !isObjectId(currentUserId)) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }

  try {
    // подтягиваем друзей (userId) без strict populate по профилю
    const currentUser = await User.findById(currentUserId)
      .select("friends.userId friends.addedAt")
      .populate({
        path: "friends.userId",
        select:
          "_id firstNameEncrypted lastNameEncrypted role isDoctor specialization specializations country",
      });

    if (!currentUser) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    const userIds = (currentUser.friends || [])
      .map((f) => f.userId?._id)
      .filter(Boolean);

    // профили БЕЗ populate, возьмём id и потом самим сконвертируем в имена
    const profiles = await ProfileDoctor.find({ userId: { $in: userIds } })
      .select(
        "_id userId profileImage specialization specializations speciality specialities country"
      )
      .lean();

    const profileByUserId = new Map(profiles.map((p) => [String(p.userId), p]));

    // собрать все id специализаций, чтобы одним запросом достать имена
    const allSpecIds = new Set();
    for (const f of currentUser.friends || []) {
      const u = f.userId;
      if (!u?._id) continue;
      const prof = profileByUserId.get(String(u._id));
      if (!prof) continue;
      const { ids } = pickSpecPayload(prof, u);
      ids.forEach((id) => allSpecIds.add(id));
    }

    const specDocs = await Specialization.find({
      _id: { $in: Array.from(allSpecIds) },
    })
      .select("_id name")
      .lean();
    const specNameById = new Map(specDocs.map((s) => [String(s._id), s.name]));

    const friends = (currentUser.friends || [])
      .map(({ userId, addedAt }) => {
        if (!userId || !userId._id) return null;
        const dec = decryptSafe(userId);
        const prof = profileByUserId.get(String(userId._id));
        if (!prof) return null; // как и раньше

        const { ids, names } = pickSpecPayload(prof, userId);
        const fromIds = ids.map((id) => specNameById.get(id)).filter(Boolean);
        const specList = uniq([...names, ...fromIds]);

        const country =
          countryAsString(prof?.country) ||
          countryAsString(userId?.country) ||
          "";

        return {
          id: String(prof._id),
          userId: String(userId._id),
          profileId: String(prof._id),
          firstName: dec.firstName,
          lastName: dec.lastName,
          avatar: pickAvatar(prof),
          addedAt,
          specialization: specList.join(", "),
          specializations: specList,
          country,
        };
      })
      .filter(Boolean);

    return res.status(200).json({ friends });
  } catch (error) {
    console.error("❌ getMyFriends:", error);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};
