// src/data/competitors.ts
// All data sourced from publicly available FDA product labels and manufacturer disclosures.

export interface Competitor {
  slug: string;
  name: string;
  parentCompany: string;
  parentCountry: string;
  hq: string;
  madeIn: string;
  artificialColors: boolean;
  artificialColorsList?: string[];
  titaniumDioxide: boolean;
  titaniumDioxideNote?: string;
  naturalFlavors: boolean;
  americanOwned: boolean;
  madeInUSA: boolean;
  notableIngredients?: string[];
  dualStandard?: string;
  keyProducts: string[];
  /** Short factual description for the index page card */
  shortDescription: string;
}

export interface USAGummiesProfile {
  name: string;
  parentCompany: string;
  parentCountry: string;
  hq: string;
  madeIn: string;
  artificialColors: boolean;
  titaniumDioxide: boolean;
  naturalFlavors: boolean;
  americanOwned: boolean;
  madeInUSA: boolean;
  keyProducts: string[];
  price: string;
  bundlePrice: string;
}

export const usaGummies: USAGummiesProfile = {
  name: "USA Gummies",
  parentCompany: "USA Gummies (independent American business)",
  parentCountry: "United States",
  hq: "USA",
  madeIn: "USA",
  artificialColors: false,
  titaniumDioxide: false,
  naturalFlavors: true,
  americanOwned: true,
  madeInUSA: true,
  keyProducts: ["All American Gummy Bears (7.5 oz)"],
  price: "$5.99/bag",
  bundlePrice: "$5.00/bag in 5-pack ($25 total with free shipping)",
};

