const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendPasswordResetEmail = async (email, resetLink) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Password Reset",
    html: `
        <h3>Password Reset</h3>
        <p>You have requested to reset your password.</p>
        <p>Please click the following link to reset your password:</p>
        <a href="${resetLink}">Reset Password</a>
      `,
  };

  await transporter.sendMail(mailOptions);
};
const sendAppointmentEmails = async (userEmail, patientEmail, appointment) => {
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
};
const sendCancellationEmail = async (email, reason) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Appointment Cancellation",
    html: `
        <h3>Appointment Cancellation</h3>
        <p>Your appointment has been cancelled by the doctor.</p>
        <p>Reason: ${reason}</p>
      `,
  };

  await transporter.sendMail(mailOptions);
};
const sendVerificationEmail = async (email, token) => {
  const transporter2 = nodemailer.createTransport({
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
    html: `<html xmlns="http://www.w3.org/1999/xhtml" style="width:100%; height:100%;">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>El. pašto patvirtinimasn</title>
    </head>
    <body style="width:100%; height:100%; margin:0; padding:32px; font: normal normal normal 14px/21px Arial,sans-serif; color:#333; background-color:#f1f1f1; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
        <table class="email-wrapper" style="width:100%; height:100%; margin:auto; padding:0; text-align:center; vertical-align:middle; border-spacing:0; border-collapse:collapse;"><tr><td>
        
        <table class="email-layout" style="width:450px; height:300px; margin:auto; padding:0; vertical-align:middle; border-spacing:0; border-collapse:collapse;">
            <thead class="email-header" style="text-align:center;"><tr><th style="padding-bottom:32px; text-align:center; font-weight:normal;">            
                <a href="https://gerapagalba.lt" target="_blank" style="text-decoration:none; color:#446cb3 !important;"> 
            </th></tr></thead>
            
            <tbody class="email-body"><tr><td style="text-align:left;">     
                <div style="padding:21px 32px; background-color:#fff; border-bottom:2px solid #e1e1e1; border-radius:3px;">
                    <h1 style="font-size:21px; line-height:30px; font-weight:bold;">El. pašto patvirtinimas</h1>
    
                    <p style="padding:11px 0; text-align:left;">
                        <a href="${process.env.CLIENT_URL}/verify/${token}" style="width: 1rem; border-radius: 10px; background-color: #00E573; padding-top: 0.75rem; padding-bottom: 0.75rem; padding-left: 2rem; padding-right: 2rem; text-align: center; font-weight: 600; color: white; transition: all; hover: background-color: #00E573;">
    Patvirtinti</a>
                    </p>
    
                </div>
            </td></tr></tbody>
            
            <tfoot class="email-footer" style="text-align:center; font-weight:normal;"><tr><td style="padding-top:32px;">
                <div style="color:#999;">
                    <a href="https://gerapagalba.lt/kontaktai" target="_blank" style="text-decoration:none; color:#446cb3 !important;">Kontaktai</a> |
                    <a href="https://gerapagalba.lt/prisijungimas" target="_blank" style="text-decoration:none; color:#446cb3 !important;">Prisijungimas</a>
                </div>
            </td></tr></tfoot>
        </table>
            
        </td></tr></table>
    </body>
    </html>`,
  };

  await transporter2.sendMail(mailOptions);
};
module.exports = {
  sendPasswordResetEmail,
  sendAppointmentEmails,
  sendCancellationEmail,
  sendVerificationEmail,
};
