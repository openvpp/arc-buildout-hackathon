import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ padding: '3rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Arc EV Fleet</h1>
      <p>
        Sign in, connect a vehicle, mint it on Arc, and see it on the globe.
      </p>
      <p>
        <Link href="/devices">Go to dashboard</Link>
      </p>
    </main>
  );
}
