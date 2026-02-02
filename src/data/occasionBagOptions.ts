import type { OccasionOption } from "@/components/guides/OccasionBagPicker.client";

export const OCCASION_BAG_OPTIONS: OccasionOption[] = [
  {
    key: "gift",
    label: "Gifts",
    headline: "Gift-ready bag counts",
    picks: [
      { title: "4 bags", detail: "Thank you gifts and care packages.", qty: 4 },
      { title: "5 bags", detail: "Free shipping and easy gifting.", qty: 5 },
      { title: "8 bags", detail: "Most popular for families and offices.", qty: 8 },
      { title: "12 bags", detail: "Bulk gifting and large lists.", qty: 12 },
    ],
    note: "Most gifts land at 5 or 8 bags.",
  },
  {
    key: "party",
    label: "Parties",
    headline: "Party table bag counts",
    picks: [
      { title: "4 bags", detail: "Party favors and small groups.", qty: 4 },
      { title: "5 bags", detail: "Small get-togethers with free shipping.", qty: 5 },
      { title: "8 bags", detail: "Backyard parties and sharing bowls.", qty: 8 },
      { title: "12 bags", detail: "Large groups and events.", qty: 12 },
    ],
    note: "Most parties land at 8 bags.",
  },
  {
    key: "bulk",
    label: "Bulk",
    headline: "Bulk order bag counts",
    picks: [
      { title: "5 bags", detail: "Free shipping starter for teams.", qty: 5 },
      { title: "8 bags", detail: "Balanced value for office gifting.", qty: 8 },
      { title: "12 bags", detail: "Best price per bag for volume.", qty: 12 },
      { title: "12+ bags", detail: "Ask us about large orders.", ctaLabel: "Contact us", ctaHref: "/contact" },
    ],
    note: "Contact us for high-volume or corporate orders.",
  },
];
