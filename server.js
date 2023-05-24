import {
  sendPasswordResetEmail,
  sendAppointmentEmails,
  sendCancellationEmail,
  sendVerificationEmail,
} from "./email.js";
const express = require("express");
const mongoose = require("mongoose");

const bodyParser = require("body-parser");
const dotenv = require("dotenv");

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const axios = require("axios");
const Stripe = require("stripe");
const fs = require("fs");
const https = require("https");
const cors = require("cors");

dotenv.config();
const app = express();
app.use(cors());
app.use(helmet());
//app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

app.use(
  bodyParser.raw({
    inflate: true,
    limit: "100kb",
    type: "application/octet-stream",
  })
);
const jsonBodyParser = bodyParser.json({ limit: "50mb" });

// Implement rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
mongoose.connection.once("open", () => console.log("Connected to MongoDB"));

const RatingSchema = new mongoose.Schema({
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});
const doctorSchema = new mongoose.Schema({
  userId: String,
  name: String,
  lastname: String,
  email: String,
  password: String,
  description: String,
  resetPasswordToken: String, // New field for password reset token
  resetPasswordExpires: Date, // New field for token expiration date
  profilePhoto: String,
  isVerified: { type: Boolean, default: false },
  doctor: { type: Boolean, default: true },
  balance: { type: Number, default: 0 },
  busy: [
    {
      start: String,
      end: String,
    },
  ],
  verificationToken: String,
  helpOptions: [],
  languageOptions: [],
  rates: {
    15: { type: Number, default: 0 },
    30: { type: Number, default: 0 },
    45: { type: Number, default: 0 },
    60: { type: Number, default: 0 },
  },
  workdayHours: {
    from: { type: Number, default: 0 },
    to: { type: Number, default: 0 },
  },
  weekendHours: {
    from: { type: Number, default: 0 },
    to: { type: Number, default: 0 },
  },
  averageRating: {
    type: Number,
    default: 0,
  },
  appointments: [
    {
      appointmentId: String,
      createdAt: Date,
      updatedAt: String,
      notes: String,
      start: String,
      end: String,
      patientId: String,
      doctorFullName: String,
      appointmentUrl: String,
      meetingId: String,
      price: Number,
    },
  ],
});

