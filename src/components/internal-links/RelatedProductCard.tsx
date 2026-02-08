import Link from "next/link";
import Image from "next/image";
import { money } from "@/lib/shopify/storefront";
import type { InternalLinkProduct } from "@/lib/shopify/internalLinks";

export function RelatedProductCard({ product }: { product: InternalLinkProduct }) {
  const image = product.featuredImage;
  const price = product.priceRange?.minVariantPrice;
  const priceText = price?.amount ? money(price.amount, price.currencyCode) : "";
  const href = `/products/${product.handle}`;

  return (
    <article className="related-product-card">
      <Link href={href} className="related-product-card__media" aria-label={product.title}>
        <div className="related-product-card__imageFrame">
          {image?.url ? (
            <Image
              src={image.url}
              alt={image.altText || (product.title ? `Product photo of ${product.title}` : "Product photo")}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 280px"
              className="related-product-card__image"
            />
          ) : (
            <div className="related-product-card__imageFallback">No image</div>
          )}
        </div>
      </Link>

      <div className="related-product-card__body">
        <div className="related-product-card__eyebrow">USA Gummies</div>
        <h3 className="related-product-card__title">
          <Link href={href} className="link-underline">
            {product.title}
          </Link>
        </h3>
        <div className="related-product-card__price">
          {priceText ? (
            <>
              Starting at <span className="related-product-card__priceValue">{priceText}</span>
            </>
          ) : (
            <span>See pricing</span>
          )}
        </div>
        {product.productType ? (
          <div className="related-product-card__tags">
            <span className="badge badge--navy">{product.productType}</span>
          </div>
        ) : null}
        <div className="related-product-card__cta">
          <Link href={`${href}?focus=bundles`} className="btn btn-outline btn-compact">
            Shop &amp; save
          </Link>
        </div>
      </div>
    </article>
  );
}
