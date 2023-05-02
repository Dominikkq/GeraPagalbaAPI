const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const axios = require("axios");
const Stripe = require("stripe");

dotenv.config();
const app = express();

app.use(cors());
app.use(helmet());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

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
  profilePhoto: String,
  isVerified: { type: Boolean, default: false },
  doctor: { type: Boolean, default: true },
  verificationToken: String,
  helpOptions: [],
  languageOptions: [],
  rates: {
    15: { type: Number, default: 0 },
    30: { type: Number, default: 0 },
    45: { type: Number, default: 0 },
    60: { type: Number, default: 0 },
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
        "userId name lastname profilePhoto helpOptions languageOptions rates"
      )
      .limit(30);

    return res.status(200).json({ doctors });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/rateDoctor", authenticateToken, async (req, res) => {
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

    const appointmentsMade = user.appointmentsMade;

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

    res.status(200).json({ appointments });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function sendAppointmentEmails(userEmail, patientEmail, appointment) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const userMailOptions = {
    from: process.env.EMAIL_USER,
    to: userEmail,
    subject: "New Appointment Registration",
    html: `
      <h3>New Appointment Registration</h3>
      <p>You have successfully created a new appointment:</p>
      <p>Date: ${appointment.start}</p>
      <p>Notes: ${appointment.notes}</p>
    `,
  };

  const patientMailOptions = {
    from: process.env.EMAIL_USER,
    to: patientEmail,
    subject: "Appointment Reminder",
    html: `
      <h3>Appointment Reminder</h3>
      <p>This is a reminder for your upcoming appointment:</p>
      <p>Date: ${appointment.start}</p>
      <p>Notes: ${appointment.notes}</p>
    `,
  };

  await transporter.sendMail(userMailOptions);
  await transporter.sendMail(patientMailOptions);
}
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

async function createAppointment(userId, doctorId, start, end, notes) {
  try {
    const doctor = await Doctor.findOne({ userId: doctorId });
    if (!doctor) {
      return res.status(404).json({ error: "User not found" });
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
      patientId: doctorId,
      appointmentUrl: wherebyMeeting.data.roomUrl,
      meetingId: wherebyMeeting.data.meetingId,
    };

    doctor.appointments.push(newAppointment);
    await doctor.save();
    const patient = await User.findOne({ userId: patientId });
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

    res.status(200).json({ message: "Appointment created successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

app.put("/edit", authenticateToken, async (req, res) => {
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
    await targetUser.save();

    res.status(200).json({ message: "User updated successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const buildResponse = (user, fields) => {
  const responseObject = {};
  fields.forEach((field) => {
    responseObject[field] = user[field];
  });
  return responseObject;
};
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
    }
  ).limit(30);
  return res.status(200).json({ doctors });
});

app.get("/user/:userId?", async (req, res) => {
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
app.post("/register", async (req, res) => {
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
    res.status(200).json({ token, userId: savedUser.userId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    var user = await User.findOne({ email });
    if (!user) {
      user = await Doctor.findOne({ email });
    }
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const isPasswordMatch = bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
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
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        // Extract appointment details from the metadata
        const { userId, doctorId, start, end, notes } = session.metadata;

        // Call the createAppointment function with the extracted details
        createAppointment(userId, doctorId, start, end, notes);
      }
    }

    res.status(200).send("Webhook received");
  }
);

app.post("/create-checkout-session", async (req, res) => {
  // Extract appointment details from the request
  const { userId, doctorId, start, end, notes } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Appointment",
            },
            unit_amount: 500, // 5 EUR
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${domainURL}/success`,
      cancel_url: `${domainURL}/cancel`,
      locale: "lt",
      metadata: {
        userId,
        doctorId,
        start,
        end,
        notes,
      },
    });

    res.send({
      sessionId: session.id,
    });
  } catch (err) {
    res.status(500).send({
      error: "An error occurred while creating the session",
    });
  }
});

async function sendVerificationEmail(email, token) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Email Verification",
    html: `
      <h3>Verify your email</h3>
      <p>Click the link below to verify your email:</p>
      <a href="${process.env.CLIENT_URL}/verify/${token}">Verify Email</a>
    `,
  };

  await transporter.sendMail(mailOptions);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));