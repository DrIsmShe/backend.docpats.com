import { tReq } from "../../i18n/index.js";
export const verifyAdmin = (req, res, next) => {
  if (req.user && req.user.role === admin) {
    next();
  } else {
    res.status(403).json({ message: tReq(req, "app.access.forbidden") });
  }
};
