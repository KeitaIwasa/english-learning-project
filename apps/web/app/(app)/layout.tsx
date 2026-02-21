import { AppNav } from "@/components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <AppNav />
      <div className="app-content">{children}</div>
    </main>
  );
}
