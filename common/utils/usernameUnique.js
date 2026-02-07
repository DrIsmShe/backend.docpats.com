// utils/usernameUnique.js
import User from "../common/models/users.js";
import { sanitizeUsername } from "./sanitizeUsername.js";

export async function ensureUniqueUsername(base) {
  let u = sanitizeUsername(base);
  if (!u) u = "user";

  let i = 0;
  while (await User.exists({ username: u })) {
    i += 1;
    const suffix = String(i);
    u = sanitizeUsername((base + suffix).slice(0, 30));
  }
  return u;
}
