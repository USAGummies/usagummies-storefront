export type BlogAuthor = {
  id: string;
  name: string;
  slug: string;
  title?: string;
  bio: string;
  avatar?: string;
  links?: string[];
};

export const blogAuthors: Record<string, BlogAuthor> = {
  "usa-gummies": {
    id: "usa-gummies",
    name: "USA Gummies Editorial",
    slug: "usa-gummies",
    title: "Brand editorial team",
    bio:
      "The USA Gummies editorial team shares behind-the-scenes stories, gifting ideas, and patriotic inspiration for everyday celebrations.",
    avatar: "/logo-mark.png",
    links: ["https://www.instagram.com/usagummies/"],
  },
  "maria-santos": {
    id: "maria-santos",
    name: "Maria Santos",
    slug: "maria-santos",
    title: "Community & events lead",
    bio:
      "Maria curates community celebrations and the small details that make America 250 moments feel personal.",
    avatar: "/logo-winged.png",
  },
  "derek-cole": {
    id: "derek-cole",
    name: "Derek Cole",
    slug: "derek-cole",
    title: "Production & sourcing",
    bio:
      "Derek documents how USA Gummies sources, tests, and crafts batches for nationwide gifting.",
    avatar: "/logo.jpg",
  },
};

export const blogAuthorList = Object.values(blogAuthors);
