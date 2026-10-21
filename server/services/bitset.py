"""
bitset.py

Sets of small non-negative integers (item_ids), stored as ONE Python int.

The trick: a set {3, 5, 6} becomes the number whose binary digits have a 1 at
positions 3, 5 and 6:

        position:  7 6 5 4 3 2 1 0
        bits:      0 1 1 0 1 0 0 0    = 0b01101000 = 104

Python ints can be any size, so this works for any item_id. The payoff is that
set operations become single arithmetic operations done 64 bits at a time by
the CPU, instead of one hash lookup per element:

        union         a | b        (in either)
        intersection  a & b        (in both)
        difference    a & ~b       (in a but not b)
        membership    (a >> i) & 1

A mask is immutable like any int, so "adding" an item returns a NEW mask. Nothing
here mutates anything, which keeps callers functional.

Python has no C-style #define, so the "macros" below are one-line named
functions. Each one is a bit trick with a name, so the code that uses them reads
like set code and the trick lives in exactly one place.

Item ids are used directly as bit positions, so the mask is as many bits long as
the largest id. That's fine for ids in the thousands or millions; it would waste
memory for sparse ids like 10**12.
"""

from functools import reduce
from operator import and_, or_
from typing import Iterable, Iterator

import numpy as np

# The empty set: no bits set.
EMPTY = 0


# --- "Macros": one bit trick each ---

def bit(i: int) -> int:
    """The set {i}: a 1 shifted left i places."""
    return 1 << i


def has_bit(mask: int, i: int) -> bool:
    """Is i in the set? Shift bit i down to position 0 and look at it."""
    return (mask >> i) & 1 == 1


def lowest_bit(mask: int) -> int:
    """
    The set containing only the smallest member of `mask` (0 if empty).

    In two's complement, -mask flips every bit above the lowest 1 and keeps the
    lowest 1 itself, so `mask & -mask` leaves exactly that one bit:

        mask    = 0b01101000
        -mask   = 0b10011000
        & gives = 0b00001000
    """
    return mask & -mask


def position_of(single_bit: int) -> int:
    """Which i a one-member set {i} holds: bit_length() is i + 1."""
    return single_bit.bit_length() - 1


def without_lowest_bit(mask: int) -> int:
    """`mask` minus its smallest member. XOR with the lowest bit switches it off."""
    return mask ^ lowest_bit(mask)


# --- Building and reading masks ---

def from_ids(ids: Iterable[int]) -> int:
    """The set of all given ids."""
    return reduce(or_, map(bit, ids), EMPTY)


def with_bit(mask: int, i: int) -> int:
    """`mask` plus i (a new mask)."""
    return mask | bit(i)


def without_bit(mask: int, i: int) -> int:
    """`mask` minus i (a new mask). Removing a non-member changes nothing."""
    return mask & ~bit(i)


def union(masks: Iterable[int]) -> int:
    """Members of at least one mask. The union of no masks is empty."""
    return reduce(or_, masks, EMPTY)


def intersection(masks: Iterable[int]) -> int:
    """
    Members of every mask. Needs at least one mask, because the intersection of
    nothing would be "every possible id", which a mask can't hold.
    """
    return reduce(and_, masks)


def iter_ids(mask: int) -> Iterator[int]:
    """
    Every member of the set, smallest first. Peels off the lowest member one at a
    time, so it is the clearest way to read a mask, and fine for a handful of members.

    Each step rebuilds the whole int, so the total cost is members x width. For
    thousands of members use to_set() instead, which is ~40x faster there.
    """
    while mask:
        yield position_of(lowest_bit(mask))
        mask = without_lowest_bit(mask)


def to_set(mask: int) -> set[int]:
    """
    The members as an ordinary Python set, in one pass over the mask's bytes
    instead of one step per member (see iter_ids): the int is written out as bytes,
    numpy unpacks them to one 0/1 per position, and the positions holding a 1 are
    the members.
    """
    # to_bytes needs the length up front: 8 bits per byte, rounded up.
    raw = mask.to_bytes((mask.bit_length() + 7) // 8, "little")

    # bitorder="little" makes bit 0 of byte 0 position 0, matching bit() above.
    flags = np.unpackbits(np.frombuffer(raw, dtype=np.uint8), bitorder="little")
    return set(np.flatnonzero(flags).tolist())


def count(mask: int) -> int:
    """How many members (the "popcount": number of 1 bits)."""
    return bin(mask).count("1")
