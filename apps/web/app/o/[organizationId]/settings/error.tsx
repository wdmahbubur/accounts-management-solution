"use client";
import styles from "../workspace.module.css";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className={styles.page}><h1>Settings could not be loaded</h1>
    <p role="alert">Please try loading company settings again.</p><button type="button" onClick={reset}>Try again</button></main>;
}
