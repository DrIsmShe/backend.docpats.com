import mongoose from "mongoose";
import crypto from "crypto";

import LabTest from "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js";

/* ================= helpers ================= */

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const getUserId = (req) =>
  req.userId || req.user?.userId || req.session?.userId || null;

const getUserRole = (req) => req.user?.role || req.session?.role || null;

/* ================= decrypt ================= */

const SECRET_KEY = (process.env.ENCRYPTION_KEY || "default_secret_key")
  .padEnd(32, "0")
  .slice(0, 32);

const decrypt = (value) => {
  if (!value || typeof value !== "string" || !value.includes(":")) {
    return value || "";
  }

  try {
    const [ivHex, encryptedHex] = value.split(":");

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (e) {
    return "";
  }
};

/* ================= controller ================= */

const getMyLablFilesDetailsController = async (req, res) => {
  try {
    const rawUserId = getUserId(req);
    const role = getUserRole(req);

    if (!rawUserId) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED",
      });
    }

    const userId = toObjectId(rawUserId);
    const labId = toObjectId(req.params.id);

    if (!labId) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_ID",
      });
    }

    /* ================= FIND LAB ================= */

    let doc = await LabTest.findById(labId);

    if (!doc) {
      doc = await LabTest.findOne({ files: labId });
    }

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
      });
    }

    /* ================= LOAD RELATED ================= */

    const [patient, doctor] = await Promise.all([
      doc.patient ? NewPatientPolyclinic.findById(doc.patient) : null,
      doc.doctor ? User.findById(doc.doctor) : null,
    ]);

    /* ================= ACL ================= */

    const isAdmin = ["admin", "superadmin"].includes(role);

    const isDoctorOwner =
      role === "doctor" && String(doc.doctor) === String(userId);

    const isPatientOwner =
      role === "patient" &&
      req.user?.patientPolyclinicId &&
      String(doc.patient) === String(req.user.patientPolyclinicId);

    if (!(isAdmin || isDoctorOwner || isPatientOwner)) {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
      });
    }

    /* ================= FORMAT ================= */

    const response = {
      _id: String(doc._id),
      date: doc.date || null,

      patient: patient
        ? {
            _id: String(patient._id),
            firstName: patient.firstName || "",
            lastName: patient.lastName || "",
          }
        : null,

      doctor: doctor
        ? {
            _id: String(doctor._id),
            username: doctor.username || "",
            firstName: decrypt(doctor.firstNameEncrypted),
            lastName: decrypt(doctor.lastNameEncrypted),
          }
        : null,

      testType: doc.testType || "",
      labName: doc.labName || "",
      diagnosis: doc.diagnosis || "",
      report: doc.report || "",

      testParameters: Array.isArray(doc.testParameters)
        ? doc.testParameters
        : [],

      files: Array.isArray(doc.files) ? doc.files : [],

      doctorComments: Array.isArray(doc.doctorComments)
        ? doc.doctorComments
        : [],

      validatedByDoctor: Boolean(doc.validatedByDoctor),
      doctorNotes: doc.doctorNotes || "",

      createdAt: doc.createdAt || null,
      updatedAt: doc.updatedAt || null,
    };

    return res.status(200).json({
      ok: true,
      data: response,
    });
  } catch (err) {
    console.error("❌ getMyLablFilesDetailsController error:", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
    });
  }
};

export default getMyLablFilesDetailsController;