export const competitors: Competitor[] = [
  {
    slug: "haribo",
    name: "Haribo",
    parentCompany: "Haribo GmbH",
    parentCountry: "Germany",
    hq: "Bonn, Germany",
    madeIn:
      "Germany, Turkey, Spain, Hungary, Denmark, France, Austria, Belgium, Brazil. Only Goldbears made in Wisconsin since 2023.",
    artificialColors: true,
    artificialColorsList: ["Red 40", "Yellow 5", "Yellow 6", "Blue 1"],
    titaniumDioxide: true,
    titaniumDioxideNote:
      "Present in U.S. products. Titanium dioxide has been banned in EU food products since 2022.",
    naturalFlavors: false,
    americanOwned: false,
    madeInUSA: false,
    dualStandard:
      "Haribo sells a cleaner formulation in Germany where natural colors are required by law, while using artificial colors in U.S. products.",
    keyProducts: [
      "Goldbears",
      "Happy Cola",
      "Twin Snakes",
      "Sour Goldbears",
    ],
    shortDescription:
      "German-owned gummy brand using artificial colors and titanium dioxide in U.S. products, while selling a cleaner version in Europe.",
    notableIngredients: [
      "Red 40",
      "Yellow 5",
      "Yellow 6",
      "Blue 1",
      "Titanium dioxide (banned in EU food since 2022)",
    ],
  },
  {
    slug: "trolli",
    name: "Trolli",
    parentCompany: "Ferrara Candy Company, owned by Ferrero Group",
    parentCountry: "Italy",
    hq: "Chicago, IL (Ferrara); Alba, Italy (Ferrero)",
    madeIn: "Linares, Mexico",
    artificialColors: true,
    artificialColorsList: ["Red 40", "Yellow 5", "Yellow 6", "Blue 1"],
    titaniumDioxide: true,
    naturalFlavors: false,
    americanOwned: false,
    madeInUSA: false,
    keyProducts: ["Sour Brite Crawlers", "Gummy Worms"],
    shortDescription:
      "Italian-owned brand manufactured in Mexico, containing artificial colors and titanium dioxide.",
    notableIngredients: [
      "Red 40",
      "Yellow 5",
      "Yellow 6",
      "Blue 1",
      "Titanium dioxide",
    ],
  },
  {
    slug: "sour-patch-kids",
    name: "Sour Patch Kids",
    parentCompany: "Mondelez International",
    parentCountry: "United States (publicly traded multinational)",
    hq: "Chicago, IL (corporate)",
    madeIn: "Hamilton, Ontario, Canada and Monterrey, Mexico and Turkey",
    artificialColors: true,
    artificialColorsList: ["Red 40", "Yellow 5", "Yellow 6", "Blue 1"],
    titaniumDioxide: true,
    titaniumDioxideNote: "Present in the Watermelon variety.",
    naturalFlavors: false,
    americanOwned: true,
    madeInUSA: false,
    keyProducts: ["Original", "Watermelon", "Extreme", "Swedish Fish"],
    shortDescription:
      "Made in Canada, Mexico, and Turkey by a public multinational. Contains artificial colors and titanium dioxide.",
    notableIngredients: [
      "Red 40",
      "Yellow 5",
      "Yellow 6",
      "Blue 1",
      "Titanium dioxide (in Watermelon variety)",
      "White mineral oil (in Swedish Fish)",
    ],
  },
  {
    slug: "skittles-gummies",
    name: "Skittles Gummies",
    parentCompany: "Mars, Incorporated",
    parentCountry: "United States",
    hq: "McLean, VA",
    madeIn: "Various Mars factories",
    artificialColors: true,
    artificialColorsList: ["Red 40", "Yellow 5", "Yellow 6", "Blue 1"],
    titaniumDioxide: true,
    titaniumDioxideNote: "Present in bite-size Skittles.",
    naturalFlavors: false,
    americanOwned: true,
    madeInUSA: false,
    dualStandard:
      "Mars promised to remove artificial colors in 2016 but has not fully done so.",
    keyProducts: [
      "Skittles Gummies",
      "Starburst Gummies",
      "Life Savers Gummies",
    ],
    shortDescription:
      "U.S.-owned Mars brand that promised to remove artificial colors in 2016 but still uses them. Contains titanium dioxide.",
    notableIngredients: [
      "Red 40",
      "Yellow 5",
      "Yellow 6",
      "Blue 1",
      "Titanium dioxide (in bite-size Skittles)",
      "Hydrogenated palm kernel oil (in non-gummy Skittles)",
    ],
  },
  {
    slug: "nerds-gummy-clusters",
    name: "Nerds Gummy Clusters",
    parentCompany: "Ferrara Candy Company, owned by Ferrero Group",
    parentCountry: "Italy",
    hq: "Chicago, IL",
    madeIn: "Linares, Mexico",
    artificialColors: true,
    artificialColorsList: [
      "Red 40",
      "Red 40 Lake",
      "Yellow 5",
      "Yellow 5 Lake",
      "Yellow 6",
      "Blue 1",
      "Blue 1 Lake",
      "Blue 2 Lake",
    ],
    titaniumDioxide: false,
    naturalFlavors: false,
    americanOwned: false,
    madeInUSA: false,
    keyProducts: ["Rainbow Gummy Clusters", "Very Berry"],
    shortDescription:
      "Italian-owned, made in Mexico, with 8 different artificial dyes including carmine (insect-derived).",
    notableIngredients: [
      "Red 40",
      "Red 40 Lake",
      "Yellow 5",
      "Yellow 5 Lake",
      "Yellow 6",
      "Blue 1",
      "Blue 1 Lake",
      "Blue 2 Lake",
      "Carmine (insect-derived dye)",
    ],
  },
  {
    slug: "brachs",
    name: "Brach's",
    parentCompany: "Ferrara Candy Company, owned by Ferrero Group",
    parentCountry: "Italy",
    hq: "Chicago, IL",
    madeIn: "U.S. and Mexico (Ferrara plants)",
    artificialColors: true,
    artificialColorsList: ["Red 40", "Yellow 5", "Blue 1"],
    titaniumDioxide: false,
    naturalFlavors: false,
    americanOwned: false,
    madeInUSA: false,
    keyProducts: ["Gummy Bears", "Sugar-Free Gummy Bears"],
    shortDescription:
      "Italian-owned brand manufactured in U.S. and Mexico, containing artificial colors.",
    notableIngredients: ["Red 40", "Yellow 5", "Blue 1"],
  },
  {
    slug: "airheads",
    name: "Airheads",
    parentCompany: "Perfetti Van Melle",
    parentCountry: "Netherlands / Italy",
    hq: "Erlanger, KY (U.S.); Lainate, Italy & Breda, Netherlands (global)",
    madeIn: "Erlanger, Kentucky",
    artificialColors: true,
    artificialColorsList: ["Red 40", "Blue 1", "Yellow 6", "Yellow 5"],
    titaniumDioxide: false,
    naturalFlavors: false,
    americanOwned: false,
    madeInUSA: true,
    keyProducts: ["Airheads Gummies", "Airheads Xtremes"],
    shortDescription:
      "Dutch-Italian owned, made in Kentucky. Contains artificial colors and partially hydrogenated oils.",
    notableIngredients: [
      "Red 40",
      "Blue 1",
      "Yellow 6",
      "Yellow 5",
      "Partially hydrogenated soybean oil (trans fat)",
      "Palm oil",
    ],
  },
  {
    slug: "black-forest",
    name: "Black Forest",
    parentCompany: "Ferrara Candy Company, owned by Ferrero Group",
    parentCountry: "Italy",
    hq: "Chicago, IL",
    madeIn: "U.S. and Mexico (Ferrara plants)",
    artificialColors: true,
    artificialColorsList: ["Varies by product line"],
    titaniumDioxide: false,
    naturalFlavors: false,
    americanOwned: false,
    madeInUSA: false,
    dualStandard:
      "Their organic line uses natural colors, but the non-organic product lines contain artificial colors. Both lines are owned by Italian conglomerate Ferrero.",
    keyProducts: ["Gummy Bears", "Gummy Worms", "Fruit Snacks"],
    shortDescription:
      "Italian-owned brand with both organic and non-organic lines. Non-organic products contain artificial colors.",
    notableIngredients: [
      "Artificial colors (in non-organic product lines)",
    ],
  },
];

