import Link from "next/link";
import styles from "./landing.module.css";

const capabilities = [
  {
    number: "01",
    title: "Separate company books",
    description:
      "Keep each legal company in its own workspace, with company membership checked before access."
  },
  {
    number: "02",
    title: "Controlled team access",
    description:
      "Invite people and assign role capabilities for the work they are allowed to do."
  },
  {
    number: "03",
    title: "Accounting foundations",
    description:
      "Choose your company’s country and accounting currency, then set up its fiscal periods."
  }
];

export default function Home() {
  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Accounts Management home">
          <span className={styles.brandMark} aria-hidden="true">A</span>
          <span>Accounts<span className={styles.brandSub}>Management Solution</span></span>
        </Link>
        <nav className={styles.headerNav} aria-label="Main navigation">
          <a href="#features">What it does</a>
          <Link href="/auth/sign-in">Sign in</Link>
          <Link href="/auth/sign-up" className={styles.headerCta}>Create account <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>ACCOUNTING WORKSPACE FOR SERVICE BUSINESSES</p>
          <h1>Your company books,<br /><span>clear and connected.</span></h1>
          <p className={styles.lede}>
            Manage separate company accounts, team access and accounting periods in one place.
            Choose a country and supported accounting currency for each company’s accrual books.
          </p>
          <div className={styles.heroActions}>
            <Link href="/auth/sign-up" className={styles.primaryCta}>Create your account <span aria-hidden="true">→</span></Link>
            <Link href="/auth/sign-in" className={styles.secondaryCta}>Sign in</Link>
          </div>
          <p className={styles.scopeNote}>One company, one set of books. No bank custody or automatic payments.</p>
        </div>

        <div className={styles.preview} aria-label="Illustrative product preview">
          <div className={styles.previewTop}>
            <div><span className={styles.previewIcon} aria-hidden="true">A</span><span className={styles.previewCompany}>Northstar Studio <small>Company workspace</small></span></div>
            <span className={styles.previewBadge}>Sample preview</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewHeading}><div><small>Monday, 2 March 2026</small><h2>Workspace overview</h2></div><span>BDT · Accrual</span></div>
            <div className={styles.previewCards}>
              <div><small>Fiscal year</small><strong>2026</strong><span>January – December</span></div>
              <div><small>Your access</small><strong>Owner</strong><span>All current workspace tools</span></div>
            </div>
            <div className={styles.previewSection}><div><strong>Workspace tools</strong><span>Available to this role</span></div></div>
            <div className={styles.previewTools}>
              <div><span className={styles.toolIcon} aria-hidden="true">◫</span><span><strong>Team & roles</strong><small>People and capabilities</small></span></div>
              <div><span className={styles.toolIcon} aria-hidden="true">◷</span><span><strong>Fiscal periods</strong><small>Open period controls</small></span></div>
              <div><span className={styles.toolIcon} aria-hidden="true">⌂</span><span><strong>Company settings</strong><small>Workspace preferences</small></span></div>
            </div>
            <p className={styles.previewFoot}>Illustrative interface · sample company and values</p>
          </div>
        </div>
      </section>

      <section className={styles.trustStrip} aria-label="Product scope">
        <span>Separate company books</span>
        <span>One accounting currency per company</span>
        <span>Role based access</span>
        <span>Accrual accounting</span>
      </section>

      <section className={styles.features} id="features">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>A PLACE TO RUN THE BOOKS</p>
          <h2>Start with a well-organized<br />company workspace.</h2>
          <p>Sign up, create your company, then open the tools your role allows.</p>
        </div>
        <div className={styles.featureGrid}>
          {capabilities.map((item) => (
            <article className={styles.feature} key={item.number}>
              <span className={styles.featureNumber}>{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.bottomCta}>
        <div><p className={styles.eyebrow}>YOUR WORKSPACE STARTS HERE</p><h2>Set up your company books.</h2></div>
        <Link href="/auth/sign-up" className={styles.primaryCta}>Create an account <span aria-hidden="true">→</span></Link>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.brand}><span className={styles.brandMark} aria-hidden="true">A</span><span>Accounts<span className={styles.brandSub}>Management Solution</span></span></Link>
        <span>Company accounting workspace · Separate books for each company</span>
        <Link href="/auth/sign-in">Already have an account? Sign in</Link>
      </footer>
    </main>
  );
}
