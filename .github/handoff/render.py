"""Render the reviewed AMS source specification into an AI-executable backlog.
Standard library only. This module does not access GitHub or mutate source files.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

REPO = 'wdmahbubur/accounts-management-solution'
WEB = f'https://github.com/{REPO}'
DOC = f'{WEB}/blob/master/docs/'
EPICS = {
    '00': 'Foundation and implementation contracts',
    '01': 'Tenant isolation, identity and permissions',
    '02': 'Ledger core and posting correctness',
    '03': 'Control subledgers and settlement',
    '04': 'Sales, purchases and daily expenses',
    '05': 'Corrections, refunds and advances',
    '06': 'Banking, journals and ledger foundations',
    '07': 'Migration and bank reconciliation',
    '08': 'Financial statements and period/year close',
    '09': 'Evidence, approval and audit',
    '10': 'Jobs, document delivery and exports',
    '11': 'SaaS billing, security operations and recovery',
    '12': 'Product usability, quality and release gates',
    '13': 'Post-V1 discovery; not approved implementation',
}
MILESTONES = {
    0: ('M0 — Policy and scope approval', 'Approve the product and accounting assumptions. No AI may fabricate professional sign-off.'),
    1: ('M1 — Secure foundation', 'Reproducible toolchain, migrations, authentication, tenancy, permissions and private evidence primitives.'),
    2: ('M2 — Tested accounting engine', 'Exact decimal rules, source lifecycle, transactional ledger, approvals, allocations and correction primitives; pass the first real-DB vertical slice.'),
    3: ('M3 — Daily finance workflows', 'Implement the daily finance screens against proven commands. Cash controls, correction paths and representative end-to-end examples must reconcile.'),
    4: ('M4 — Reports, reconciliation and close', 'Reconcile imports, statements, historical subledgers, month close and year closing. Complete feature-specific DB guards and tests.'),
    5: ('M5 — Commercial operations and recovery', 'Approved billing provider sandbox, delivery/export jobs, support controls, observability, restore evidence and commercial/privacy decisions.'),
    6: ('M6 — Independent pilot and release gates', 'All application tests, measured performance, three authorized restricted pilots, independent review and an explicit release decision.'),
    7: ('M7 — Post-V1 discovery only', 'Separate PRDs and reviewed acceptance criteria. These stories do not authorize implementation, compliance claims, real payments or scope expansion.'),
}
SOURCE_FILES = {
    'fr': '01-product-requirements.md',
    'guards': '03-database-design.md',
    'ui': '05-ui-specification.md',
    'tests': '07-acceptance-and-delivery.md',
}

def table_rows(text: str, pattern: str) -> dict[str, tuple[str, str]]:
    rows = {}
    for line in text.splitlines():
        cells = [x.strip() for x in line.strip().strip('|').split('|')]
        if len(cells) >= 3 and re.fullmatch(pattern, cells[0]):
            rows[cells[0]] = (cells[1], ' | '.join(cells[2:]))
    return rows

def references(docs: Path) -> dict:
    prd = (docs / SOURCE_FILES['fr']).read_text(encoding='utf-8')
    tests = (docs / SOURCE_FILES['tests']).read_text(encoding='utf-8')
    guards = (docs / SOURCE_FILES['guards']).read_text(encoding='utf-8')
    return {
        'fr': dict(re.findall(r'^### (FR-\d+) ([^\n]+)', prd, re.M)),
        'guards': table_rows(guards, r'DB-G\d+'),
        'tests': table_rows(tests, r'[TS]-\d+'),
        'ui': {s['id']: s for s in json.loads((docs / 'ui-screen-catalog.json').read_text(encoding='utf-8'))},
    }

def parse_catalog(folder: Path, refs: dict) -> tuple[list[dict], list[str]]:
    stories = []
    for p in sorted(folder.glob('stories-*.psv')):
        for line_number, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
            if not line.strip():
                continue
            c = line.split('|')
            if len(c) != 14:
                raise ValueError(f'{p.name}:{line_number}: expected 14 columns, got {len(c)}')
            sid, epic, milestone, deps, fr, ui, guards, tests, persona, title, goal, criteria, tables, api = c
            nums = lambda x, prefix: [f'{prefix}{int(n):02d}' for n in x.split(',') if n]
            s = {
                'id': f'US-{int(sid):03d}', 'epic': f'E{int(epic):02d}', 'milestone': int(milestone),
                'depends_on': [f'US-{int(n):03d}' for n in deps.split(',') if n],
                'fr': nums(fr, 'FR-'), 'ui': nums(ui, 'UI-'), 'guards': nums(guards, 'DB-G'),
                'tests': list(refs['tests']) if tests == 'ALL' else [f'{x[0]}-{int(x[1:]):02d}' for x in tests.split(',') if x],
                'persona': persona, 'title': title, 'goal': goal,
                'acceptance': criteria.split(';;'), 'tables': tables, 'api': api,
                'phase': 'post-v1' if int(milestone) == 7 else 'v1',
                'priority': 'P2' if int(milestone) == 7 else ('P1' if int(sid) in [76, 83] else 'P0'),
                'human_review': int(sid) in [1, 75, 76, 81, 87, 88, 96],
            }
            stories.append(s)
    by_id = {s['id']: s for s in stories}
    if len(stories) != 100 or set(by_id) != {f'US-{n:03d}' for n in range(1, 101)}:
        raise ValueError('The catalogue must contain exactly US-001..US-100 without duplicates')
    # Story-level prerequisites replace the source's illustrative coarse epic ordering.
    by_id['US-018']['depends_on'].append('US-064')
    for s in stories:
        if 3 <= s['milestone'] <= 6:
            s['depends_on'].append('US-021')
            if s['ui']:
                s['depends_on'].append('US-082')
        if s['id'] in {f'US-{n:03d}' for n in [32, 35, 36, 39, 40, 41, 43, 46]}:
            s['depends_on'].append('US-045')
    by_id['US-085']['depends_on'].extend(s['id'] for s in stories if s['milestone'] <= 5)
    for s in stories:
        s['depends_on'] = sorted(set(s['depends_on']))
        if s['id'] in s['depends_on'] or any(x not in by_id for x in s['depends_on']):
            raise ValueError(f'Invalid dependency: {s["id"]}')
        if s['epic'][1:] not in EPICS or s['milestone'] not in MILESTONES:
            raise ValueError(f'Invalid epic/milestone: {s["id"]}')
        if len(s['acceptance']) < 4 or not all(s[k] for k in ('persona', 'title', 'goal', 'api')):
            raise ValueError(f'Incomplete story: {s["id"]}')
        for field in ('fr', 'ui', 'guards', 'tests'):
            if any(x not in refs[field] for x in s[field]):
                raise ValueError(f'Unknown {field} source ID in {s["id"]}')
        if s['phase'] == 'v1' and any(by_id[x]['phase'] != 'v1' for x in s['depends_on']):
            raise ValueError('A V1 story cannot require post-V1 discovery')
    remaining = set(by_id)
    order = []
    while remaining:
        ready = sorted((x for x in remaining if set(by_id[x]['depends_on']) <= set(order)),
                       key=lambda x: (by_id[x]['milestone'], x))
        if not ready:
            raise ValueError(f'Dependency cycle among {sorted(remaining)}')
        chosen = ready[0]
        order.append(chosen)
        remaining.remove(chosen)
    coverage = coverage_map(stories, refs)
    missing = [(group, key) for group, rows in coverage.items() for key, ids in rows.items() if not ids]
    if missing:
        raise ValueError(f'Uncovered original requirements: {missing}')
    return sorted(stories, key=lambda s: s['id']), order

def coverage_map(stories: list[dict], refs: dict) -> dict:
    return {group: {key: [s['id'] for s in stories if s['phase'] == 'v1' and key in s[group]]
                    for key in rows} for group, rows in refs.items()}

def issue_link(key: str, mapping: dict) -> str:
    item = mapping[key]
    return f'[{key} #{item["number"]}]({item["url"]})'

def labels_for(s: dict) -> list[str]:
    labels = ['type:story', f'epic:{s["epic"]}', f'priority:{s["priority"]}',
              f'phase:{s["phase"]}', 'status:blocked' if s['depends_on'] else 'status:ready']
    if s['human_review']:
        labels.append('needs:human-review')
    return labels

def source_link(group: str, key: str) -> str:
    return f'[{key}]({DOC}{SOURCE_FILES[group]})'

def story_body(s: dict, refs: dict, mapping: dict) -> str:
    discovery = s['phase'] == 'post-v1'
    lines = [f'<!-- ams:{s["id"]} -->', f'# {s["id"]} — {s["title"]}', '',
             f'**Epic:** {issue_link(s["epic"], mapping)}  |  **Milestone:** {MILESTONES[s["milestone"]][0]}  |  **Priority:** {s["priority"]}',
             f'**Scope:** {"Post-V1 discovery only — not implementation approval" if discovery else "V1 implementation / review gate"}', '',
             '## User story', f'As a **{s["persona"]}**, I want to **{s["goal"]}**.', '',
             '## Start here', f'Read [AGENTS.md]({WEB}/blob/master/AGENTS.md), the [AI execution guide]({DOC}11-ai-execution-guide.md), '
             f'and the [source handoff]({DOC}README.md). Source baseline: version 1.0, 29 September 2026. '
             'The reference schema is not an applied migration; the application is not implemented by this planning issue.', '',
             '## Prerequisites']
    if s['depends_on']:
        lines.extend(f'- [ ] {issue_link(x, mapping)} — merged and its required verification passed.' for x in s['depends_on'])
    else:
        lines.append('No story prerequisites. Read the source contract and current repository before starting.')
    lines.extend(['', 'Dependency checkboxes and `status:*` labels describe the initial plan, not live automation. '
                  'Check the actual linked issues and merged code before working. A closed issue without the required evidence is not sufficient.', '',
                  '## Acceptance criteria'])
    lines.extend(f'- [ ] {text}.' for text in s['acceptance'])
    lines.extend(['', '## Implementation boundary', f'**Data / domains:** {s["tables"]}.',
                  f'**API / surface:** {s["api"]}.',
                  'Resolve exact column names and command paths from the linked dictionary/API contract; do not treat this summary as an alternative schema.'])
    if s['fr']:
        lines.extend(['', '### Product requirements'])
        lines.extend(f'- {source_link("fr", key)} — {refs["fr"][key]}.' for key in s['fr'])
    lines.extend(['', f'**Accounting:** [rules]({DOC}02-accounting-rules.md). '
                  f'**Database:** [design]({DOC}03-database-design.md), [dictionary]({DOC}04-data-dictionary.md), '
                  f'[reference SQL]({DOC}reference-schema.sql). **Commands:** [API contract]({DOC}06-api-contracts.md).'])
    if s['ui']:
        lines.extend(['', '## UI contract', 'These are shared screen groups. Implement the portions required by this story; '
                      'related stories own the remaining behavior. All affected screens need loading, empty, validation, '
                      'forbidden and conflict states and keyboard-accessible controls.'])
        for key in s['ui']:
            ui = refs['ui'][key]
            lines.extend(['', f'### {key} — {ui["title"]}', f'**Routes:** `{ui["routes"]}`',
                          f'**Access:** {ui["permission"]}', f'**Structure:** {ui["structure"]}',
                          f'**Actions:** {ui["actions"]}', f'**Validation:** {ui["validation"]}',
                          f'**Expected outcome:** {ui["acceptance"]}'])
    if s['guards']:
        lines.extend(['', '## Database/accounting guards'])
        for key in s['guards']:
            title, expectation = refs['guards'][key]
            lines.append(f'- [ ] {source_link("guards", key)} **{title}:** {expectation}.')
    if s['tests']:
        lines.extend(['', '## Required verification', 'Implement or extend the following original acceptance cases in the real application. '
                      'The existing Python reference/static tests are useful baselines but do not prove these cases pass.'])
        for key in s['tests']:
            title, expectation = refs['tests'][key]
            lines.append(f'- [ ] {source_link("tests", key)} **{title}:** {expectation}.')
    else:
        lines.extend(['', '## Required verification', 'Add focused tests for each acceptance criterion and attach reproducible evidence. '
                      'For a discovery or professional-review gate, provide the reviewed decision record, scenarios and unresolved questions instead of claiming app tests ran.'])
    lines.extend(['', '## AI implementation procedure',
                  '1. Inspect the current branch, linked prerequisites and source sections. State the bounded plan in the issue/PR; do not reimplement completed modules.',
                  '2. Use a branch such as `feat/us-NNN-short-title`. Make reviewed versioned migrations where needed; preserve unrelated code and source documents.',
                  '3. Implement contracts, authorization and DB/domain behavior before wiring financial UI. Add negative, replay and cross-tenant tests; use independent connections for races.',
                  '4. Run the repository\'s actual documented checks. Record exact commands, results, commit and limitations; never invent scripts, screenshots, test output or reviewer approval.',
                  '5. Open a focused PR referencing this issue. Add closure wording only when all acceptance criteria and dependencies are satisfied. Do not deploy production or move money without separate authorization.', '',
                  '## Definition of done',
                  '- [ ] All in-scope acceptance criteria implemented or, for discovery, documented and reviewed; unrelated future scope remains excluded.',
                  '- [ ] Required prerequisites are merged and verified; changed contracts/schema/docs are consistent.',
                  '- [ ] Appropriate unit, real-database, API and browser tests pass; skipped/unavailable external tests are disclosed.',
                  '- [ ] Tenant/capability checks, precise money, period locks, idempotency and audit are preserved wherever applicable.',
                  '- [ ] PR describes changed files, migrations, tests, residual risks and rollback implications; no secrets or real customer data committed.'])
    if s['human_review']:
        lines.append('- [ ] Named authorized human/provider/accounting review is recorded. An AI must not mark this review complete on its own.')
    lines.extend(['', '## Out of scope',
                  'This issue delivers a discovery PRD and separately reviewable implementation backlog only. No live integration, statutory claim, payment or production feature is authorized.' if discovery else
                  'No inventory costing, payroll, foreign currency, autonomous AI posting, live payment execution or statutory compliance certification unless a separately approved scope explicitly adds it.',
                  '', 'Planning status: creating this issue does not mean any product feature or acceptance test is complete.'])
    body = '\n'.join(lines) + '\n'
    if len(body) > 60000:
        raise ValueError(f'{s["id"]} exceeds conservative GitHub issue body limit')
    return body

def epic_body(epic: str, stories: list[dict], mapping: dict) -> str:
    subset = [s for s in stories if s['epic'] == epic]
    lines = [f'<!-- ams:{epic} -->', f'# {epic} — {EPICS[epic[1:]]}', '',
             'Implementation tracker, not a completed deliverable. Story-level dependencies are authoritative; '
             'epic labels are grouping, not a promise that the entire epic executes in one milestone.', '',
             f'Read the [source specification]({DOC}README.md), [roadmap]({DOC}10-implementation-roadmap.md) and '
             f'[AI guide]({DOC}11-ai-execution-guide.md).', '', '## Story checklist']
    lines.extend(f'- [ ] {issue_link(s["id"], mapping)} — {s["title"]} ({MILESTONES[s["milestone"]][0].split(" — ")[0]}).' for s in subset)
    lines.extend(['', '## Epic completion gate', 'Close only after every in-scope child story is merged, required tests/reviews pass and unresolved blockers are recorded. '
                  'For E13, completion means reviewed discovery, not implementation or release.', '',
                  'The parent checklist is an initial tracking aid, not a native GitHub blocking relationship or automatic workflow.'])
    return '\n'.join(lines) + '\n'

def roadmap(stories: list[dict], order: list[str], mapping: dict) -> str:
    lines = ['# Implementation roadmap and GitHub issue index', '',
             'Source: AMS specification v1.0, 29 September 2026. Backlog: 100 stories, 14 epic trackers, one master tracker and eight milestones. '
             '88 stories cover V1 implementation/review gates; 12 are post-V1 discovery only. None is marked implemented by publication.', '',
             '## Read and execute', f'Begin with [AGENTS.md]({WEB}/blob/master/AGENTS.md), [source handoff](README.md), '
             '[AI guide](11-ai-execution-guide.md) and [coverage matrix](12-coverage-matrix.md). '
             'Choose one open story whose linked prerequisites are complete. Never simply sort by issue number: some core approval/evidence stories are intentionally earlier dependencies.', '',
             'Start policy review with ' + issue_link('US-001', mapping) + ' and repository/test setup with ' + issue_link('US-002', mapping) + '. '
             'Do not claim professional policy sign-off on behalf of the owner/accountant.', '',
             '## Milestones', '| Milestone | Exit intent |', '|---|---|']
    lines.extend(f'| {title} | {description} |' for title, description in MILESTONES.values())
    lines.extend(['', 'Cross-cutting stories intentionally span epic groups. M2 proves core transactional guards; '
                  'feature-specific reconciliation and year-close guards are completed with their M4 stories. '
                  'The final V1 test gate US-085 depends on all pre-pilot V1 stories. Milestone dates are not estimates or promises.', '',
                  '## Epic trackers', '| Epic | GitHub tracker | Stories |', '|---|---|---:|'])
    lines.extend(f'| E{key} — {title} | {issue_link("E"+key, mapping)} | {sum(s["epic"] == "E"+key for s in stories)} |' for key, title in EPICS.items())
    lines.extend(['', '## Complete story index', '| ID / GitHub | Story | Milestone | Priority | Prerequisites |', '|---|---|---|---|---|'])
    for s in stories:
        deps = ', '.join(issue_link(d, mapping) for d in s['depends_on']) or 'None'
        lines.append(f'| {issue_link(s["id"], mapping)} | {s["title"]} | M{s["milestone"]} | {s["priority"]} | {deps} |')
    lines.extend(['', '## One valid execution order', 'This is a dependency-safe order, not a demand to serialize independent work. '
                  'Readiness must be re-evaluated from actual merged issues, test evidence and outstanding reviews.', '',
                  '```text', ' → '.join(order), '```', '',
                  '## Machine-readable handoff', '`backlog.json` contains the story catalogue, source-ID mappings, actual issue URLs and topological order. '
                  '`issue-map.json` contains live-created issue identities. `user-stories/` mirrors the initial issue bodies. '
                  'GitHub discussions and merged code are authoritative for subsequent progress; mirrors are not continuously synchronized.'])
    return '\n'.join(lines) + '\n'

def coverage_md(stories: list[dict], refs: dict, mapping: dict) -> str:
    cov = coverage_map(stories, refs)
    lines = ['# Source-to-story coverage matrix', '',
             'This proves that each source requirement has assigned backlog ownership. It does **not** prove implementation or passing application tests. '
             'Some cross-cutting tests are assigned to several feature stories and to the final full-suite gate.', '',
             'Coverage: 19 functional groups, 54 UI groups, 18 database guards, 52 business acceptance cases and 20 security/concurrency cases.', '']
    for group, rows in cov.items():
        lines.extend([f'## {group.upper()}', '| Source | Description | Responsible stories |', '|---|---|---|'])
        for key, ids in rows.items():
            value = refs[group][key]
            title = value['title'] if group == 'ui' else (value if group == 'fr' else value[0])
            lines.append(f'| {source_link(group, key)} | {title.replace("|", "/")} | {", ".join(issue_link(x, mapping) for x in ids)} |')
        lines.append('')
    return '\n'.join(lines)
