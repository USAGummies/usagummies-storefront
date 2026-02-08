import type { MDXComponents } from "mdx/types";
import Image from "next/image";

export const mdxComponents: MDXComponents = {
  h2: (props) => <h2 className="blog-h2" {...props} />,
  h3: (props) => <h3 className="blog-h3" {...props} />,
  p: (props) => <p className="blog-paragraph" {...props} />,
  ul: (props) => <ul className="blog-list" {...props} />,
  ol: (props) => <ol className="blog-list blog-list--ordered" {...props} />,
  li: (props) => <li className="blog-listItem" {...props} />,
  blockquote: (props) => <blockquote className="blog-quote" {...props} />,
  a: ({ href = "", ...props }) => {
    const isExternal = href.startsWith("http");
    return (
      <a
        className="blog-link"
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        {...props}
      />
    );
  },
  img: ({ alt = "", src = "", width, height, className, ...props }) => {
    const resolvedSrc = typeof src === "string" ? src : "";
    if (!resolvedSrc) return null;
    const numericWidth =
      typeof width === "number" ? width : width ? Number(width) : undefined;
    const numericHeight =
      typeof height === "number" ? height : height ? Number(height) : undefined;
    const fallbackSize = 1200;
    const fallbackHeight = Math.round(fallbackSize * 0.6);
    const aspectRatio =
      numericWidth && numericHeight
        ? `${numericWidth} / ${numericHeight}`
        : `${fallbackSize} / ${fallbackHeight}`;
    const combinedClassName = ["blog-image", "object-contain", className]
      .filter(Boolean)
      .join(" ");
    return (
      <div className="my-6">
        <div className="media-frame w-full" style={{ aspectRatio }}>
          <Image
            className={combinedClassName}
            alt={alt}
            src={resolvedSrc}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            {...props}
          />
        </div>
      </div>
    );
  },
  pre: (props) => <pre className="blog-pre" {...props} />,
  code: (props) => <code className="blog-code" {...props} />,
  table: (props) => (
    <div className="blog-tableWrap">
      <table className="blog-table" {...props} />
    </div>
  ),
  th: (props) => <th className="blog-tableHead" {...props} />,
  td: (props) => <td className="blog-tableCell" {...props} />,
};
