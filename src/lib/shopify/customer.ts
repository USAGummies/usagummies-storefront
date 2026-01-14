import "server-only";
import { shopifyRequest } from "@/lib/shopify/fetch";

const DEFAULT_STOREFRONT_API_VERSION = "2024-07";

function getShopifyEndpoint() {
  const explicit = process.env.SHOPIFY_STOREFRONT_API_ENDPOINT;
  if (explicit) return explicit;

  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

  const version =
    process.env.SHOPIFY_STOREFRONT_API_VERSION ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION ||
    DEFAULT_STOREFRONT_API_VERSION;

  if (!domain || !version) return null;
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${clean}/api/${version}/graphql.json`;
}

function getShopifyToken() {
  return (
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
  );
}

async function shopify<T>(query: string, variables?: Record<string, any>): Promise<T | null> {
  const endpoint = getShopifyEndpoint();
  const token = getShopifyToken();
  if (!endpoint || !token) return null;
  const result = await shopifyRequest<T>({
    endpoint,
    token,
    body: { query, variables },
    cache: "no-store",
    warnPrefix: "Shopify customer",
  });
  return result.ok ? result.data : null;
}

const CUSTOMER_ACCESS_TOKEN_CREATE = /* GraphQL */ `
  mutation CustomerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
    customerAccessTokenCreate(input: $input) {
      customerAccessToken {
        accessToken
        expiresAt
      }
      customerUserErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_ACCESS_TOKEN_DELETE = /* GraphQL */ `
  mutation CustomerAccessTokenDelete($customerAccessToken: String!) {
    customerAccessTokenDelete(customerAccessToken: $customerAccessToken) {
      deletedAccessToken
      customerUserErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_RECOVER = /* GraphQL */ `
  mutation CustomerRecover($email: String!) {
    customerRecover(email: $email) {
      customerUserErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_ORDERS = /* GraphQL */ `
  query CustomerOrders($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      id
      firstName
      lastName
      email
      orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
        edges {
          node {
            id
            orderNumber
            processedAt
            financialStatus
            fulfillmentStatus
            currentTotalPrice {
              amount
              currencyCode
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

type CustomerAccessTokenCreateResponse = {
  customerAccessTokenCreate: {
    customerAccessToken: { accessToken: string; expiresAt: string } | null;
    customerUserErrors: Array<{ message?: string | null }> | null;
  } | null;
};

type CustomerRecoverResponse = {
  customerRecover: {
    customerUserErrors: Array<{ message?: string | null }> | null;
  } | null;
};

type CustomerAccessTokenDeleteResponse = {
  customerAccessTokenDelete: {
    deletedAccessToken: string | null;
    customerUserErrors: Array<{ message?: string | null }> | null;
  } | null;
};

type CustomerOrdersResponse = {
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    orders: {
      edges: Array<{
        node: {
          id: string;
          orderNumber: number;
          processedAt: string;
          financialStatus: string;
          fulfillmentStatus: string | null;
          currentTotalPrice: { amount: string; currencyCode: string } | null;
          lineItems: {
            edges: Array<{ node: { title: string; quantity: number } }>;
          };
        };
      }>;
    };
  } | null;
};

function firstError(errors?: Array<{ message?: string | null }> | null) {
  const msg = errors?.find((err) => err?.message)?.message;
  return msg || null;
}

export async function createCustomerAccessToken(email: string, password: string) {
  const data = await shopify<CustomerAccessTokenCreateResponse>(CUSTOMER_ACCESS_TOKEN_CREATE, {
    input: { email, password },
  });
  if (!data) {
    return { ok: false, error: "Customer accounts are not configured yet." } as const;
  }
  const payload = data?.customerAccessTokenCreate;
  const token = payload?.customerAccessToken;
  const error = firstError(payload?.customerUserErrors);
  if (!token?.accessToken) {
    return { ok: false, error: error || "Unable to sign in." } as const;
  }
  return { ok: true, accessToken: token.accessToken, expiresAt: token.expiresAt } as const;
}

export async function deleteCustomerAccessToken(accessToken: string) {
  const data = await shopify<CustomerAccessTokenDeleteResponse>(CUSTOMER_ACCESS_TOKEN_DELETE, {
    customerAccessToken: accessToken,
  });
  if (!data) {
    return { ok: false, error: "Customer accounts are not configured yet." } as const;
  }
  const payload = data?.customerAccessTokenDelete;
  const error = firstError(payload?.customerUserErrors);
  if (!payload?.deletedAccessToken) {
    return { ok: false, error: error || "Unable to sign out." } as const;
  }
  return { ok: true } as const;
}

export async function recoverCustomer(email: string) {
  const data = await shopify<CustomerRecoverResponse>(CUSTOMER_RECOVER, { email });
  if (!data) {
    return { ok: false, error: "Customer accounts are not configured yet." } as const;
  }
  const payload = data?.customerRecover;
  const error = firstError(payload?.customerUserErrors);
  if (error) {
    return { ok: false, error } as const;
  }
  return { ok: true } as const;
}

export type CustomerOrder = {
  id: string;
  orderNumber: number;
  processedAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  currentTotalPrice: { amount: string; currencyCode: string } | null;
  lineItems: Array<{ title: string; quantity: number }>;
};

export type CustomerSummary = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  orders: CustomerOrder[];
};

export async function getCustomerOrders(accessToken: string): Promise<CustomerSummary | null> {
  const data = await shopify<CustomerOrdersResponse>(CUSTOMER_ORDERS, {
    customerAccessToken: accessToken,
  });
  const customer = data?.customer;
  if (!customer) return null;

  const orders =
    customer.orders?.edges?.map((edge) => {
      const node = edge?.node;
      if (!node) return null;
      const items =
        node.lineItems?.edges?.map((item) => item?.node).filter(Boolean) as Array<{
          title: string;
          quantity: number;
        }>;
      return {
        id: node.id,
        orderNumber: node.orderNumber,
        processedAt: node.processedAt,
        financialStatus: node.financialStatus,
        fulfillmentStatus: node.fulfillmentStatus,
        currentTotalPrice: node.currentTotalPrice,
        lineItems: items || [],
      };
    })?.filter((order): order is CustomerOrder => Boolean(order)) || [];

  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    orders,
  };
}
