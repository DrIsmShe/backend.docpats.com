export function requirePermission(permission) {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (typeof req.user.can !== "function") {
        return res.status(500).json({ message: "User.can() is not available" });
      }
      if (!req.user.can(permission)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
