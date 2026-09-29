"""Static artifact consistency checks. NOT a SQL parser, DB test or security audit."""
from __future__ import annotations
import json
from pathlib import Path
import re
import sys
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
checks: list[dict[str, object]] = []

def check(name: str, condition: bool, detail: str = '') -> None:
    checks.append({'check': name, 'passed': bool(condition), 'detail': detail})

def main() -> int:
    catalog = json.loads((ROOT / 'schema-catalog.json').read_text())
    screens = json.loads((ROOT / 'ui-screen-catalog.json').read_text())
    sql = (ROOT / 'reference-schema.sql').read_text()
    table_map = {t['name']: t for t in catalog}
    names = list(table_map)
    sql_tables = re.findall(r'CREATE TABLE finance\.(\w+)\s*\(', sql)
    check('52 unique catalog tables', len(catalog) == len(table_map) == 52)
    check('SQL tables match the catalogue exactly', set(sql_tables) == set(names) and len(sql_tables) == 52)
    check('All column names unique within each table', all(len(t['fields']) == len({f[0] for f in t['fields']}) for t in catalog))
    check('Every tenant table has org key and composite identity', all(not t['tenant'] or ('organization_id' in dict(t['fields']) and 'UNIQUE (organization_id, id)' in t['constraints']) for t in catalog))
    fk_errors = []; fk_count = 0
    for t in catalog:
        fields = dict(t['fields'])
        for rule in t['constraints']:
            m = re.search(r'FOREIGN KEY \(([^)]+)\) REFERENCES finance\.(\w+)\s*\(([^)]+)\)', rule)
            if not m:
                continue
            fk_count += 1
            local = [x.strip() for x in m[1].split(',')]
            target = m[2]
            remote = [x.strip() for x in m[3].split(',')]
            if target not in table_map or not all(x in fields for x in local):
                fk_errors.append(f'{t["name"]}: missing local column/target in {rule}')
                continue
            tf = dict(table_map[target]['fields'])
            if len(local) != len(remote) or not all(x in tf for x in remote):
                fk_errors.append(f'{t["name"]}: invalid remote columns in {rule}')
            unique = f'UNIQUE ({", ".join(remote)})'
            if remote != ['id'] and unique not in table_map[target]['constraints']:
                fk_errors.append(f'{t["name"]}: remote key not declared unique: {rule}')
            if table_map[target]['tenant'] and (local[0] != 'organization_id' or remote[0] != 'organization_id'):
                fk_errors.append(f'{t["name"]}: tenant FK not paired: {rule}')
    check('Composite foreign-key fields/targets/unique keys resolve', not fk_errors, f'{fk_count} composite FKs examined; ' + '; '.join(fk_errors))
    inline_errors = []
    for t in catalog:
        for col, definition in t['fields']:
            for m in re.finditer(r'REFERENCES finance\.(\w+)\(([^)]+)\)', definition):
                if m[1] not in table_map or m[2] not in dict(table_map[m[1]]['fields']):
                    inline_errors.append(f'{t["name"]}.{col}: unresolved inline FK')
                elif table_map[m[1]]['tenant']:
                    inline_errors.append(f'{t["name"]}.{col}: tenant target needs composite FK')
    check('Inline financial references resolve without unpaired tenant targets', not inline_errors, '; '.join(inline_errors))
    rls = re.findall(r'ALTER TABLE finance\.(\w+) ENABLE ROW LEVEL SECURITY;', sql)
    check('RLS-enable declaration exists for all 52 tables', len(rls) == 52 and set(rls) == set(names))
    check('No ordinary-user DML grant in SQL reference', not re.search(r'GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE|SELECT\s*,\s*(?:INSERT|UPDATE|DELETE))', sql, re.I))
    check('No SQL creation of broad API exposure', 'CREATE SCHEMA api' not in sql and 'ALTER ROLE' not in sql)
    funcs = re.findall(r'CREATE FUNCTION finance_private\.(\w+)\(', sql)
    check('Three named read helper functions have restricted search path', len(funcs) == 3 and sql.count("SECURITY DEFINER SET search_path = ''") == 3)
    check('Read helper execute privileges revoked before explicit grant', all(re.search(r'REVOKE ALL ON FUNCTION finance_private\.' + re.escape(fn) + r'\([^;]+FROM PUBLIC, anon, authenticated;', sql) for fn in funcs))
    idx = re.findall(r'CREATE (?:UNIQUE )?INDEX (\w+)', sql)
    check('Explicit index names unique and within PostgreSQL identifier length', len(idx) == len(set(idx)) and all(len(x.encode()) <= 63 for x in idx), f'{len(idx)} indexes')
    check('Reference SQL enclosed in one transaction', bool(re.search(r'^BEGIN;', sql, re.M)) and sql.rstrip().endswith('COMMIT;'))
    check('Reference SQL includes decimal and one-sided line invariants', 'numeric(20,2)' in sql and 'CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))' in sql)
    check('All 54 UI IDs sequential', [s['id'] for s in screens] == [f'UI-{i:02}' for i in range(1, 55)])
    req = ['id', 'title', 'routes', 'permission', 'structure', 'actions', 'validation', 'acceptance']
    check('Every UI group includes route, access, structure and acceptance', all(all(s.get(k) for k in req) for s in screens))
    ui_md = (ROOT / '05-ui-specification.md').read_text()
    check('UI Markdown includes every screen group', all(s['id'] in ui_md and s['title'] in ui_md for s in screens))
    dictionary = (ROOT / '04-data-dictionary.md').read_text()
    check('Data dictionary includes every table', all(f'`{t}`' in dictionary for t in names))
    source_refs: set[int] = set()
    for file in ROOT.glob('*.md'):
        if file.name == '09-verification-report.md':
            continue
        for group in re.findall(r'\[(S\d+(?:\s*,\s*S\d+)*)\]', file.read_text()):
            source_refs.update(int(x) for x in re.findall(r'S(\d+)', group))
    check('All cited source IDs resolve to S1-S15', source_refs <= set(range(1, 16)) and bool(source_refs), str(sorted(source_refs)))
    src = (ROOT / '08-sources.md').read_text()
    check('Sources catalogue contains all 15 source groups', all(re.search(r'\| S'+str(i)+r' \|', src) for i in range(1, 16)))
    accept = (ROOT / '07-acceptance-and-delivery.md').read_text()
    tc = set(re.findall(r'\| (T-\d+) \|', accept)); sc = set(re.findall(r'\| (S-\d+) \|', accept))
    check('52 business and 20 security acceptance specifications present', len(tc) == 52 and len(sc) == 20, f'{len(tc)} + {len(sc)}')
    prd = (ROOT / '01-product-requirements.md').read_text()
    check('19 functional requirement groups present', len(set(re.findall(r'### FR-(\d+)', prd))) == 19)
    must = ['README.md', '01-product-requirements.md', '02-accounting-rules.md', '03-database-design.md', '04-data-dictionary.md', '05-ui-specification.md', '06-api-contracts.md', '07-acceptance-and-delivery.md', '08-sources.md', 'reference-schema.sql', 'tests/test_accounting_reference.py']
    check('Core package files all present', all((ROOT / f).is_file() for f in must))
    check('Untested SQL and unimplemented write-guard boundary explicit', 'not been executed against PostgreSQL' in (ROOT / '03-database-design.md').read_text() and 'NOT an applied or integration-tested migration' in sql)
    result = {'scope': 'Static artifact consistency only; no SQL parse/execute or security audit', 'table_count': len(catalog), 'column_count': sum(len(t['fields']) for t in catalog), 'screen_group_count': len(screens), 'checks_passed': sum(bool(x['passed']) for x in checks), 'checks_total': len(checks), 'checks': checks}
    out = ROOT / 'verification' / 'static-checks.json'
    out.write_text(json.dumps(result, indent=2) + '\n')
    for c in checks:
        print(('PASS' if c['passed'] else 'FAIL') + ' ' + str(c['check']) + (' — ' + str(c['detail']) if c['detail'] else ''))
    print(f'\n{result["checks_passed"]}/{len(checks)} static checks passed.')
    return 0 if all(c['passed'] for c in checks) else 1

if __name__ == '__main__':
    sys.exit(main())
