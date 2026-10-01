"use client";

import { useState } from "react";

import { createCompanyAction } from "../actions.ts";

const STORAGE_KEY = "ams:onboarding-company:v1";
const stepNames = ["Company", "Calendar", "Books", "Team", "Review"] as const;

type Draft = {
  name: string;
  legalName: string;
  countryCode: string;
  timezone: string;
  fiscalMonth: string;
  booksStartDate: string;
  idempotencyKey: string;
};

const emptyDraft: Draft = {
  name: "",
  legalName: "",
  countryCode: "BD",
  timezone: "Asia/Dhaka",
  fiscalMonth: "1",
  booksStartDate: "",
  idempotencyKey: ""
};

export function CompanyOnboardingWizard({
  initialIdempotencyKey
}: {
  initialIdempotencyKey: string;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    ...emptyDraft,
    idempotencyKey: initialIdempotencyKey
  });
  const [saved, setSaved] = useState(false);

  function persist(next: Draft) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    persist(next);
    setSaved(false);
  }

  function saveDraft() {
    persist(draft);
    setSaved(true);
  }

  function restoreDraft() {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<Draft>;
      const restored = {
        ...emptyDraft,
        ...parsed,
        idempotencyKey:
          typeof parsed.idempotencyKey === "string" &&
          parsed.idempotencyKey.length >= 22
            ? parsed.idempotencyKey
            : initialIdempotencyKey
      };
      setDraft(restored);
      setSaved(true);
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  const canContinue =
    step === 0
      ? Boolean(draft.name && draft.legalName && /^[A-Za-z]{2}$/.test(draft.countryCode))
      : step === 1
        ? Boolean(draft.timezone && Number(draft.fiscalMonth) >= 1 && Number(draft.fiscalMonth) <= 12)
        : step === 2
          ? Boolean(draft.booksStartDate)
          : true;

  return (
    <form action={createCompanyAction} className="wizard">
      <input type="hidden" name="name" value={draft.name} />
      <input type="hidden" name="legal_name" value={draft.legalName} />
      <input type="hidden" name="country_code" value={draft.countryCode.toUpperCase()} />
      <input type="hidden" name="base_currency" value="BDT" />
      <input type="hidden" name="timezone" value={draft.timezone} />
      <input type="hidden" name="fiscal_year_start_month" value={draft.fiscalMonth} />
      <input type="hidden" name="books_start_date" value={draft.booksStartDate} />
      <input type="hidden" name="idempotency_key" value={draft.idempotencyKey} />

      <ol className="wizard-steps" aria-label="Company setup steps">
        {stepNames.map((name, index) => (
          <li key={name} data-current={step === index ? "true" : "false"}>
            {index + 1}. {name}
          </li>
        ))}
      </ol>

      <section className="panel">
        {step === 0 ? (
          <>
            <h2>Company identity</h2>
            <label className="field">
              <span>Display name</span>
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                maxLength={160}
                required
              />
            </label>
            <label className="field">
              <span>Legal name</span>
              <input
                value={draft.legalName}
                onChange={(event) => update("legalName", event.target.value)}
                maxLength={240}
                required
              />
            </label>
            <label className="field">
              <span>Country code</span>
              <input
                value={draft.countryCode}
                onChange={(event) => update("countryCode", event.target.value)}
                maxLength={2}
                required
              />
            </label>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2>Fiscal calendar</h2>
            <label className="field">
              <span>Base currency</span>
              <input value="BDT" readOnly aria-describedby="bdt-note" />
            </label>
            <p id="bdt-note" className="muted">
              V1 is BDT-only. Foreign currency is rejected rather than silently converted.
            </p>
            <label className="field">
              <span>Timezone</span>
              <input
                value={draft.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                placeholder="Asia/Dhaka"
                required
              />
            </label>
            <label className="field">
              <span>Fiscal year starts in</span>
              <select
                value={draft.fiscalMonth}
                onChange={(event) => update("fiscalMonth", event.target.value)}
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index + 1} value={String(index + 1)}>
                    {new Intl.DateTimeFormat("en", { month: "long" }).format(
                      new Date(2026, index, 1)
                    )}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2>Books and starter accounts</h2>
            <label className="field">
              <span>Books start date</span>
              <input
                type="date"
                value={draft.booksStartDate}
                onChange={(event) => update("booksStartDate", event.target.value)}
                required
              />
            </label>
            <p className="muted">
              Setup creates the reviewed 29-account starter chart, required system mappings,
              one opening period and regular periods through the fiscal-year end. Foundational
              dates and currency become restricted after financial posting begins.
            </p>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2>Roles, cash and tax setup</h2>
            <p>
              Setup creates the sourced system role templates and assigns your verified account
              the Owner template. Detailed role capabilities are configured by the dedicated
              permissions story and cannot be self-granted here.
            </p>
            <p className="muted">
              Starter Cash on hand, Bank, Mobile wallet, AR/AP, advance, tax, retained-earnings,
              opening-suspense and rounding accounts are included. Team invitations and policy
              configuration are completed in their dedicated workflows.
            </p>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h2>Review and create</h2>
            <dl className="review-list">
              <div><dt>Company</dt><dd>{draft.name || "—"}</dd></div>
              <div><dt>Legal name</dt><dd>{draft.legalName || "—"}</dd></div>
              <div><dt>Country</dt><dd>{draft.countryCode.toUpperCase() || "—"}</dd></div>
              <div><dt>Currency</dt><dd>BDT</dd></div>
              <div><dt>Timezone</dt><dd>{draft.timezone || "—"}</dd></div>
              <div><dt>Fiscal start month</dt><dd>{draft.fiscalMonth}</dd></div>
              <div><dt>Books start</dt><dd>{draft.booksStartDate || "—"}</dd></div>
            </dl>
            <p className="muted">
              The final command is atomic: company, owner membership, templates, starter COA,
              mappings and periods either all commit or all roll back.
            </p>
          </>
        ) : null}

        <div className="actions">
          {step > 0 ? (
            <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={saveDraft}>
            Save draft
          </button>
          <button type="button" className="secondary" onClick={restoreDraft}>
            Restore saved draft
          </button>
          {step < stepNames.length - 1 ? (
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          ) : (
            <button type="submit" disabled={!draft.idempotencyKey || !canContinue}>
              Create company
            </button>
          )}
        </div>
        {saved ? <p className="muted" role="status">Draft saved in this browser session.</p> : null}
      </section>
    </form>
  );
}
