"use server";

import nodemailer from "nodemailer";

export async function sendContactEmail(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const context = String(formData.get("context") || "General").trim();

  if (!name || !email || !message) {
    throw new Error("Missing required fields.");
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.CONTACT_TO_EMAIL;

  if (!host || !user || !pass || !to) {
    throw new Error("Email environment variables are not configured.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: { user, pass },
  });

  const safeText = [
    `Context: ${context}`,
    `From: ${name} <${email}>`,
    "",
    message,
  ].join("\n");

  await transporter.sendMail({
    from: `"USA Gummies" <${user}>`,
    to,
    replyTo: email,
    subject: `[USA Gummies] ${context} — ${name}`,
    text: safeText,
  });
}
