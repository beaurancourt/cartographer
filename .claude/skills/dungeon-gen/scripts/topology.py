#!/usr/bin/env python3
"""Generate a Bite-Sized-Dungeon-style topology graph.

Faithful Python port of bsd-dungeon-generator/index.html
(Marcia B's Bite-Sized Dungeons; mirror at root-devil.com). Wings of
6 rooms with one of 13 fixed connection patterns. Add wings until the
caller's minimum room count is satisfied. Wings stitch into the
existing dungeon via two random cross-wing edges.

Output is JSON on stdout.

Usage: topology.py <min-rooms> [seed]
"""
import json
import random
import sys

PASSAGES = [
    "long hall",
    "stuck/locked door",
    "secret door",
    "short hall or door",
    "short hall or door",
    "short hall or door",
]

# Each pattern is the adjacency for one wing as a list of (i, j) where
# i, j are positions 0..5 in that wing's *sorted* room-number list.
WING_PATTERNS = [
    [(0, 1), (1, 2), (1, 3), (2, 3), (3, 4), (4, 5)],
    [(0, 1), (1, 2), (0, 3), (1, 3), (3, 4), (3, 5)],
    [(0, 1), (1, 2), (1, 3), (1, 4), (1, 5), (4, 5)],
    [(0, 1), (1, 2), (2, 3), (1, 3), (3, 4), (2, 5)],
    [(0, 1), (0, 2), (1, 2), (1, 3), (3, 4), (4, 5)],
    [(0, 1), (1, 2), (2, 3), (2, 4), (2, 5), (4, 5)],
    [(0, 1), (1, 3), (3, 2), (2, 5), (3, 4), (4, 5)],
    [(0, 1), (1, 3), (1, 2), (3, 4), (4, 5), (2, 4)],
    [(0, 1), (0, 2), (1, 3), (2, 3), (2, 4), (2, 5)],
    [(0, 1), (1, 2), (2, 3), (1, 4), (1, 5), (3, 4)],
    [(0, 1), (1, 3), (0, 2), (2, 3), (2, 4), (4, 5)],
    [(0, 1), (1, 2), (2, 3), (3, 4), (1, 4), (4, 5)],
    [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 1)],
]


def generate_wing(offset: int, is_first: bool) -> tuple[list[dict], list[dict]]:
    nums = list(range(1 + offset, 7 + offset))
    # Random assignment: one monster, one monster+treasure, one interactive,
    # one treasure, two empties. Shuffle then slice.
    types = [
        "monster",
        "monster+treasure",
        "interactive",
        "treasure",
        "empty",
        "empty",
    ]
    shuffled = nums.copy()
    random.shuffle(shuffled)
    type_by = dict(zip(shuffled, types))

    # One of the "low-stakes" rooms (treasure, empty) becomes trapped.
    trap_candidates = [n for n, t in type_by.items() if t in ("treasure", "empty")]
    trapped = {random.choice(trap_candidates)}

    # First wing gets 1-2 entrance markers, attached to whatever rooms.
    entrances: set[int] = set()
    if is_first:
        k = random.randint(1, 2)
        entrances.update(random.sample(list(type_by.keys()), k))

    wing_idx = offset // 6 + 1
    rooms = [
        {
            "id": n,
            "type": type_by[n],
            "is_trapped": n in trapped,
            "is_entrance": n in entrances,
            "wing": wing_idx,
        }
        for n in sorted(type_by.keys())
    ]

    pattern = random.choice(WING_PATTERNS)
    sorted_nums = sorted(type_by.keys())
    edges = [
        {"a": sorted_nums[i], "b": sorted_nums[j], "passage": random.choice(PASSAGES)}
        for (i, j) in pattern
    ]

    return rooms, edges


def add_wing(
    existing_rooms: list[dict],
    existing_edges: list[dict],
    offset: int,
) -> tuple[list[dict], list[dict]]:
    new_rooms, new_edges = generate_wing(offset, is_first=False)
    # Two cross-wing edges anchored to two different rooms on each side.
    a_ids = random.sample([r["id"] for r in existing_rooms], 2)
    b_ids = random.sample([r["id"] for r in new_rooms], 2)
    for a, b in zip(a_ids, b_ids):
        new_edges.append({"a": a, "b": b, "passage": random.choice(PASSAGES)})
    return existing_rooms + new_rooms, existing_edges + new_edges


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: topology.py <min-rooms> [seed]", file=sys.stderr)
        sys.exit(1)
    min_rooms = int(sys.argv[1])
    if len(sys.argv) >= 3:
        random.seed(int(sys.argv[2]))

    rooms, edges = generate_wing(0, is_first=True)
    while len(rooms) < min_rooms:
        rooms, edges = add_wing(rooms, edges, len(rooms))

    print(json.dumps({"rooms": rooms, "edges": edges}, indent=2))


if __name__ == "__main__":
    main()
