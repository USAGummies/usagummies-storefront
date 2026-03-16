/**
 * Twilio SMS helper for Abra notifications
 * Sends SMS via Twilio REST API (no SDK needed)
 */

const TWILIO_ACCOUNT_SID = () => process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = () => process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER = () => process.env.TWILIO_PHONE_NUMBER || "";

export async function sendSms(to: string, body: string): Promise<boolean> {
  const accountSid = TWILIO_ACCOUNT_SID();
  const authToken = TWILIO_AUTH_TOKEN();
  const from = TWILIO_PHONE_NUMBER();

  if (!accountSid || !authToken || !from) {
    console.log(
      `[sms] Twilio not configured — would send to ${to}: ${body.slice(0, 50)}`,
    );
    return false;
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: from,
          Body: body.slice(0, 1600), // SMS limit
        }).toString(),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(
        `[sms] Twilio send failed (${res.status}): ${err.slice(0, 200)}`,
      );
      return false;
    }

    console.log(`[sms] Sent to ${to}: ${body.slice(0, 50)}...`);
    return true;
  } catch (err) {
    console.error(`[sms] Twilio error:`, err);
    return false;
  }
}

/**
 * Send an SMS to the Abra owner (Ben) for approval notifications
 */
export async function notifyOwnerViaSms(
  message: string,
): Promise<boolean> {
  const ownerPhone = process.env.ABRA_OWNER_PHONE || "+14358967765";
  return sendSms(ownerPhone, message);
}