const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  lastname: String,
  email: String,
  password: String,
  description: String,
  resetPasswordToken: String, // New field for password reset token
  resetPasswordExpires: Date, // New field for token expiration date
  profilePhoto: String,
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  languageOptions: [],
  appointmentsMade: [
    {
      appointmentId: String,
      createdAt: Date,
      updatedAt: String,
      notes: String,
      start: String,
      end: String,
      doctorId: String,
      appointmentUrl: String,
      doctorFullName: String,
      meetingId: String,
      rating: { type: Number, default: 0 },
    },
  ],
});
const Doctor = mongoose.model("Doctor", doctorSchema);
const User = mongoose.model("User", userSchema);
const Rating = mongoose.model("Rating", RatingSchema);
function isTokenExpired(token) {
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded || !decoded.payload.exp) {
    return true;
  }

  const currentTime = Date.now() / 1000;

  return decoded.payload.exp < currentTime;
}
async function getUserIdFromToken(partialToken) {
  try {
    var targetUser;
    // Get verification token from database
    const decodedToken = jwt.verify(partialToken, process.env.JWT_SECRET);
    const user = await User.findOne({ email: decodedToken.email });
    const doctor = await Doctor.findOne({ email: decodedToken.email });
    if (user) {
      targetUser = user;
    } else if (doctor) {
      targetUser = doctor;
    }
    // Verify full verification token and return userId
    return targetUser.userId;
  } catch (error) {
    console.error(error);
    return null;
  }
}
app.get("/sortedDoctors", async (req, res) => {
  const { sortBy, order } = req.query;
  const sortCriteria = {};

  let languageOptions = [];
  let helpOptions = [];
  let appointmentLength = [];
  let price = [];

  if (sortBy) {
    try {
      const parsedSortBy = JSON.parse(sortBy);
      languageOptions = parsedSortBy.languageOptions || [];
      helpOptions = parsedSortBy.helpOptions || [];
      appointmentLength = parsedSortBy.appointmentLength || [];
      price = parsedSortBy.price || [];
    } catch (error) {
      return res.status(400).json({ error: "Invalid sort criteria" });
    }
  }

  if (order && ["desc", "asc"].includes(order)) {
    sortCriteria["rates"] = order === "desc" ? -1 : 1;
  } else {
    return res.status(400).json({ error: "Invalid sort order" });
  }

  const filterCriteria = { doctor: true };

  if (languageOptions.length > 0) {
    filterCriteria["languageOptions"] = { $in: languageOptions };
  }

  if (helpOptions.length > 0) {
    filterCriteria["helpOptions"] = { $in: helpOptions };
  }

  if (appointmentLength.length > 0 && price.length > 0) {
    filterCriteria[`rates.${appointmentLength[0]}`] = {
      $gt: price[0],
      $lt: price[1],
    };
  }

  try {
    const doctors = await Doctor.find(filterCriteria)
      .sort(sortCriteria)
      .select(
        "userId name lastname profilePhoto helpOptions languageOptions rates averageRating"
      )
      .limit(30);

    return res.status(200).json({ doctors });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/rateDoctor", jsonBodyParser, authenticateToken, async (req, res) => {
  const token = req.headers["authorization"].split(" ")[1];
  const { doctorId, rating, appointmentId } = req.body;

  try {
    var userId = await getUserIdFromToken(token);

    const user = await User.findOne({ userId: userId });

    const appointment = user.appointmentsMade.find(
      (appointment) => appointment.appointmentId === appointmentId
    );
    if (!appointment) {
      throw new Error("Appointment not found.");
    }
    if (appointment.rating != 0) {
      throw new Error("Already rated.");
    }
    const now = new Date();
    if (appointment.end > now) {
      throw new Error("Cannot rate before the appointment has ended.");
    }

    // Calculate the new average rating for the doctor
    const ratings = await Rating.find({ doctorId });
    const sumRatings = ratings.reduce((acc, cur) => acc + cur.rating, 0);
    const averageRating = sumRatings / ratings.length;

    // Update the doctor's average rating
    const updatedDoctor = await Doctor.findOneAndUpdate(
      { userId: doctorId },
      { $set: { averageRating } },
      { new: true }
    );

    if (!updatedDoctor) {
      throw new Error("Doctor not found.");
    }

    // Update the appointment with the rating
    appointment.rating = rating;
    await user.save();

    res.status(200).json({ message: "Rating submitted successfully." });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Failed to submit rating." });
  }
});

app.get("/appointmentsMade", authenticateToken, async (req, res) => {
  const partialToken = req.headers["authorization"].split(" ")[1];

  // Check if token is expired
  if (isTokenExpired(partialToken)) {
    return res.status(401).json({ error: "Token expired" });
  }

  // Get userId from token
  const userId = await getUserIdFromToken(partialToken);

  if (!userId) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const appointmentsMade = user.appointmentsMade.sort((a, b) =>
      a.start.localeCompare(b.start)
    );

    res.status(200).json({ appointmentsMade });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = decoded;
    next();
  });
}
app.get("/appointments/:userId", async (req, res) => {
  const token = req.headers["authorization"].split(" ")[1];

  // Get userId from token

  const userId = req.params.userId;

  try {
    const user = await Doctor.findOne({ userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    var appointments = [];

    if (token && (await getUserIdFromToken(token)) == user.userId) {
      const tokenId = await getUserIdFromToken(token);
      if (tokenId == userId) {
        if (isTokenExpired(token)) {
          return res.status(401).json({ error: "Token expired" });
        }
        appointments = user.appointments;
      }
    } else {
      user.appointments.forEach((appo) => {
        appointments.push({ start: appo.start, end: appo.end });
      });
    }

    res.status(200).json({ appointments: appointments, busy: user.busy });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete(
  "/appointmentsCancelforDoctor/:appointmentId/:cancellationReason",
  authenticateToken,
  async (req, res) => {
    const token = req.headers["authorization"].split(" ")[1];

    if (isTokenExpired(token)) {
      return res.status(401).json({ error: "Token expired" });
    }

    const doctorId = await getUserIdFromToken(token);
    const appointmentId = req.params.appointmentId;
    const cancellationReason = req.params.cancellationReason;

    try {
      const doctor = await Doctor.findOne({ userId: doctorId });

      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found" });
      }

      const appointmentIndex = doctor.appointments.findIndex(
        (appointment) => appointment.appointmentId.toString() === appointmentId
      );

      if (appointmentIndex === -1) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      const appointment = doctor.appointments[appointmentIndex];

      // Cancel whereby meeting
      // Generate a new whereby.dev meeting and include the link in the appointment object
      await axios.delete(
        "https://api.whereby.dev/v1/meetings/" + appointment.meetingId,
        {
          headers: {
            Authorization: `Bearer ${process.env.WHEREBY_API_KEY}`,
          },
        }
      );

      // Remove appointment from doctor's appointments array
      doctor.appointments.splice(appointmentIndex, 1);
      await doctor.save();

      // Get the user associated with the appointment
      const user = await User.findOne({ userId: appointment.patientId });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Remove appointment from user's appointmentsMade array
      const userAppointmentIndex = user.appointmentsMade.findIndex(
        (appointment) =>
          appointment.appointmentId.toString() === appointmentId.toString()
      );

      if (userAppointmentIndex !== -1) {
        user.appointmentsMade.splice(userAppointmentIndex, 1);
        await user.save();
      }

      // Send cancellation email to the user
      await sendCancellationEmail(user.email, cancellationReason);

      res.status(200).json({ message: "Appointment cancelled successfully" });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: "Failed to cancel appointment" });
    }
  }
);

app.delete(
  "/appointmentsCancel/:userId/:appointmentId",
  authenticateToken,
  async (req, res) => {
    const token = req.headers["authorization"].split(" ")[1];

    if (isTokenExpired(token)) {
      return res.status(401).json({ error: "Token expired" });
    }

    const userId = req.params.userId;
    const appointmentId = req.params.appointmentId;

    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const appointmentIndex = user.appointmentsMade.findIndex(
      (appointment) => appointment.appointmentId.toString() === appointmentId
    );

    if (appointmentIndex === -1) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appointment = user.appointmentsMade[appointmentIndex];
    var doctorId = appointment.doctorId;
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    // Cancel whereby meeting
    // Generate a new whereby.dev meeting and include the link in the appointment object
    await axios.delete(
      "https://api.whereby.dev/v1/meetings/" + appointment.meetingId,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHEREBY_API_KEY}`,
        },
      }
    );

    // Remove appointment from user's appointments array
    user.appointmentsMade.splice(appointmentIndex, 1);
    await user.save();

    // Remove appointment from doctors appointmentsMade array
    const doctor = await Doctor.findOne({ userId: doctorId });
    const appointmentsIndex = doctor.appointments.findIndex(
      (appointmentMade) =>
        appointmentMade.appointmentId.toString() === appointmentId.toString()
    );

    if (appointmentsIndex !== -1) {
      doctor.appointments.splice(appointmentsIndex, 1);
      await doctor.save();
    }

    res.status(200).json({ message: "Appointment cancelled successfully" });
  }
);

async function createAppointment(userId, doctorId, start, end, notes, value) {
  const doctor = await Doctor.findOne({ userId: doctorId });
  if (!doctor) {
    return res.status(404).json({ error: "Doctor not found" });
  }
  const patient = await User.findOne({ userId: userId });
  if (!patient) {
    return res.status(404).json({ error: "Patient not found" });
  }
  // Generate a new whereby.dev meeting and include the link in the appointment object
  const wherebyMeeting = await axios.post(
    "https://api.whereby.dev/v1/meetings",
    {
      title: "Appointment with ",
      endDate: end,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHEREBY_API_KEY}`,
      },
    }
  );
  const appointmentId = generateRandomId();
  const newAppointment = {
    appointmentId: appointmentId,
    createdAt: new Date(),
    updatedAt: new Date(),
    notes: notes,
    start: start,
    end: end,
    patientId: userId,
    appointmentUrl: wherebyMeeting.data.roomUrl,
    meetingId: wherebyMeeting.data.meetingId,
    price: value,
  };

  doctor.appointments.push(newAppointment);
  await doctor.save();

  const newAppointmentPatient = {
    appointmentId: appointmentId,
    createdAt: new Date(),
    updatedAt: new Date(),
    notes: notes,
    start: start,
    end: end,
    doctorId: doctorId,
    doctorFullName: `${doctor.name} ${doctor.lastname}`,
    appointmentUrl: wherebyMeeting.data.roomUrl,
    meetingId: wherebyMeeting.data.meetingId,
  };
  patient.appointmentsMade.push(newAppointmentPatient);
  await patient.save();
  if (patient) {
    await sendAppointmentEmails(doctor.email, patient.email, newAppointment);
  }

  return "Appointment created successfully";
}

