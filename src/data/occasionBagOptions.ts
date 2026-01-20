import type { OccasionOption } from "@/components/guides/OccasionBagPicker.client";

export const OCCASION_BAG_OPTIONS: OccasionOption[] = [
  {
    key: "gift",
    label: "Gifts",
    headline: "Gift-ready bag counts",
    picks: [
      { title: "4 bags", detail: "Thank you gifts and care packages." },
      { title: "5 bags", detail: "Free shipping and easy gifting." },
      { title: "8 bags", detail: "Most popular for families and offices." },
      { title: "12 bags", detail: "Bulk gifting and large lists." },
    ],
    note: "Most gifts land at 5 or 8 bags.",
  },
  {
    key: "party",
    label: "Parties",
    headline: "Party table bag counts",
    picks: [
      { title: "4 bags", detail: "Party favors and small groups." },
      { title: "5 bags", detail: "Small get-togethers with free shipping." },
      { title: "8 bags", detail: "Backyard parties and sharing bowls." },
      { title: "12 bags", detail: "Large groups and events." },
    ],
    note: "Most parties land at 8 bags.",
  },
  {
    key: "bulk",
    label: "Bulk",
    headline: "Bulk order bag counts",
    picks: [
      { title: "5 bags", detail: "Free shipping starter for teams." },
      { title: "8 bags", detail: "Balanced value for office gifting." },
      { title: "12 bags", detail: "Best price per bag for volume." },
      { title: "12+ bags", detail: "Ask us about large orders." },
    ],
    note: "Contact us for high-volume or corporate orders.",
  },
];
