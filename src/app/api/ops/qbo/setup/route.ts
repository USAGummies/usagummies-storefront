import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QBO Initial Setup — creates missing Chart of Accounts entries
 * that match the Puzzle.io categories used by USA Gummies.
 *
 * Also creates an "Investor Loan — Rene" liability account.
 *
 * GET /api/ops/qbo/setup
 */

type AccountDef = {
  Name: string;
  AccountType: string;
  AccountSubType: string;
  AcctNum?: string;
  Description?: string;
};

const ACCOUNTS_TO_CREATE: AccountDef[] = [
  // Expense accounts matching Puzzle categories
  {
    Name: "Software - Operating Expense",
    AccountType: "Expense",
    AccountSubType: "Software",
    AcctNum: "66200",
    Description: "SaaS subscriptions and software licenses",
  },
  {
    Name: "Computers & Hardware",
    AccountType: "Expense",
    AccountSubType: "EquipmentRental",
    AcctNum: "66100",
    Description: "Computer equipment and hardware purchases",
  },
  {
    Name: "Independent Contractors",
    AccountType: "Expense",
    AccountSubType: "OtherBusinessExpenses",
    AcctNum: "64100",
    Description: "Payments to freelancers and contractors",
  },
  {
    Name: "Tax and Accounting",
    AccountType: "Expense",
    AccountSubType: "LegalProfessionalFees",
    AcctNum: "64400",
    Description: "Accounting, tax prep, and legal fees",
  },
  {
    Name: "Utilities",
    AccountType: "Expense",
    AccountSubType: "Utilities",
    AcctNum: "67300",
    Description: "Phone, internet, and utilities",
  },
  {
    Name: "Insurance",
    AccountType: "Expense",
    AccountSubType: "Insurance",
    AcctNum: "68100",
    Description: "Business insurance premiums",
  },
  {
    Name: "Supplies",
    AccountType: "Expense",
    AccountSubType: "OfficeGeneralAdministrativeExpenses",
    AcctNum: "68300",
    Description: "Office and business supplies",
  },
  {
    Name: "Shipping & Delivery",
    AccountType: "Expense",
    AccountSubType: "ShippingFreightDelivery",
    AcctNum: "68400",
    Description: "Shipping, postage, and delivery costs",
  },
  {
    Name: "Bank Fees",
    AccountType: "Expense",
    AccountSubType: "BankCharges",
    AcctNum: "68600",
    Description: "Bank service charges and fees",
  },
  {
    Name: "Entertainment",
    AccountType: "Expense",
    AccountSubType: "EntertainmentMeals",
    AcctNum: "63400",
    Description: "Business entertainment and meals",
  },
  {
    Name: "Lodging",
    AccountType: "Expense",
    AccountSubType: "TravelExpensesGeneralAndAdminExpenses",
    AcctNum: "62100",
    Description: "Travel lodging and accommodations",
  },
  {
    Name: "Ground Transportation",
    AccountType: "Expense",
    AccountSubType: "TravelExpensesGeneralAndAdminExpenses",
    AcctNum: "62300",
    Description: "Uber, taxi, rental cars, and ground transport",
  },
  {
    Name: "Interest Expense",
    AccountType: "Other Expense",
    AccountSubType: "OtherMiscellaneousExpense",
    AcctNum: "87000",
    Description: "Interest on loans and credit",
  },
  // COGS
  {
    Name: "Hosting Fees",
    AccountType: "Cost of Goods Sold",
    AccountSubType: "OtherCostsOfServiceCOS",
    AcctNum: "51000",
    Description: "Web hosting and cloud infrastructure",
  },
  // Revenue
  {
    Name: "Services Revenue",
    AccountType: "Income",
    AccountSubType: "ServiceFeeIncome",
    AcctNum: "41000",
    Description: "Revenue from services",
  },
  // Liability — Investor loan from Rene (NOT income)
  {
    Name: "Investor Loan - Rene",
    AccountType: "Other Current Liabilities",
    AccountSubType: "OtherCurrentLiabilities",
    Description: "Investment/loan from Rene — not revenue",
  },
  // Other
  {
    Name: "Transfers in Transit",
    AccountType: "Other Current Assets",
    AccountSubType: "OtherCurrentAssets",
    AcctNum: "10920",
    Description: "Payment processor transfers in transit",
  },
  {
    Name: "Credit Card Payments",
    AccountType: "Other Current Liabilities",
    AccountSubType: "OtherCurrentLiabilities",
    AcctNum: "21111",
    Description: "Credit card payment clearing",
  },
];

async function qboPost(
  realmId: string,
  accessToken: string,
  entity: string,
  body: Record<string, unknown>,
) {
  const baseUrl = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";

  const res = await fetch(
    `${baseUrl}/v3/company/${realmId}/${entity}?minorversion=73`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    return { error: true, status: res.status, detail: data };
  }
  return { error: false, data };
}

export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to QBO — visit /api/ops/qbo/authorize first" },
      { status: 401 },
    );
  }

  const realmId = await getRealmId();
  if (!realmId) {
    return NextResponse.json({ error: "No realm ID" }, { status: 500 });
  }

  const results: Array<{
    name: string;
    status: string;
    detail?: unknown;
  }> = [];

  for (const acct of ACCOUNTS_TO_CREATE) {
    const body: Record<string, unknown> = {
      Name: acct.Name,
      AccountType: acct.AccountType,
      AccountSubType: acct.AccountSubType,
      Description: acct.Description,
    };
    if (acct.AcctNum) {
      body.AcctNum = acct.AcctNum;
    }

    const result = await qboPost(realmId, accessToken, "account", body);

    if (result.error) {
      // Check if it's a duplicate name error (already exists)
      const detail = result.detail as Record<string, unknown>;
      const fault = detail?.Fault as Record<string, unknown>;
      const errors = fault?.Error as Array<Record<string, unknown>>;
      const isDuplicate = errors?.some(
        (e) =>
          String(e.code) === "6000" ||
          String(e.Message).includes("already been used") ||
          String(e.Detail).includes("already been used"),
      );

      results.push({
        name: acct.Name,
        status: isDuplicate ? "already_exists" : "error",
        detail: isDuplicate ? undefined : result.detail,
      });
    } else {
      results.push({ name: acct.Name, status: "created" });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const existing = results.filter((r) => r.status === "already_exists").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    summary: `Created ${created}, already existed ${existing}, errors ${errors}`,
    results,
  });
}
