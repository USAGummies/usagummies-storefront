import type { RetailerLocation } from "@/data/retailers";

/*
 * US store locator map using an accurate public-domain SVG
 * (Wikimedia Commons — US Census Bureau TIGER data, Albers projection).
 *
 * The base map is served as a static asset at /us-map-states.svg (959×593).
 * Store pins are positioned using manually-calibrated mapX / mapY values
 * stored in each RetailerLocation record.
 *
 * To add a new store, add the entry to retailers.ts with mapX/mapY set to
 * the correct pixel position on the 959×593 SVG canvas.
 */

const SVG_WIDTH = 959;
const SVG_HEIGHT = 593;

interface USStoreMapProps {
  retailers: RetailerLocation[];
}

export function USStoreMap({ retailers }: USStoreMapProps) {
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#f7f4ed] to-[#efe9de] p-4 sm:p-6">
      {/* Wrapper keeps the map and pins in the same coordinate space */}
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Map of the United States showing ${retailers.length} USA Gummies retail locations`}
      >
        <defs>
          {/* Soft shadow for the whole map group */}
          <filter id="map-shadow" x="-2%" y="-2%" width="104%" height="104%">
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="6"
              floodColor="#1B2A4A"
              floodOpacity="0.06"
            />
          </filter>
          {/* Pin glow */}
          <filter
            id="pin-glow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Embedded base map — the cleaned Wikimedia SVG */}
        <image
          href="/us-map-states.svg"
          x="0"
          y="0"
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          filter="url(#map-shadow)"
        />

        {/* Store markers */}
        {retailers.map((r) => {
          const x = r.mapX;
          const y = r.mapY;
          return (
            <g key={r.slug}>
              {/* Outer pulse ring */}
              <circle
                cx={x}
                cy={y}
                r="18"
                fill="none"
                stroke="#c7362c"
                strokeWidth="1.5"
                opacity="0.2"
              />
              {/* Mid glow */}
              <circle cx={x} cy={y} r="11" fill="#c7362c" opacity="0.08" />
              {/* Pin dot */}
              <circle
                cx={x}
                cy={y}
                r="7"
                fill="#c7362c"
                stroke="#fff"
                strokeWidth="2.5"
                filter="url(#pin-glow)"
              />
              {/* Label pill background */}
              <rect
                x={x - 52}
                y={y - 32}
                width="104"
                height="18"
                rx="9"
                fill="white"
                fillOpacity="0.94"
                stroke="#d6d0c3"
                strokeWidth="0.5"
              />
              {/* Label text — city name */}
              <text
                x={x}
                y={y - 19.5}
                textAnchor="middle"
                fill="#1B2A4A"
                fontSize="11"
                fontWeight="700"
                fontFamily="'Space Grotesk', system-ui, sans-serif"
              >
                {r.cityStateZip.split(",")[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
