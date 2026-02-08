import Link from "next/link";

function pageHref(basePath: string, page: number) {
  if (page <= 1) return basePath;
  return `${basePath}/page/${page}`;
}

export function BlogPagination({
  currentPage,
  totalPages,
  basePath,
}: {
  currentPage: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;

  const pages: Array<number | string> = [];
  const windowSize = 2;
  const start = Math.max(1, currentPage - windowSize);
  const end = Math.min(totalPages, currentPage + windowSize);

  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("...");
  }

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <nav className="blog-pagination" aria-label="Blog pagination">
      <div className="blog-pagination__row">
        {currentPage > 1 ? (
          <Link className="btn btn-outline btn-compact" href={pageHref(basePath, currentPage - 1)}>
            Previous
          </Link>
        ) : (
          <span className="btn btn-outline btn-compact blog-pagination__disabled">Previous</span>
        )}

        <div className="blog-pagination__pages">
          {pages.map((page, index) =>
            typeof page === "number" ? (
              <Link
                key={`page-${page}`}
                href={pageHref(basePath, page)}
                className={`blog-pagination__page ${page === currentPage ? "is-active" : ""}`}
              >
                {page}
              </Link>
            ) : (
              <span key={`gap-${index}`} className="blog-pagination__gap">
                {page}
              </span>
            )
          )}
        </div>

        {currentPage < totalPages ? (
          <Link className="btn btn-outline btn-compact" href={pageHref(basePath, currentPage + 1)}>
            Next
          </Link>
        ) : (
          <span className="btn btn-outline btn-compact blog-pagination__disabled">Next</span>
        )}
      </div>
    </nav>
  );
}
