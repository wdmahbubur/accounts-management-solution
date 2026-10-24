'use client';
export default function AdvancesError({reset}:{reset:()=>void}){return <main className="content"><h1>Advances and refunds</h1><p role="alert">Balances could not be loaded. Try again.</p><button onClick={reset}>Try again</button></main>;}
