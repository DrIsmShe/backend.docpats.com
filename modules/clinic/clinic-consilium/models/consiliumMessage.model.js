// server/modules/clinic/clinic-consilium/models/consiliumMessage.model.js
//
// ConsiliumMessage = one opinion/comment in a consilium thread.
//
// The body is ENCRYPTED at rest (AES-256-GCM via consiliumCrypto) because a
// case discussion may contain PHI — same scheme as the chat module's
// textEncrypted field. The plaintext is never stored.

import mongoose from "mongoose";

const { Schema } = mongoose;

const consiliumMessageSchema = new Schema(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    consiliumId: {
      type: Schema.Types.ObjectId,
      ref: "Consilium",
      required: true,
      index: true,
    },

    // Membership of the author (optional — may be null for system notes).
    authorMembershipId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },

    // Encrypted message body: "iv:authTag:ciphertext" (hex). Never plaintext.
    textEncrypted: {
      type: String,
      required: true,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "clinic_consilium_messages",
  },
);

// Thread fetch: messages of a consilium in chronological order.
consiliumMessageSchema.index({ clinicId: 1, consiliumId: 1, createdAt: 1 });

const ConsiliumMessage =
  mongoose.models.ConsiliumMessage ||
  mongoose.model(
    "ConsiliumMessage",
    consiliumMessageSchema,
    "clinic_consilium_messages",
  );

export default ConsiliumMessage;
