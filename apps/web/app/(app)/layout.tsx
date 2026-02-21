import { AppNav } from "@/components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <AppNav />
      {children}
    </main>
  );
}
