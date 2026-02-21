"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { AudioLines, BookOpenText, MessageCircle, RectangleHorizontal } from "lucide-react";

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/flashcards", label: "Flashcards", icon: RectangleHorizontal },
  { href: "/reading", label: "Reading", icon: BookOpenText },
  { href: "/native-fixer", label: "Native Fixer", icon: AudioLines }
];

function isActivePath(pathname: string, href: Route) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {navItems.map((item) => {
        const isActive = isActivePath(pathname, item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`app-nav-link${isActive ? " active" : ""}`}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
          >
            <Icon size={21} strokeWidth={2} aria-hidden="true" focusable="false" />
            <span className="sr-only">{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}
