"""Days, and what is left of them once somebody has already been charged for some.

Two dates cannot describe a period with a hole in it, and that is why the whole of billing
used to answer "already covered" for a quarter where a fortnight had been billed. These are
the rules the rest of the engine now rests on, so they are tested on their own, without a
database in the way.
"""

from frappe.utils import getdate

from nexgen_msp.utils import intervals

from .base import MSPTestCase


def pairs(stretches):
    return [(str(first), str(last)) for first, last in stretches]


class TestSayingTheSameDaysOnce(MSPTestCase):
    def test_overlapping_stretches_become_one(self):
        merged = intervals.merge([("2026-07-01", "2026-07-20"), ("2026-07-10", "2026-07-31")])

        self.assertEqual(pairs(merged), [("2026-07-01", "2026-07-31")])

    def test_stretches_that_touch_become_one(self):
        """The 31st and the 1st are a continuous month, not two."""
        merged = intervals.merge([("2026-07-01", "2026-07-31"), ("2026-08-01", "2026-08-31")])

        self.assertEqual(pairs(merged), [("2026-07-01", "2026-08-31")])

    def test_a_gap_of_one_day_keeps_them_apart(self):
        merged = intervals.merge([("2026-07-01", "2026-07-10"), ("2026-07-12", "2026-07-20")])

        self.assertEqual(len(merged), 2)

    def test_a_stretch_that_ends_before_it_starts_is_no_stretch(self):
        self.assertEqual(intervals.merge([("2026-07-10", "2026-07-01")]), [])
        self.assertEqual(intervals.span("2026-07-10", "2026-07-01"), [])


class TestWhatIsLeftToBill(MSPTestCase):
    def test_a_hole_in_the_middle_leaves_two_stretches(self):
        """The case the old engine could not say: a fortnight billed inside a quarter."""
        left = intervals.subtract(
            [("2026-07-01", "2026-09-30")], [("2026-08-01", "2026-08-15")]
        )

        self.assertEqual(
            pairs(left), [("2026-07-01", "2026-07-31"), ("2026-08-16", "2026-09-30")]
        )

    def test_covered_from_the_start_leaves_the_tail(self):
        left = intervals.subtract([("2026-07-01", "2026-09-30")], [("2026-07-01", "2026-07-24")])

        self.assertEqual(pairs(left), [("2026-07-25", "2026-09-30")])

    def test_covered_throughout_leaves_nothing(self):
        self.assertEqual(
            intervals.subtract([("2026-07-01", "2026-09-30")], [("2026-06-01", "2026-10-31")]), []
        )

    def test_what_was_never_due_is_not_given_back(self):
        """Taking away days outside the stretch changes nothing."""
        left = intervals.subtract([("2026-07-01", "2026-07-31")], [("2026-09-01", "2026-09-30")])

        self.assertEqual(pairs(left), [("2026-07-01", "2026-07-31")])

    def test_several_holes_are_all_cut_out(self):
        left = intervals.subtract(
            [("2026-07-01", "2026-07-31")],
            [("2026-07-05", "2026-07-06"), ("2026-07-20", "2026-07-25")],
        )

        self.assertEqual(
            pairs(left),
            [("2026-07-01", "2026-07-04"), ("2026-07-07", "2026-07-19"), ("2026-07-26", "2026-07-31")],
        )


class TestTheDaysTwoSetsShare(MSPTestCase):
    def test_only_the_days_both_hold(self):
        both = intervals.intersect(
            [("2026-07-01", "2026-09-30")], [("2026-09-25", "2026-10-15")]
        )

        self.assertEqual(pairs(both), [("2026-09-25", "2026-09-30")])

    def test_nothing_in_common_is_nothing(self):
        self.assertEqual(
            intervals.intersect([("2026-07-01", "2026-07-31")], [("2026-08-01", "2026-08-31")]), []
        )


class TestCountingThem(MSPTestCase):
    def test_both_ends_count(self):
        self.assertEqual(intervals.days([("2026-09-25", "2026-09-30")]), 6)
        self.assertEqual(intervals.days([("2026-07-01", "2026-07-01")]), 1)

    def test_the_same_day_twice_counts_once(self):
        self.assertEqual(
            intervals.days([("2026-07-01", "2026-07-10"), ("2026-07-05", "2026-07-10")]), 10
        )

    def test_a_quarter_is_its_days(self):
        self.assertEqual(intervals.days([("2026-07-01", "2026-09-30")]), 92)


class TestCarryingThemAround(MSPTestCase):
    def test_they_survive_the_trip_through_a_record(self):
        written = intervals.as_dicts([("2026-07-01", "2026-07-31")])

        self.assertEqual(written, [{"from": "2026-07-01", "to": "2026-07-31"}])
        self.assertEqual(intervals.from_dicts(written), [(getdate("2026-07-01"), getdate("2026-07-31"))])

    def test_nothing_read_back_is_nothing(self):
        self.assertEqual(intervals.from_dicts([]), [])
        self.assertEqual(intervals.from_dicts(None), [])
