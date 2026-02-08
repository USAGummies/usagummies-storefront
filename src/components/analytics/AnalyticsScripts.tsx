import Script from "next/script";

export function AnalyticsScripts() {
  const ga4 = process.env.NEXT_PUBLIC_GA4_ID?.trim();
  const metaPixel = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();

  return (
    <>
      {ga4 ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`}
            strategy="afterInteractive"
          />
          <Script id="ga4" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${ga4}', { anonymize_ip: true });
            `}
          </Script>
        </>
      ) : null}

      {metaPixel ? (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${metaPixel}');
              fbq('track', 'PageView');
            `}
          </Script>
          {/* Minimal noscript fallback */}
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element -- Meta pixel requires <img> beacon inside <noscript> */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${metaPixel}&ev=PageView&noscript=1`}
              alt="Meta Pixel tracking image"
            />
          </noscript>
        </>
      ) : null}
    </>
  );
}
