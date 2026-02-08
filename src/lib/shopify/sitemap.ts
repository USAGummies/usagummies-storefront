// src/lib/shopify/sitemap.ts
import "server-only";
import { storefrontFetch } from "./storefront";

const PAGE_SIZE = 250;
const MAX_PAGES = 20;
const REVALIDATE_SECONDS = 3600;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

type Connection<T> = {
  nodes: T[];
  pageInfo: PageInfo;
};

type HandleNode = {
  handle: string;
  updatedAt?: string | null;
  publishedAt?: string | null;
};

type ArticlesNode = HandleNode & { blogHandle: string };

type ConnectionResult<T> = { nodes: T[]; pageInfo: PageInfo } | null;

type ProductsSitemapResult = { products: Connection<HandleNode> };

type CollectionsSitemapResult = { collections: Connection<HandleNode> };

type PagesSitemapResult = { pages: Connection<HandleNode> };

type BlogsSitemapResult = { blogs: Connection<HandleNode> };

type BlogArticlesResult = {
  blog: null | {
    handle: string;
    articles: Connection<HandleNode>;
  };
};

const PRODUCTS_SITEMAP_QUERY = /* GraphQL */ `
  query SitemapProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        handle
        updatedAt
      }
    }
  }
`;

const COLLECTIONS_SITEMAP_QUERY = /* GraphQL */ `
  query SitemapCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        handle
        updatedAt
      }
    }
  }
`;

const PAGES_SITEMAP_QUERY = /* GraphQL */ `
  query SitemapPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        handle
        updatedAt
      }
    }
  }
`;

const BLOGS_SITEMAP_QUERY = /* GraphQL */ `
  query SitemapBlogs($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        handle
        updatedAt
      }
    }
  }
`;

const BLOG_ARTICLES_QUERY = /* GraphQL */ `
  query SitemapBlogArticles($handle: String!, $first: Int!, $after: String) {
    blog(handle: $handle) {
      handle
      articles(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          handle
          updatedAt
          publishedAt
        }
      }
    }
  }
`;

async function fetchAllNodes<T>(
  fetchPage: (after: string | null) => Promise<ConnectionResult<T>>
): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | null = null;

  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await fetchPage(after);
    if (!page) break;

    if (page.nodes?.length) {
      nodes.push(...page.nodes);
    }

    if (!page.pageInfo?.hasNextPage) break;
    after = page.pageInfo?.endCursor ?? null;
    if (!after) break;
  }

  return nodes;
}

async function fetchAllProducts(): Promise<HandleNode[]> {
  return fetchAllNodes(async (after) => {
    const data = await storefrontFetch<ProductsSitemapResult>({
      query: PRODUCTS_SITEMAP_QUERY,
      variables: { first: PAGE_SIZE, after },
      tags: ["sitemap", "products"],
      revalidate: REVALIDATE_SECONDS,
    });

    return data?.products ?? null;
  });
}

async function fetchAllCollections(): Promise<HandleNode[]> {
  return fetchAllNodes(async (after) => {
    const data = await storefrontFetch<CollectionsSitemapResult>({
      query: COLLECTIONS_SITEMAP_QUERY,
      variables: { first: PAGE_SIZE, after },
      tags: ["sitemap", "collections"],
      revalidate: REVALIDATE_SECONDS,
    });

    return data?.collections ?? null;
  });
}

async function fetchAllPages(): Promise<HandleNode[]> {
  return fetchAllNodes(async (after) => {
    const data = await storefrontFetch<PagesSitemapResult>({
      query: PAGES_SITEMAP_QUERY,
      variables: { first: PAGE_SIZE, after },
      tags: ["sitemap", "pages"],
      revalidate: REVALIDATE_SECONDS,
    });

    return data?.pages ?? null;
  });
}

async function fetchAllBlogs(): Promise<HandleNode[]> {
  return fetchAllNodes(async (after) => {
    const data = await storefrontFetch<BlogsSitemapResult>({
      query: BLOGS_SITEMAP_QUERY,
      variables: { first: PAGE_SIZE, after },
      tags: ["sitemap", "blogs"],
      revalidate: REVALIDATE_SECONDS,
    });

    return data?.blogs ?? null;
  });
}

async function fetchBlogArticles(blogHandle: string): Promise<HandleNode[]> {
  return fetchAllNodes(async (after) => {
    const data = await storefrontFetch<BlogArticlesResult>({
      query: BLOG_ARTICLES_QUERY,
      variables: { handle: blogHandle, first: PAGE_SIZE, after },
      tags: ["sitemap", "articles", `blog:${blogHandle}`],
      revalidate: REVALIDATE_SECONDS,
    });

    return data?.blog?.articles ?? null;
  });
}

function normalizeUpdatedAt(node: HandleNode): string | null {
  return node.updatedAt ?? node.publishedAt ?? null;
}

function isPublished(node: HandleNode): boolean {
  if (node.publishedAt === undefined) return true;
  return Boolean(node.publishedAt);
}

export type ShopifySitemapResources = {
  products: HandleNode[];
  collections: HandleNode[];
  pages: HandleNode[];
  blogs: HandleNode[];
  articles: ArticlesNode[];
};

export async function getShopifySitemapResources(): Promise<ShopifySitemapResources> {
  try {
    const [products, collections, pages, blogs] = await Promise.all([
      fetchAllProducts(),
      fetchAllCollections(),
      fetchAllPages(),
      fetchAllBlogs(),
    ]);

    const articles: ArticlesNode[] = [];

    for (const blog of blogs) {
      if (!blog?.handle) continue;
      const blogArticles = await fetchBlogArticles(blog.handle);
      for (const article of blogArticles) {
        if (!article?.handle) continue;
        articles.push({ ...article, blogHandle: blog.handle });
      }
    }

    const normalizedProducts = products
      .filter((product) => product?.handle && isPublished(product))
      .map((product) => ({ ...product, updatedAt: normalizeUpdatedAt(product) }));
    const normalizedCollections = collections
      .filter((collection) => collection?.handle && isPublished(collection))
      .map((collection) => ({ ...collection, updatedAt: normalizeUpdatedAt(collection) }));
    const normalizedPages = pages
      .filter((page) => page?.handle && isPublished(page))
      .map((page) => ({ ...page, updatedAt: normalizeUpdatedAt(page) }));
    const normalizedBlogs = blogs
      .filter((blog) => blog?.handle && isPublished(blog))
      .map((blog) => ({ ...blog, updatedAt: normalizeUpdatedAt(blog) }));
    const normalizedArticles = articles
      .filter((article) => isPublished(article))
      .map((article) => ({
        ...article,
        updatedAt: normalizeUpdatedAt(article),
      }));

    return {
      products: normalizedProducts,
      collections: normalizedCollections,
      pages: normalizedPages,
      blogs: normalizedBlogs,
      articles: normalizedArticles,
    };
  } catch {
    return { products: [], collections: [], pages: [], blogs: [], articles: [] };
  }
}
