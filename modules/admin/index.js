import express from "express";
const router = express.Router();

// system ADMIN start
import blockUserRoute from "./routes/blockUserRoute.js";
import userProfileEditRoute from "./routes/userProfileEditRoute.js";
import deleteUserRoute from "./routes/deleteUserRoute.js";
import categoryRoute from "./routes/categoryRoutes.js";
import isAdminRoute from "./routes/isAdminRoute.js";
import userRoute from "./routes/userRoute.js";
import usersListRoute from "./routes/usersListRoute.js";
import detailUserUpdateRoute from "./routes/detailUserUpdateRoute.js";
import updateUserRoleRoute from "./routes/updateUserRoleRoute.js";
import userDetailGetRoute from "./routes/userDetailGetRoute.js";
import doctorsDetailEditRoute from "./routes/doctorsDetailEditRoute.js";
import userPatientDetailGetRoute from "./routes/userPatientDetailGetRoute.js";
import polyclinicGetRoute from "./routes/polyclinicGetRoute.js";
import polyclinicStaticGetRoute from "./routes/polyclinicStaticGetRoute.js";
import PolyclinicPatientDetailGetRoute from "./routes/PolyclinicPatientDetailGetRoute.js";

import PolyclinicPatientDeleteRoute from "./routes/PolyclinicPatientDeleteRoute.js";
// system ADMIN end
// system ADMIN start
// import { isAdmin } from "./middlewares/admin/isAdmin.js";

//STATISTICA START
router.use("/polyclinic", polyclinicGetRoute);
router.use("/polyclinic-static", polyclinicStaticGetRoute);
//STATISTICA END

router.use("/doctor-detail-edit", doctorsDetailEditRoute);
router.get("/admin-panel", isAdminRoute, (req, res) => {
  res.status(200).json({ message: "Добро пожаловать в админпанель" });
});
router.use("/user/change-role", userRoute);
router.use("/user/edit-profile", userProfileEditRoute);
router.use("/user/users-list", usersListRoute);
router.use("/users/user-detail-update", detailUserUpdateRoute);
router.use("/user-detail-get", userDetailGetRoute);
router.use("/user-patient-detail-get", userPatientDetailGetRoute);

router.use("/polyclinic-patient-detail-get", PolyclinicPatientDetailGetRoute);

router.use("/polyclinic-patient-delete", PolyclinicPatientDeleteRoute);

router.use("/user", updateUserRoleRoute);
router.use("/block-user-from-admin", blockUserRoute);
router.use("/delete-user", deleteUserRoute);
router.use("/my-articles-categories", categoryRoute);

//router.use("/admin-panel", isAdminRoute);
// system ADMIN end
export default router;
