// Sends one test email using the SMTP settings in .env.
// Usage: npm run test-email -- someone@example.com
require("dotenv").config();

const { mailer, verifyMailer, sendMail } = require("../mailer");

async function main() {
  const to = process.argv[2] || process.env.SMTP_USER;
  if (!mailer) {
    await verifyMailer(); // explains what's missing
    process.exit(1);
  }
  if (!to) {
    console.error("Usage: npm run test-email -- someone@example.com");
    process.exit(1);
  }

  if (!(await verifyMailer())) {
    process.exit(1);
  }

  const info = await sendMail({
    to,
    subject: "Slack AI Workspace — test email",
    text: "If you can read this, invite emails from #general are working."
  });
  console.log(`Test email sent to ${to} (message id ${info.messageId})`);
}

main().catch((error) => {
  console.error("Sending failed:", error.message || error);
  process.exit(1);
});
