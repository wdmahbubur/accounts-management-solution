import styles from "../workspace.module.css";
export default function Loading() {
  return <main className={styles.page} aria-busy="true"><p role="status">Loading company settings…</p></main>;
}
