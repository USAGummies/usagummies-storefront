/**
 * Multi-Timezone Operations Clock
 *
 * Tracks key people/vendors by timezone for scheduling awareness.
 */

export type ContactTimezone = {
  name: string;
  role: string;
  timezone: string;
  city: string;
  email?: string;
};

const CONTACTS: ContactTimezone[] = [
  { name: "Ben Stutman", role: "CEO", timezone: "America/Los_Angeles", city: "Los Angeles, CA" },
  { name: "Andrew Slater", role: "Operations Manager", timezone: "America/Los_Angeles", city: "WA" },
  { name: "Rene Gonzalez", role: "Finance Lead", timezone: "America/Los_Angeles", city: "CA" },
  { name: "Greg Kroetch", role: "Powers Confections (Co-packer)", timezone: "America/Los_Angeles", city: "Spokane, WA", email: "gregk@powers-inc.com" },
  { name: "Bill Thurner", role: "Albanese Confectionery", timezone: "America/Chicago", city: "Merrillville, IN" },
  { name: "Patrick McDonald", role: "Inderbitzin Distributors", timezone: "America/Denver", city: "Denver, CO", email: "patrickm@inderbitzin.com" },
];

function getLocalTime(tz: string): { time: string; hour: number; isBusinessHours: boolean } {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }));
  return {
    time: timeStr,
    hour,
    isBusinessHours: hour >= 8 && hour < 18,
  };
}

export function getOpsClockStatus(): Array<ContactTimezone & { localTime: string; available: boolean; status: string }> {
  return CONTACTS.map(c => {
    const { time, isBusinessHours } = getLocalTime(c.timezone);
    return {
      ...c,
      localTime: time,
      available: isBusinessHours,
      status: isBusinessHours ? "🟢 Available" : "🔴 Outside hours",
    };
  });
}

export function formatOpsClock(): string {
  const contacts = getOpsClockStatus();
  const lines = [
    `🕐 *Operations Clock*`,
    "",
    ...contacts.map(c =>
      `${c.available ? "🟢" : "🔴"} *${c.name}* (${c.role}) — ${c.localTime} (${c.city})`,
    ),
  ];
  return lines.join("\n");
}

/**
 * Check if a specific contact is available right now.
 */
export function isContactAvailable(name: string): { available: boolean; time: string; note: string } | null {
  const contact = CONTACTS.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
  if (!contact) return null;

  const { time, isBusinessHours, hour } = getLocalTime(contact.timezone);
  let note = "";
  if (!isBusinessHours) {
    if (hour < 8) note = `${contact.name} starts at 8am (${8 - hour}h from now)`;
    else note = `${contact.name} is likely done for the day`;
  }

  return { available: isBusinessHours, time, note };
}
