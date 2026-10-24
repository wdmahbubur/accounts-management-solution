import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const nodemailer = createRequire(new URL("../../apps/web/package.json", import.meta.url))("nodemailer");
const addressParser = createRequire(new URL("../../apps/web/package.json", import.meta.url))("nodemailer/lib/addressparser") as (value: string, options: { flatten: boolean }) => { address: string }[];

test("mail envelopes preserve the intended mailbox through nested comments and quoted address syntax", async () => {
  // No network delivery: exercise the installed sender's actual envelope parser.
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const cases = [
    ['Recipient (a(b) <decoy@example.invalid>) <intended@example.invalid>', 'intended@example.invalid'],
    ['Team: (a; <decoy@example.invalid>) <intended@example.invalid>;', 'intended@example.invalid'],
    ['Team: "a;" "<decoy@example.invalid>" <intended@example.invalid>;', 'intended@example.invalid'],
    ['<"part@decoy.example.invalid>"@intended.example.invalid>', '"part@decoy.example.invalid>"@intended.example.invalid'],
    ['Synthetic recipient <intended@example.invalid>', 'intended@example.invalid']
  ];
  for (const [to, expected] of cases) {
    assert.deepEqual(addressParser(to, { flatten: true }).map(recipient => recipient.address), [expected]);
    const result = await transport.sendMail({ from: "sender@example.invalid", to, subject: "Synthetic envelope regression", text: "No external delivery." });
    // SMTP envelope safety sanitizes angle characters inside quoted local parts.
    // The authoritative destination domain must still be the intended domain.
    assert.equal(result.envelope.to.length, 1);
    assert.equal(result.envelope.to[0].slice(result.envelope.to[0].lastIndexOf("@") + 1), expected.slice(expected.lastIndexOf("@") + 1));
    if (!expected.startsWith('"')) assert.deepEqual(result.envelope.to, [expected]);
  }
});
