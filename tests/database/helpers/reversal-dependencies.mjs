import { randomUUID } from "node:crypto";
import { request } from "./accounting-fixture.mjs";
import { readStatementMatrix, mapStatementRows } from "../../../apps/web/server/banking/statement-import.ts";

export const reverseSql = "SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)";
export function reverseArgs(f, doc, date = "2025-01-20", meta = request("dependency reversal")) {
  return [f.org, doc.document_id, date, "Synthetic correction after resolving dependencies", meta.id, meta.key, meta.hash];
}

export async function bankScenario(f) {
  const invoice = await f.posted(f.body("invoice", "100.00"));
  const item = (await f.openItems(invoice))[0].id;
  const receipt = await f.posted(f.body("receipt", "100.00", { allocation_plan: [{ target_open_item_id: item, amount: "100.00" }] }));
  const book = (await f.journal(receipt)).find(row => row.code === "1010").id;
  const csv = `Date,Description,Debit,Credit,Reference\n2025-01-15,Synthetic receipt one,,60.00,${randomUUID()}\n2025-01-15,Synthetic receipt two,,40.00,${randomUUID()}\n`;
  const source = await readStatementMatrix(new File([csv], "synthetic-dependency.csv", { type: "text/csv" }));
  const mapped = mapStatementRows(source.matrix, { date: 0, description: 1, debit: 2, credit: 3, reference: 4 });
  if (mapped.errors.length) throw new Error("Invalid synthetic bank fixture.");
  const imported = (await f.rpc("SELECT public.import_bank_statement_rows($1,$2,$3,$4,$5::jsonb,$6::bytea) AS value",
    [f.org, f.cash, source.sha256, "synthetic-dependency.csv", JSON.stringify(mapped.rows), source.bytes])).rows[0].value;
  const statements = (await f.admin.query("SELECT id,amount::text FROM finance.statement_lines WHERE organization_id=$1 AND import_id=$2 ORDER BY amount DESC", [f.org, imported.id])).rows;
  const reconciliation = (await f.rpc("SELECT public.create_reconciliation($1,$2,'2025-01-15','2025-01-15','0.00','100.00',$3) AS id", [f.org, f.cash, request("reconciliation").id])).rows[0].id;
  const add = async (row, user = f.ids.owner) => (await f.rpc("SELECT public.add_reconciliation_match($1,$2,$3,$4,$5,$6) AS id", [f.org, reconciliation, row.id, book, row.amount, request("match").id], user)).rows[0].id;
  const unmatch = async id => (await f.rpc("SELECT public.reverse_reconciliation_match($1,$2,$3,$4,$5) AS id", [f.org, reconciliation, id, "Synthetic match correction", request("unmatch").id])).rows[0].id;
  const finalize = () => f.rpc("SELECT public.finalize_reconciliation($1,$2,$3)", [f.org, reconciliation, request("finalize").id]);
  const reopen = () => f.rpc("SELECT public.reopen_reconciliation($1,$2,$3,$4)", [f.org, reconciliation, "Synthetic authorized correction", request("reopen").id]);
  return { receipt, book, statements, reconciliation, add, unmatch, finalize, reopen };
}

export async function creditScenario(f, type) {
  const original = await f.posted(f.body(type === "customer_credit" ? "invoice" : "bill", "100.00"));
  const meta = request(type);
  await f.rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,'Synthetic dependency acceptance policy')",
    [f.org, meta.id, meta.key, meta.hash, `Acceptance ${type}`, type, f.ownerRole]);
  const originalLine = (await f.admin.query("SELECT id FROM finance.document_lines WHERE organization_id=$1 AND document_id=$2", [f.org, original.document_id])).rows[0].id;
  const credit = await f.posted(f.body(type, "40.00", {
    party_id: f.contacts[type === "customer_credit" ? "customer" : "vendor"], due_date: null,
    trade: { original_document_id: original.document_id, recognition_mode: "earned_or_incurred", performance_confirmed: true },
    lines: [{ ...f.line("40.00", f.accounts[type === "customer_credit" ? "4000" : "6000"]), original_line_id: originalLine }]
  }));
  return { original, credit };
}
