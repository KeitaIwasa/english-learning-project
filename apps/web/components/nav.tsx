import Link from "next/link";

export function AppNav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/flashcards">Flashcards</Link>
      <Link href="/reading">Reading</Link>
      <Link href="/chat">Chat</Link>
    </nav>
  );
}
