import { tReq } from "../../i18n/index.js";
const checkIfBlocked = (req, res, next) => {
  if (req.user && req.user.isBlocked) {
    return res.status(403).json({ message: tReq(req, "app.account.blocked") });
  }
  next();
};

export default checkIfBlocked;
