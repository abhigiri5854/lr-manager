import type { Action } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  /** Hidden for roles that can't do this (lib/permissions.ts). Unset = everyone. */
  action?: Action;
  /** True when this item should be highlighted for the given pathname. */
  isActive: (pathname: string) => boolean;
};

export type NavGroup = {
  heading: string;
  items: NavItem[];
};

const startsWith = (prefix: string) => (pathname: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const isPodRoute = (pathname: string) =>
  startsWith("/pod")(pathname) || /^\/lr\/[^/]+\/pod$/.test(pathname);

// Order and labels match design/screens/Main.dc.html.
export const navGroups: NavGroup[] = [
  {
    heading: "OPERATIONS",
    items: [
      { label: "Dashboard", href: "/", isActive: (p) => p === "/" },
      { label: "New LR", href: "/lr/new", isActive: (p) => p === "/lr/new", action: "lr.edit" },
      {
        label: "LR register",
        href: "/lr",
        // LR detail and edit also live under the register.
        isActive: (p) => startsWith("/lr")(p) && p !== "/lr/new" && !isPodRoute(p),
      },
      { label: "POD & delivery", href: "/pod", isActive: isPodRoute },
    ],
  },
  {
    heading: "BILLING",
    items: [
      { label: "Tax invoices", href: "/invoices", isActive: startsWith("/invoices") },
      { label: "Bills & payments", href: "/bills", isActive: startsWith("/bills") },
    ],
  },
  {
    heading: "DATA",
    items: [
      { label: "Parties", href: "/parties", isActive: startsWith("/parties") },
      { label: "Trucks & drivers", href: "/trucks", isActive: startsWith("/trucks") },
      { label: "Items", href: "/items", isActive: startsWith("/items") },
      {
        label: "Smart import",
        href: "/import",
        isActive: startsWith("/import"),
        action: "import.run",
      },
    ],
  },
  {
    heading: "SETTINGS",
    items: [
      {
        label: "Company profile",
        href: "/settings/company",
        isActive: startsWith("/settings/company"),
      },
      { label: "Users & roles", href: "/settings/users", isActive: startsWith("/settings/users") },
    ],
  },
];
