// server/modules/aiAssistant/controller/patientTimelineController.js

import mongoose from "mongoose";

import CTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import MRIScan from "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import AngiographyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import CoronographyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/Coronographyscan.js";
import DoplerScan from "../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";
import EchoEKGScan from "../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";
import EEGScan from "../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import EKGScan from "../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGscan.js";
import GinecologyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import HOLTERScan from "../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
import PETScan from "../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import SPECTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import USMScan from "../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import XRayScan from "../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";

import CapsuleEndoscopyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import GastroscopyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";
import SpirometryScan from "../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScan.js";

import LabTest from "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";

/* ------------------------------------------------------- */
/*  Extract events from model                              */
/* ------------------------------------------------------- */

async function extractEvents(Model, patientId, label) {
  const patientObjectId = new mongoose.Types.ObjectId(patientId);

  const scans = await Model.find({
    $or: [
      { patient: patientObjectId },
      { patientId: patientObjectId },
      { patientID: patientObjectId },

      // новый универсальный вариант
      {
        patient: patientObjectId,
        patientModel: "NewPatientPolyclinic",
      },
      {
        patient: patientObjectId,
        patientModel: "DoctorPrivatePatient",
      },
    ],
  })
    .select(
      "nameofexam date examDate createdAt testType riskLevel aiConfidence",
    )
    .lean();

  return scans.map((scan) => ({
    type: label,
    title: scan.nameofexam || scan.testType || `${label} Study`,
    date: scan.date || scan.examDate || scan.createdAt,
    severity: scan.riskLevel || null,
    aiConfidence: scan.aiConfidence || null,
  }));
}
/* ------------------------------------------------------- */
/*  GET PATIENT TIMELINE                                   */
/* ------------------------------------------------------- */

export const getPatientTimeline = async (req, res) => {
  try {
    const { patientId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({
        message: "Invalid patientId",
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;

    const models = [
      [CTScan, "CT"],
      [MRIScan, "MRI"],
      [AngiographyScan, "Angiography"],
      [CoronographyScan, "Coronography"],
      [DoplerScan, "Doppler"],
      [EchoEKGScan, "Echo EKG"],
      [EEGScan, "EEG"],
      [EKGScan, "EKG"],
      [GinecologyScan, "Gynecology"],
      [HOLTERScan, "Holter"],
      [PETScan, "PET"],
      [SPECTScan, "SPECT"],
      [USMScan, "Ultrasound"],
      [XRayScan, "X-Ray"],
      [CapsuleEndoscopyScan, "Capsule Endoscopy"],
      [GastroscopyScan, "Gastroscopy"],
      [SpirometryScan, "Spirometry"],
      [LabTest, "Lab Test"],
    ];

    const results = await Promise.all(
      models.map(([Model, label]) => extractEvents(Model, patientId, label)),
    );

    let events = results.flat();

    /* --- remove empty dates --- */

    events = events.filter((e) => e.date);

    /* --- sort by newest --- */

    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = events.length;
    const totalPages = Math.ceil(total / limit);

    const start = (page - 1) * limit;

    const paginatedEvents = events.slice(start, start + limit);

    /* --- group by year --- */

    const grouped = {};

    paginatedEvents.forEach((event) => {
      const year = new Date(event.date).getFullYear();

      if (!grouped[year]) grouped[year] = [];

      grouped[year].push(event);
    });

    const timeline = Object.keys(grouped)
      .sort((a, b) => b - a)
      .map((year) => ({
        year: Number(year),
        events: grouped[year],
      }));

    res.json({
      page,
      limit,
      total,
      totalPages,
      events: paginatedEvents,
      timeline,
    });
  } catch (error) {
    console.error("Timeline error:", error);

    res.status(500).json({
      message: "Timeline error",
    });
  }
};
