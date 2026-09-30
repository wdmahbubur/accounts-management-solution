import { accountingModule } from "@ams/accounting";
import { contractsModule } from "@ams/contracts";
import { permissionsModule } from "@ams/permissions";
import { reportingModule } from "@ams/reporting";

const modules = [
  accountingModule,
  reportingModule,
  contractsModule,
  permissionsModule
] as const;

export default function Home() {
  return (
    <main>
      <p className="eyebrow">US-002 bootstrap</p>
      <h1>Accounts Management Solution</h1>
      <p>
        The Next.js shell is ready for bounded stories. Financial behavior,
        database migrations, authentication and production deployment are not
        implemented by this scaffold.
      </p>

      <section aria-labelledby="module-boundaries">
        <h2 id="module-boundaries">Modular boundaries</h2>
        <ul>
          {modules.map((module) => (
            <li key={module.name}>
              <strong>{module.name}</strong>
              <span>{module.responsibility}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
