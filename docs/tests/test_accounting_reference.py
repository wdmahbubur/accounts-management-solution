"""Executable arithmetic/ledger examples, NOT PostgreSQL or app integration tests.
Run: python -m unittest discover -s tests -v
Requires only the Python standard library.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext
from collections import defaultdict
import re
import unittest

D = Decimal
CENT = D('0.01')
ZERO = D('0.00')


def decimal_input(value: str, scale: int) -> Decimal:
    if not isinstance(value, str) or not re.fullmatch(r'-?\d+(?:\.\d+)?', value):
        raise ValueError('canonical decimal string required')
    n = D(value)
    if not n.is_finite() or max(0, -n.as_tuple().exponent) > scale:
        raise ValueError('invalid decimal scale or finite value')
    if abs(n) >= D(10) ** (20 - scale):
        raise ValueError('out of reference column range')
    return n


def money(value: str) -> Decimal:
    return decimal_input(value, 2).quantize(CENT)


def round_money(n: Decimal) -> Decimal:
    return n.quantize(CENT, rounding=ROUND_HALF_UP)


def calculate_line(qty: str, unit_price: str, discount: str = '0.00',
                   rate: str = '0', inclusive: bool = False) -> tuple[Decimal, Decimal, Decimal]:
    with localcontext() as ctx:
        ctx.prec = 60
        q, p, disc = decimal_input(qty, 6), decimal_input(unit_price, 6), money(discount)
        # Rates are constrained to 0..100; use a parser with enough integer capacity.
        r = decimal_input(rate, 6)
        if q <= 0 or p < 0 or disc < 0 or not (0 <= r <= 100):
            raise ValueError('invalid quantity, price, discount or rate')
        base = round_money(q * p)
        if disc > base:
            raise ValueError('discount exceeds line base')
        x = base - disc
        if inclusive:
            gross = x
            net = round_money(gross / (1 + r / 100))
            tax = gross - net
        else:
            net = x
            tax = round_money(net * r / 100)
            gross = net + tax
        for v in (net, tax, gross):
            money(str(v))  # column range / amount-scale guard
        return net, tax, gross


@dataclass(frozen=True)
class Line:
    account: str
    debit: Decimal = ZERO
    credit: Decimal = ZERO

    def __post_init__(self) -> None:
        if not ((self.debit > 0 and self.credit == 0) or (self.credit > 0 and self.debit == 0)):
            raise ValueError('exactly one positive side required')
        if not all(x.is_finite() and x == x.quantize(CENT) for x in (self.debit, self.credit)):
            raise ValueError('finite two-place amounts required')


def dr(account: str, amount: str) -> Line:
    return Line(account, debit=money(amount))


def cr(account: str, amount: str) -> Line:
    return Line(account, credit=money(amount))


@dataclass(frozen=True)
class Journal:
    source: str
    effective: date
    lines: tuple[Line, ...]


class ReferenceLedger:
    """One-company immutable in-memory example. No auth/RLS/concurrency claims."""
    def __init__(self) -> None:
        self.entries: dict[str, Journal] = {}
        self.locked_through: date | None = None
        self.reversed_sources: set[str] = set()

    def post(self, source: str, effective: date, lines: tuple[Line, ...]) -> Journal:
        candidate = Journal(source, effective, lines)
        if source in self.entries:
            if self.entries[source] != candidate:
                raise ValueError('same source, different payload')
            return self.entries[source]
        if self.locked_through is not None and effective <= self.locked_through:
            raise ValueError('locked period')
        if len(lines) < 2 or sum(x.debit for x in lines) != sum(x.credit for x in lines):
            raise ValueError('unbalanced journal')
        self.entries[source] = candidate
        return candidate

    def balances(self, as_of: date) -> dict[str, Decimal]:
        result = defaultdict(lambda: ZERO)
        for j in self.entries.values():
            if j.effective <= as_of:
                for line in j.lines:
                    result[line.account] += line.debit - line.credit
        return dict(result)

    def reverse(self, source: str, reversal_source: str, effective: date) -> Journal:
        if source in self.reversed_sources:
            raise ValueError('already reversed')
        original = self.entries[source]
        if effective < original.effective:
            raise ValueError('reversal before source')
        result = self.post(reversal_source, effective, tuple(Line(x.account, x.credit, x.debit) for x in original.lines))
        self.reversed_sources.add(source)
        return result


@dataclass(frozen=True)
class OpenItem:
    ident: str
    org: str
    party: str
    control: str
    side: str
    amount: Decimal
    effective: date


@dataclass(frozen=True)
class Allocation:
    ident: str
    debit_id: str
    credit_id: str
    amount: Decimal
    effective: date


class ReferenceAllocations:
    """Dated allocation example; DB row locks/RLS remain integration-test work."""
    def __init__(self, *items: OpenItem) -> None:
        self.items = {x.ident: x for x in items}
        self.allocations: dict[str, Allocation] = {}
        self.reversals: dict[str, date] = {}

    def _events(self, item: str, proposed: Allocation | None = None) -> dict[date, Decimal]:
        events = defaultdict(lambda: ZERO)
        values = list(self.allocations.values()) + ([proposed] if proposed else [])
        for a in values:
            if item in (a.debit_id, a.credit_id):
                events[a.effective] += a.amount
                if a.ident in self.reversals:
                    events[self.reversals[a.ident]] -= a.amount
        return events

    def residual(self, item: str, as_of: date) -> Decimal:
        row = self.items[item]
        if as_of < row.effective:
            return ZERO
        used = sum((delta for dt, delta in self._events(item).items() if dt <= as_of), ZERO)
        return row.amount - used

    def apply(self, ident: str, debit_id: str, credit_id: str, amount: str, effective: date) -> None:
        if ident in self.allocations:
            raise ValueError('duplicate allocation')
        debit, credit = self.items[debit_id], self.items[credit_id]
        n = money(amount)
        if n <= 0 or (debit.side, credit.side) != ('debit', 'credit'):
            raise ValueError('side or amount invalid')
        if (debit.org, debit.party, debit.control) != (credit.org, credit.party, credit.control):
            raise ValueError('org/party/control mismatch')
        if effective < max(debit.effective, credit.effective):
            raise ValueError('allocation before source')
        candidate = Allocation(ident, debit_id, credit_id, n, effective)
        for item in (debit, credit):
            used = ZERO
            for dt, delta in sorted(self._events(item.ident, candidate).items()):
                used += delta
                if used < 0 or used > item.amount:
                    raise ValueError('allocation exceeds historic timeline capacity')
        self.allocations[ident] = candidate

    def unapply(self, ident: str, effective: date) -> None:
        if ident in self.reversals or effective < self.allocations[ident].effective:
            raise ValueError('invalid reversal')
        self.reversals[ident] = effective


def golden_ledger() -> ReferenceLedger:
    l = ReferenceLedger()
    l.post('capital', date(2026, 9, 1), (dr('bank', '100000'), cr('capital', '100000')))
    l.post('invoice', date(2026, 9, 2), (dr('ar', '10000'), cr('revenue', '10000')))
    l.post('receipt', date(2026, 9, 3), (dr('bank', '6000'), cr('ar', '6000')))
    l.post('bill', date(2026, 9, 4), (dr('expense', '4000'), cr('ap', '4000')))
    l.post('payment', date(2026, 9, 5), (dr('ap', '3000'), cr('bank', '3000')))
    l.post('rent', date(2026, 9, 6), (dr('expense', '1000'), cr('bank', '1000')))
    return l


class ArithmeticTests(unittest.TestCase):
    def test_exclusive_tax(self):
        self.assertEqual(calculate_line('1', '10000', rate='10'), (D('10000'), D('1000'), D('11000')))
    def test_inclusive_tax(self):
        self.assertEqual(calculate_line('1', '11000', rate='10', inclusive=True), (D('10000'), D('1000'), D('11000')))
    def test_discount_before_exclusive_tax(self):
        self.assertEqual(calculate_line('2', '100', '20', '10'), (D('180'), D('18'), D('198')))
    def test_inclusive_discount(self):
        self.assertEqual(calculate_line('1', '1100', '110', '10', True), (D('900'), D('90'), D('990')))
    def test_fractional_quantity(self):
        self.assertEqual(calculate_line('0.125', '80')[2], D('10.00'))
    def test_half_up(self):
        self.assertEqual(calculate_line('1', '2.675')[2], D('2.68'))
    def test_exact_small_values(self):
        self.assertEqual(money('0.10') + money('0.20'), money('0.30'))
    def test_discount_exceeds_base(self):
        with self.assertRaises(ValueError): calculate_line('1', '100', '101')
    def test_invalid_numeric_inputs(self):
        for value in ('NaN', 'Infinity', '-Infinity', '1e3', '1,000', '1.001'):
            with self.subTest(value=value), self.assertRaises(ValueError): money(value)
    def test_invalid_quantity_price_rate(self):
        for args in [('0','10','0','0'), ('1','-10','0','0'), ('1','10','0','101')]:
            with self.subTest(args=args), self.assertRaises(ValueError): calculate_line(*args)
    def test_line_total_consistency(self):
        for qty in ('1', '0.3', '2.75'):
            for unit in ('0.99', '123.456789'):
                for rate in ('0', '5', '10', '15'):
                    for inclusive in (False, True):
                        net, tax, gross = calculate_line(qty, unit, rate=rate, inclusive=inclusive)
                        self.assertEqual(net + tax, gross)
    def test_amount_overflow(self):
        with self.assertRaises(ValueError): money('1000000000000000000.00')


class LedgerTests(unittest.TestCase):
    def test_golden_balances(self):
        self.assertEqual(golden_ledger().balances(date(2026,9,30)), {'bank':D('102000'), 'capital':D('-100000'), 'ar':D('4000'), 'revenue':D('-10000'), 'expense':D('5000'), 'ap':D('-1000')})
    def test_golden_profit(self):
        b=golden_ledger().balances(date(2026,9,30));self.assertEqual(-b['revenue']-b['expense'],D('5000'))
    def test_balance_sheet_equation(self):
        b=golden_ledger().balances(date(2026,9,30))
        self.assertEqual(b['bank']+b['ar'], -b['ap']-b['capital']-b['revenue']-b['expense'])
    def test_trial_balance(self):
        self.assertEqual(sum(golden_ledger().balances(date(2026,9,30)).values()),ZERO)
    def test_receipt_does_not_repeat_revenue(self):
        l=golden_ledger();self.assertEqual(l.balances(date(2026,9,2))['revenue'],l.balances(date(2026,9,3))['revenue'])
    def test_unbalanced_rejected(self):
        with self.assertRaises(ValueError): ReferenceLedger().post('bad',date(2026,9,1),(dr('bank','100'),cr('capital','99')))
    def test_same_source_idempotent(self):
        l=ReferenceLedger();rows=(dr('bank','100'),cr('capital','100'))
        a=l.post('one',date(2026,9,1),rows);b=l.post('one',date(2026,9,1),rows)
        self.assertIs(a,b);self.assertEqual(len(l.entries),1)
    def test_same_source_changed_payload(self):
        l=golden_ledger()
        with self.assertRaises(ValueError): l.post('invoice',date(2026,9,2),(dr('ar','1'),cr('revenue','1')))
    def test_reversal_preserves_historic_balance(self):
        l=ReferenceLedger();l.post('i',date(2026,9,1),(dr('ar','100'),cr('revenue','100')))
        l.reverse('i','r',date(2026,10,1))
        self.assertEqual(l.balances(date(2026,9,30))['ar'],D('100'))
        self.assertEqual(l.balances(date(2026,10,1))['ar'],ZERO)
        self.assertEqual(len(l.entries),2)
    def test_duplicate_reversal_rejected(self):
        l=golden_ledger();l.reverse('rent','r1',date(2026,9,7))
        with self.assertRaises(ValueError): l.reverse('rent','r2',date(2026,9,8))
    def test_locked_period(self):
        l=ReferenceLedger();l.locked_through=date(2026,9,30)
        with self.assertRaises(ValueError): l.post('p',date(2026,9,30),(dr('bank','1'),cr('capital','1')))
    def test_advance_not_income(self):
        l=ReferenceLedger();l.post('advance',date(2026,9,1),(dr('bank','5000'),cr('customer_advance','5000')))
        b=l.balances(date(2026,9,1));self.assertNotIn('revenue',b);self.assertEqual(b['customer_advance'],D('-5000'))
    def test_transfer_with_fee(self):
        l=ReferenceLedger();l.post('t',date(2026,9,1),(dr('bank_b','10000'),dr('fee','50'),cr('bank_a','10050')))
        b=l.balances(date(2026,9,1));self.assertEqual(b['bank_a']+b['bank_b'],D('-50'));self.assertEqual(b['fee'],D('50'))
    def test_double_sided_line_rejected(self):
        with self.assertRaises(ValueError): Line('bad',D('100'),D('100'))


class AllocationTests(unittest.TestCase):
    def model(self):
        return ReferenceAllocations(OpenItem('i','org','party','ar','debit',D('10000'),date(2026,9,1)),OpenItem('r','org','party','ar','credit',D('6000'),date(2026,9,3)))
    def test_partial_and_historical(self):
        a=self.model();a.apply('x','i','r','6000',date(2026,9,3))
        self.assertEqual(a.residual('i',date(2026,9,2)),D('10000'))
        self.assertEqual(a.residual('i',date(2026,9,3)),D('4000'))
    def test_overallocation(self):
        a=self.model()
        with self.assertRaises(ValueError): a.apply('x','i','r','6001',date(2026,9,3))
    def test_dated_unapply(self):
        a=self.model();a.apply('x','i','r','6000',date(2026,9,3));a.unapply('x',date(2026,9,10))
        self.assertEqual(a.residual('i',date(2026,9,9)),D('4000'))
        self.assertEqual(a.residual('i',date(2026,9,10)),D('10000'))
    def test_cross_party_rejected(self):
        a=self.model();a.items['r']=OpenItem('r','org','other','ar','credit',D('6000'),date(2026,9,3))
        with self.assertRaises(ValueError):a.apply('x','i','r','1',date(2026,9,3))
    def test_cross_org_rejected_in_reference_model(self):
        a=self.model();a.items['r']=OpenItem('r','other_org','party','ar','credit',D('6000'),date(2026,9,3))
        with self.assertRaises(ValueError):a.apply('x','i','r','1',date(2026,9,3))
    def test_advance_control_cannot_match_ar_directly(self):
        a=self.model();a.items['r']=OpenItem('r','org','party','customer_advance','credit',D('6000'),date(2026,9,3))
        with self.assertRaises(ValueError):a.apply('x','i','r','1',date(2026,9,3))
    def test_before_receipt_date_rejected(self):
        a=self.model()
        with self.assertRaises(ValueError):a.apply('x','i','r','1',date(2026,9,2))
    def test_backdated_timeline_overallocation_rejected(self):
        a=self.model();a.apply('first','i','r','6000',date(2026,9,3));a.unapply('first',date(2026,9,20))
        self.assertEqual(a.residual('r',date(2026,9,30)),D('6000'))
        # Today's credit is free, but Sep 10 reuse would double-consume it until Sep 20.
        with self.assertRaises(ValueError):a.apply('bad','i','r','6000',date(2026,9,10))
    def test_reallocate_after_release_allowed(self):
        a=self.model();a.apply('first','i','r','6000',date(2026,9,3));a.unapply('first',date(2026,9,20))
        a.apply('next','i','r','6000',date(2026,9,21));self.assertEqual(a.residual('i',date(2026,9,22)),D('4000'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
