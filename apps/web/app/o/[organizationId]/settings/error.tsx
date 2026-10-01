"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="management-shell"><h1>Settings could not be loaded</h1>
    <p role="alert">Refresh to retry. No private error details are displayed.</p><button onClick={reset}>Try again</button></main>;
}
