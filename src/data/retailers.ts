export interface RetailerLocation {
  slug: string;
  name: string;
  address: string;
  cityStateZip: string;
  state: string;
  lat: number;
  lng: number;
  /** Pin x-position on the 959×593 continental US SVG (public domain). */
  mapX: number;
  /** Pin y-position on the 959×593 continental US SVG (public domain). */
  mapY: number;
  mapsUrl: string;
  channel: "direct" | "faire";
  storeType: string;
  website?: string;
  note?: string;
}

export const RETAILERS: RetailerLocation[] = [
  {
    slug: "ashford-valley-grocery",
    name: "Ashford Valley Grocery",
    address: "29716 SR-706 E",
    cityStateZip: "Ashford, WA 98304",
    state: "Washington",
    lat: 46.75,
    lng: -122.04,
    mapX: 100,
    mapY: 65,
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Ashford+Valley+Grocery+Ashford+WA",
    channel: "direct",
    storeType: "Grocery",
    website: "https://www.ashfordvalleygrocery.com",
    note: "Gateway to Mt. Rainier — last stop before the park.",
  },
  {
    slug: "adirondack-trading-company",
    name: "Adirondack Trading Company",
    address: "2513 Main Street",
    cityStateZip: "Lake Placid, NY 12946",
    state: "New York",
    lat: 44.28,
    lng: -73.98,
    mapX: 835,
    mapY: 118,
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Adirondack+Trading+Company+Lake+Placid+NY",
    channel: "faire",
    storeType: "Gift Store",
    website: "https://www.lakeplacid.com/do/shop/adirondack-trading-company",
    note: "Located in the heart of the Adirondacks.",
  },
  {
    slug: "deer-creek-market-and-variety",
    name: "Deer Creek Market and Variety",
    address: "109 West Main Street",
    cityStateZip: "Hydro, OK 73048",
    state: "Oklahoma",
    lat: 35.55,
    lng: -98.58,
    mapX: 425,
    mapY: 350,
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Deer+Creek+Market+and+Variety+Hydro+OK",
    channel: "faire",
    storeType: "General Store",
    website: "https://www.deercreekmarket.com",
  },
  {
    slug: "moccasin-mountain-art-gallery",
    name: "Moccasin Mountain Art Gallery & Frame Shop",
    address: "406 West Main Street",
    cityStateZip: "Lewistown, MT 59457",
    state: "Montana",
    lat: 47.06,
    lng: -109.43,
    mapX: 282,
    mapY: 78,
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Moccasin+Mountain+Art+Gallery+Lewistown+MT",
    channel: "faire",
    storeType: "Gift Store",
    website: "https://www.moccasinmountainart.com",
    note: "Art gallery and gift shop in central Montana.",
  },
  {
    slug: "shugabears-sweets-and-treats",
    name: "ShugaBear's Sweets and Treats",
    address: "104 West Main Street",
    cityStateZip: "Walhalla, SC 29691",
    state: "South Carolina",
    lat: 34.77,
    lng: -83.06,
    mapX: 715,
    mapY: 358,
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=ShugaBears+Sweets+and+Treats+Walhalla+SC",
    channel: "faire",
    storeType: "Sweets Shop",
    website: "https://www.shugabearstreats.com",
  },
];
