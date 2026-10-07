const nodemailer = require("nodemailer");

// SMTP transport built from .env. Without SMTP_HOST, email is disabled and
// callers fall back to shareable links.

const port = Number(process.env.SMTP_PORT) || 587;

// Example values from the setup instructions that haven't been replaced yet
const PLACEHOLDER_VALUES = ["you@gmail.com", "your-app-password"];
const hasPlaceholders = [process.env.SMTP_USER, process.env.SMTP_PASS].some((v) =>
  PLACEHOLDER_VALUES.includes((v || "").trim())
);

const mailer = process.env.SMTP_HOST && !hasPlaceholders
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            // Gmail shows App Passwords in groups of 4; spaces are not part of it
            pass: (process.env.SMTP_PASS || "").replace(/\s+/g, "")
          }
        : undefined
    })
  : null;

const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

// Checks the SMTP login once at startup so misconfiguration shows up in the logs
async function verifyMailer() {
  if (hasPlaceholders) {
    console.warn(
      "Email: SMTP_USER / SMTP_PASS in .env still have example values — replace them with your Gmail address and App Password"
    );
    return false;
  }
  if (!mailer) {
    console.log("Email: not configured (invites will use shareable links)");
    return false;
  }

  try {
    await mailer.verify();
    console.log(`Email: SMTP ready (${process.env.SMTP_HOST} as ${process.env.SMTP_USER})`);
    return true;
  } catch (error) {
    console.error("Email: SMTP login failed —", error.message || error);
    if (process.env.SMTP_HOST.includes("gmail")) {
      console.error(
        "  For Gmail, SMTP_PASS must be a 16-character App Password (https://myaccount.google.com/apppasswords), not your normal password."
      );
    }
    return false;
  }
}

function sendMail(options) {
  return mailer.sendMail({ from: fromAddress, ...options });
}

module.exports = { mailer, verifyMailer, sendMail };