/** Look up a competitor by its URL slug */
export function getCompetitorBySlug(slug: string): Competitor | undefined {
  return competitors.find((c) => c.slug === slug);
}

/** All valid competitor slugs (used for static param generation) */
export function getAllCompetitorSlugs(): string[] {
  return competitors.map((c) => c.slug);
}

/** FAQ data used for "Why It Matters" section and schema.org FAQ structured data */
export const whyItMattersItems = [
  {
    question: "What is titanium dioxide and why is it in candy?",
    answer:
      "Titanium dioxide (E171) is a white pigment used to brighten colors and create an opaque appearance in foods, including gummy candies. The European Union banned titanium dioxide as a food additive in 2022, citing concerns that it could not be ruled out as genotoxic (potentially damaging to DNA). It remains legal in U.S. food products.",
  },
  {
    question: "What is Red 40 and why do some people avoid it?",
    answer:
      "Red 40 (Allura Red AC) is a synthetic petroleum-based food dye. It is the most widely used artificial color in U.S. food. Some countries require warning labels on foods containing Red 40 and other synthetic dyes. California's Food Safety Act (2023) requires warning labels on products containing Red 40 starting in 2027.",
  },
  {
    question: "Why does where candy is made matter?",
    answer:
      "Manufacturing location affects which food safety regulations apply. Products made in the U.S. are subject to FDA oversight and U.S. manufacturing standards. Products imported from other countries follow the regulations of their manufacturing country, which may differ from U.S. standards.",
  },
  {
    question: "What does 'natural flavors' mean on a food label?",
    answer:
      "The FDA defines natural flavors as flavoring substances derived from plant or animal sources, including fruits, vegetables, herbs, and spices. Artificial flavors, by contrast, are synthesized in a laboratory. Both must be listed on ingredient labels.",
  },
  {
    question:
      "Why do some brands sell different formulations in different countries?",
    answer:
      "Food additive regulations vary by country. The EU has stricter regulations on synthetic food dyes, requiring either warning labels or reformulation. Some multinational brands use natural colorings in their EU products and artificial dyes in their U.S. versions of the same product.",
  },
];
