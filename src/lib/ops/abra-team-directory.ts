/**
 * Abra Dynamic Team & Vendor Directory
 *
 * Replaces hardcoded team context in abra-system-prompt.ts with
 * DB-backed team and vendor records from `abra_team` and `abra_vendors`.
 *
 * Falls back to hardcoded defaults if DB is unavailable.
 */

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  department: string;
  responsibilities: string[];
  is_active: boolean;
  started_at: string | null;
};

export type Vendor = {
  id: string;
  name: string;
  vendor_type: string;
  contact_name: string | null;
  contact_email: string | null;
  location: string | null;
  products_services: string[];
  notes: string | null;
  is_active: boolean;
};

// Hardcoded fallback — matches what was in abra-system-prompt.ts
const FALLBACK_TEAM: TeamMember[] = [
  {
    id: "fallback-ben",
    name: "Ben Stutman",
    role: "CEO & Founder",
    email: "ben@usagummies.com",
    department: "executive",
    responsibilities: [
      "Strategic decisions",
      "Sales & growth",
      "Product direction",
    ],
    is_active: true,
    started_at: null,
  },
  {
    id: "fallback-andrew",
    name: "Andrew Slater",
    role: "Operations Manager",
    email: null,
    department: "operations",
    responsibilities: [
      "Production runs",
      "Supply chain",
      "Vendor relationships",
    ],
    is_active: true,
    started_at: null,
  },
  {
    id: "fallback-rene",
    name: "Rene Gonzalez",
    role: "Finance Lead",
    email: null,
    department: "finance",
    responsibilities: [
      "Accounting",
      "Bookkeeping",
      "Cash flow",
      "Financial reporting",
    ],
    is_active: true,
    started_at: null,
  },
];

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const res = await fetch(`${env.baseUrl}${path}`, {
    method: "GET",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase GET ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Fetch active team members from DB, with fallback.
 */
export async function getTeamMembers(): Promise<TeamMember[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_team?is_active=eq.true&select=id,name,role,email,department,responsibilities,is_active,started_at&order=name",
    )) as TeamMember[];

    if (rows.length === 0) return FALLBACK_TEAM;
    return rows;
  } catch {
    return FALLBACK_TEAM;
  }
}

/**
 * Fetch active vendors from DB.
 */
export async function getVendors(): Promise<Vendor[]> {
  try {
    return (await sbFetch(
      "/rest/v1/abra_vendors?is_active=eq.true&select=id,name,vendor_type,contact_name,contact_email,location,products_services,notes,is_active&order=name",
    )) as Vendor[];
  } catch {
    return [];
  }
}

/**
 * Get team members for a specific department.
 */
export async function getTeamByDepartment(
  department: string,
): Promise<TeamMember[]> {
  const team = await getTeamMembers();
  return team.filter(
    (m) => m.department.toLowerCase() === department.toLowerCase(),
  );
}

/**
 * Build team context string for the system prompt.
 * Replaces the hardcoded section in abra-system-prompt.ts.
 */
export function buildTeamContext(
  team: TeamMember[],
  vendors: Vendor[],
  today: string,
): string {
  const sections: string[] = [];

  // Team section
  const teamLines = team
    .map((m) => {
      const responsibilities = m.responsibilities.join(", ");
      return `• ${m.name} — ${m.role} (${m.department}). ${responsibilities}.`;
    })
    .join("\n");
  sections.push(
    `TEAM (current as of ${today}, from directory — ${team.length} active members):\n${teamLines}\nThese are the current team members. Do NOT reference anyone else as team unless the data explicitly says otherwise.`,
  );

  // Vendor section
  if (vendors.length > 0) {
    const vendorLines = vendors
      .map((v) => {
        const loc = v.location ? `, ${v.location}` : "";
        const services = v.products_services.join(", ");
        return `• ${v.name} (${v.vendor_type}${loc}) — ${services}${v.notes ? `. ${v.notes}` : ""}`;
      })
      .join("\n");
    sections.push(`KEY VENDORS & PARTNERS:\n${vendorLines}`);
  }

  return sections.join("\n\n");
}