app.put("/edit", jsonBodyParser, authenticateToken, async (req, res) => {
  const token = req.headers["authorization"].split(" ")[1];

  if (isTokenExpired(token)) {
    return res.status(401).json({ error: "Token expired" });
  }

  const userId = await getUserIdFromToken(token);
  const {
    name,
    lastname,
    description,
    profilePhoto,
    helpOptions,
    languageOptions,
    rates,
    weekendHours,
    workdayHours,
  } = req.body;

  try {
    let targetUser;
    const user = await User.findOne({ userId });
    const doctor = await Doctor.findOne({ userId });
    if (user) {
      targetUser = user;
    } else if (doctor) {
      targetUser = doctor;
    }
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (name) targetUser.name = name;
    if (lastname) targetUser.lastname = lastname;
    if (description) targetUser.description = description;
    if (profilePhoto) targetUser.profilePhoto = profilePhoto;
    if (helpOptions) targetUser.helpOptions = helpOptions;
    if (languageOptions) targetUser.languageOptions = languageOptions;
    if (rates) targetUser.rates = rates;
    if (weekendHours) targetUser.weekendHours = weekendHours;
    if (workdayHours) targetUser.workdayHours = workdayHours;
    await targetUser.save();

    return res.status(200).json({ message: "Sėkmingai Atnaujinta" });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

const buildResponse = (user, fields) => {
  const responseObject = {};
  fields.forEach((field) => {
    responseObject[field] = user[field];
  });
  return responseObject;
};
app.post("/busy", jsonBodyParser, authenticateToken, async (req, res) => {
  const token = req.headers["authorization"].split(" ")[1];

  if (isTokenExpired(token)) {
    return res.status(401).json({ error: "Token expired" });
  }

  const userId = await getUserIdFromToken(token);
  const doctor = await Doctor.findOne({ userId });
  if (!doctor) {
    return res.status(404).json({ error: "User not found" });
  }
  doctor.busy.push({ start: req.body.start, end: req.body.end });
  await doctor.save();
  return res.status(200).json({ status: "success" });
});
app.get("/doctors", async (req, res) => {
  const doctors = await Doctor.find(
    { userId: "3329411c059f38b79abfe321" },
    {
      userId: 1,
      name: 1,
      lastname: 1,
      profilePhoto: 1,
      helpOptions: 1,
      rates: 1,
      averageRating: 1,
    }
  ).limit(30);
  return res.status(200).json({ doctors });
});

app.get("/user/:userId?", jsonBodyParser, async (req, res) => {
  const { userId } = req.params;
  var requestedUserId = userId;
  if (!requestedUserId) {
    const token = req.headers["authorization"]?.split(" ")[1];
    requestedUserId = await getUserIdFromToken(token);
  }

  try {
    let targetUser;
    const user = await User.findOne({ userId: requestedUserId });
    const doctor = await Doctor.findOne({ userId: requestedUserId });

    if (user) {
      targetUser = user;
    } else if (doctor) {
      targetUser = doctor;
    }

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser.doctor) {
      const responseFields = [
        "userId",
        "name",
        "lastname",
        "description",
        "profilePhoto",
        "doctor",
        "helpOptions",
        "languageOptions",
        "rates",
        "averageRating",
        "weekendHours",
        "workdayHours",
      ];

      res.status(200).json(buildResponse(targetUser, responseFields));
    } else {
      const token = req.headers["authorization"]?.split(" ")[1];
      const tokenId = await getUserIdFromToken(token);

      if (!token || tokenId !== requestedUserId) {
        return res.status(401).json({ error: "Unauthorized Data" });
      }

      const responseFields = [
        "userId",
        "name",
        "lastname",
        "description",
        "profilePhoto",
        "helpOptions",
        "averageRating",
      ];

      res.status(200).json(buildResponse(targetUser, responseFields));
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function generateRandomId() {
  const buffer = crypto.randomBytes(12);
  return buffer.toString("hex");
}
app.post("/register", jsonBodyParser, async (req, res) => {
  const { name, lastname, email, password, doctor } = req.body;
  let user;
  if (doctor) {
    user = new Doctor({
      userId: generateRandomId(),
      name,
      lastname,
      email,
      password,
      description: "",
      profilePhoto: "",
      isVerified: false,
      doctor: true,
      verificationToken: crypto.randomBytes(20).toString("hex"),
      helpOptions: [],
      languageOptions: [],
      rates: {
        15: 0,
        30: 0,
        45: 0,
        60: 0,
      },
      averageRating: 0,
      appointments: [],
      appointmentsMade: [],
    });
  } else {
    user = new User({
      userId: generateRandomId(),
      name,
      lastname,
      email,
      password,
      description: "",
      profilePhoto: "",
      isVerified: false,
      doctor: false,
      verificationToken: crypto.randomBytes(20).toString("hex"),
      helpOptions: [],
      appointments: [],
      appointmentsMade: [],
    });
  }
  try {
    const savedUser = await user.save();
    const token = jwt.sign(
      { userId: savedUser.userId },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );
    console.log(email);
    sendVerificationEmail(email, token);
    res.status(200).json({ token, userId: savedUser.userId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/forgotPassword", jsonBodyParser, async (req, res) => {
  const { email } = req.body;

  try {
    // Check if the user exists in the database
    var user = await User.findOne({ email: email });

    if (!user) {
      user = await Doctor.findOne({ email: email });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
    }

    // Generate a password reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // Token expires in 1 hour

    // Save the updated user document
    await user.save();

    // Send an email with the password reset instructions
    const resetLink = `${process.env.WEB_URL}/resetPassword/${resetToken}`;
    await sendPasswordResetEmail(email, resetLink);

    res.status(200).json({ message: "Patvirtinimo laiškas išsiūstas" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send password reset email" });
  }
});

app.post("/resetPassword/:token", jsonBodyParser, async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    // Find the user with the provided reset token
    var user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      user = await Doctor.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() },
      });
      if (!user) {
        return res
          .status(400)
          .json({ error: "Neteisingas arba pasibaigęs prieigos raktas" });
      }
    }

    // Update the user's password
    user.password = bcrypt.hashSync(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    // Save the updated user document
    await user.save();

    res.status(200).json({ message: "Slaptažodis pakeistas sėkmingai" });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset password" });
  }
});

app.post("/login", jsonBodyParser, async (req, res) => {
  const { email, password } = req.body;
  try {
    var user = await User.findOne({ email: email });
    if (!user) {
      user = await Doctor.findOne({ email: email });
    }
    if (!user) {
      return res
        .status(401)
        .json({ error: "Neteisingas el. pašto adresas arba slaptažodis" });
    }
    const isPasswordMatch = bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res
        .status(401)
        .json({ error: "Neteisingas el. pašto adresas arba slaptažodis" });
    }
    const { name, lastname } = user;
    const token = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });
    user.verificationToken = token;
    await user.save();
    res.status(200).json({ name, lastname, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/protected", authenticateToken, (req, res) => {
  res.status(200).json({ message: "Protected route" });
});
app.get("/verify/:token", async (req, res) => {
  const { token } = req.params;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOneAndUpdate(
      {
        email: decoded.email,
        userId: decoded.userId,
        verificationToken: token,
      },
      { isVerified: true, verificationToken: null }
    );

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    res.status(200).json({ message: "Email verified successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
const stripe = new Stripe(
  "sk_test_51N3IVhHZicVIiEMtfR1x2qhvlC47uKwad1yUlrz3stzlGc8gWzy0j5eSmjaMC1YKc0tKd7yjF1k9cT5DdWZYzeeJ00gAcrPZED"
);

app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    console.log("Signature:", sig); // Log the signature

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.WEBHOOK_SECRET
      );
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        // Extract appointment details from the metadata
        const { userId, doctorId, start, end, notes, value } = session.metadata;

        // Call the createAppointment function with the extracted details
        createAppointment(userId, doctorId, start, end, notes, value);
      }
    }

    res.status(200).send("Webhook received");
  }
);
app.post("/create-checkout-session", jsonBodyParser, async (req, res) => {
  // Extract appointment details from the request
  const { userId, doctorId, start, end, notes } = req.body;

  // Find the doctor in the database
  const doctor = await mongoose.model("Doctor").findOne({ userId: doctorId });

  if (!doctor) {
    res.status(404).send({ error: "Doctor not found" });
    return;
  }

  // Parse start and end times into date objects
  const startDateTime = new Date(start);
  const endDateTime = new Date(end);

  // Calculate the duration in minutes
  const duration = (endDateTime - startDateTime) / (1000 * 60);

  // Determine the cost based on the duration and doctor's rates
  let cost = 0;
  if (duration <= 15) {
    cost = doctor.rates["15"];
  } else if (duration <= 30) {
    cost = doctor.rates["30"];
  } else if (duration <= 45) {
    cost = doctor.rates["45"];
  } else {
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    cost = hours * doctor.rates["60"];
    if (minutes > 0) {
      if (minutes <= 15) {
        cost += doctor.rates["15"];
      } else if (minutes <= 30) {
        cost += doctor.rates["30"];
      } else {
        cost += doctor.rates["45"];
      }
    }
  }
  // Create a new Stripe Checkout session with the calculated cost
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: "Appointment",
          },
          unit_amount: cost * 100, // Convert to cents for Stripe
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${process.env.WEB_URL}/successPay`,
    cancel_url: `${process.env.WEB_URL}/cancelPay`,
    locale: "lt",
    metadata: {
      userId,
      doctorId,
      start,
      end,
      notes,
      value: cost,
    },
  });

  res.send({
    sessionId: session.id,
  });
});

const httpsOptions = {
  key: fs.readFileSync("./private.key"),
  cert: fs.readFileSync("./certificate.crt"),
  ca: fs.readFileSync("./ca_bundle.crt"),
};

const server = https.createServer(httpsOptions, app);
const port = 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
