"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type UserMenuProps = {
  email: string;
};

export function UserMenu({ email }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const label = getAvatarLabel(email);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const signOut = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/");
    router.refresh();
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-avatar-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="ユーザーメニューを開く"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-avatar">{label}</span>
      </button>

      {open ? (
        <div className="user-menu-popover" role="menu">
          <p className="user-email">{email}</p>
          <button type="button" onClick={signOut} disabled={loading} className="signout-btn">
            ログアウト
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getAvatarLabel(email: string) {
  const normalized = email.trim();
  if (!normalized) {
    return "U";
  }
  return normalized[0]?.toUpperCase() ?? "U";
}
