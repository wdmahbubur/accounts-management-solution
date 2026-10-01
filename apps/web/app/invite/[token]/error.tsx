"use client";
export default function InvitationError({ reset }: { reset: () => void }) { return <main><h1>Invitation could not be loaded</h1><p role="alert">Please retry. No access has been changed.</p><button onClick={reset}>Try again</button></main>; }
