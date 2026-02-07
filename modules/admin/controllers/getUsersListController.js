// ВАЖНО: путь поправьте под вашу структуру проекта
// Если схема из messages выше лежит как models/User.js (ESM):
import User, {
  decrypt,
  ROLE_PRESETS,
} from "../../../common/models/Auth/users.js";

const getUsersListController = async (req, res) => {
  try {
    const includePerms = String(req.query.includePerms || "0") === "1";

    const docs = await User.find()
      .select([
        "_id",
        "username",
        "role",
        "isBlocked",
        "bio",
        "createdAt",
        "dateOfBirth",
        "firstNameEncrypted",
        "lastNameEncrypted",
        "emailEncrypted",
        "status",
        "lastActive",
        "country", // берём страну
        ...(includePerms ? ["access.permissions", "role"] : []),
      ])
      .lean({ virtuals: true });

    const ONLINE_MS = 2 * 60 * 1000; // < 2 минут — online
    const AWAY_MS = 15 * 60 * 1000; // 2–15 минут — away

    const users = docs.map((u) => {
      const email = u.emailEncrypted ? decrypt(u.emailEncrypted) : null;

      const firstName =
        typeof u.firstName === "undefined" && u.firstNameEncrypted
          ? decrypt(u.firstNameEncrypted)
          : u.firstName ?? null;

      const lastName =
        typeof u.lastName === "undefined" && u.lastNameEncrypted
          ? decrypt(u.lastNameEncrypted)
          : u.lastName ?? null;

      // Эффективные права (если нужно)
      let effectivePermissions = [];
      if (includePerms) {
        const roleBase = ROLE_PRESETS[u.role] || [];
        const extra = Array.isArray(u?.access?.permissions)
          ? u.access.permissions
          : [];
        effectivePermissions = Array.from(new Set([...roleBase, ...extra]));
      }

      // Эффективный статус
      let effectiveStatus = u.status || "offline";
      if (effectiveStatus !== "invisible") {
        const last = u.lastActive ? new Date(u.lastActive).getTime() : 0;
        const diff = Date.now() - last;
        if (last) {
          if (diff <= ONLINE_MS) effectiveStatus = "online";
          else if (diff <= AWAY_MS) effectiveStatus = "away";
          else effectiveStatus = "offline";
        }
      }

      const {
        emailEncrypted,
        firstNameEncrypted,
        lastNameEncrypted,
        emailHash,
        firstNameHash,
        lastNameHash,
        password,
        ...safe
      } = u;

      return {
        ...safe, // _id, username, role, createdAt, lastActive, country, ...
        username: u.username ?? null,
        email: email ?? null,
        firstName,
        lastName,
        status: effectiveStatus,
        country: u.country ?? null,
        ...(includePerms ? { effectivePermissions } : {}),
      };
    });

    return res.status(200).json(users);
  } catch (error) {
    console.error("Error getting list of users:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export default getUsersListController;
