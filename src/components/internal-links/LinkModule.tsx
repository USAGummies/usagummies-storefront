import type { ReactNode } from "react";

type LinkModuleProps = {
  title: string;
  children: ReactNode;
  id?: string;
  className?: string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function LinkModule({ title, children, id, className }: LinkModuleProps) {
  const headingId = id || `link-module-${slugify(title)}`;
  const classes = className ? `link-module ${className}` : "link-module";

  return (
    <section className={classes} aria-labelledby={headingId}>
      <div className="link-module__header">
        <h2 id={headingId} className="link-module__title">
          {title}
        </h2>
      </div>
      <div className="link-module__grid">{children}</div>
    </section>
  );
}
