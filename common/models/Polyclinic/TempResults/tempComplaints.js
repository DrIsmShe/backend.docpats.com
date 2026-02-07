// Import mongoose for schema creation
import mongoose from "mongoose";

// Define schema for Complaints template
const tempComplaints = new mongoose.Schema(
  {
    // Title of the complaint template
    title: {
      type: String,
      required: true, // Field is mandatory
      trim: true, // Removes extra spaces from both ends of the string
      minlength: [3, "Title must be at least 3 characters long"], // Minimum length for title
      unique: true, // Ensures the title is unique
      index: true, // Creates an index for faster search
    },
    // Content of the complaint template
    content: {
      type: String,
      required: true, // Field is mandatory
      trim: true, // Removes extra spaces
      minlength: [10, "Content must be at least 10 characters long"], // Minimum length for content
    },
    // User who created the template
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Reference to the user model
      required: true, // Ensures accountability
    },
    // Tags for categorization
    tags: {
      type: [String], // Array of tags
      default: [], // Default empty array
    },
    // Status of the template (active or not)
    isActive: {
      type: Boolean, // Boolean flag
      default: true, // Template is active by default
    },
    // Date when the template was created
    createdAt: {
      type: Date,
      default: Date.now, // Automatically sets the current date/time
    },
    // Date when the template was last updated
    updatedAt: {
      type: Date,
      default: Date.now, // Automatically updates on document save
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

// Middleware to update the updatedAt field before saving
tempComplaints.pre("save", function (next) {
  this.updatedAt = Date.now(); // Ensure updatedAt reflects the current time
  next();
});

// Create a method to search by title
tempComplaints.methods.findByTitle = function (title) {
  return this.model("TempComplaints").find({
    title: new RegExp(title, "i"), // Case-insensitive search
  });
};

// Create and export the model
const TempComplaints = mongoose.model("TempComplaints", tempComplaints);

export default TempComplaints;
