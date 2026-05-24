---
name: dungeon-gen
description: Generate an OSR-style dungeon map for cartographer from a brief — original architectural use (tomb, fortress, prison, cave, …), current inhabitants / purpose (bandit hideout, cult lair, abandoned, …), and minimum room count. Builds the topology with a Bite-Sized-Dungeon-style generator, lays it out spatially as a cartographer YAML, renders via the CLI, and iterates visually until the rendered map matches the spec and reads as a believable site for the original × current combo.
argument-hint: "<original use> / <current use> / <min rooms>"
allowed-tools: Bash Read Write Edit
---

# Generate a cartographer dungeon map

User's brief: `$ARGUMENTS`

## Step 0 — Parse the brief

Pull three pieces from the brief: **original use**, **current use**, and
**min rooms**. If any is missing or ambiguous, use `AskUserQuestion` before
going further — do not guess.

Valid briefs:
- `ancient tomb / bandit hideout / 18`
- `dwarven mining fortress / now a kobold warren / 24`
- `coastal smuggler caves / cult of the deep / 12`

## Step 1 — Generate the topology

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/topology.py <min-rooms> > /tmp/topology.json
```

Output is JSON: `rooms[]` (each `{id, type, is_trapped, is_entrance, wing}`
where `type` is one of `monster | monster+treasure | interactive | treasure |
empty`) and `edges[]` (each `{a, b, passage}` where `passage` is one of
`long hall | stuck/locked door | secret door | short hall or door`).

Read the JSON — you'll use the room list, types, and edge graph as the
spine of the map.

## Step 2 — Decorate by original × current use

For each room, pick a concrete fixture / contents matching its BSD type and
the original × current combo. Examples:

- **Original=tomb, type=monster** → "sarcophagus chamber, awakened guardian"
- **Original=tomb, type=interactive** → "burial register on a stone lectern"
- **Current=bandit hideout, type=monster+treasure** → "lookout post over the stash"
- **Current=cult lair, type=interactive** → "ritual circle / altar"
- **Original=prison, type=empty** → "abandoned cell block, doors rusted"

Mix decay between the two eras. A prison's guard station might now be the
bandits' common room with its racks repurposed for stew pots. The
combination is the whole point — don't just pick one era.

## Step 3 — Lay out spatially as cartographer YAML

Convert the topology to a cartographer YAML map. Reference
`examples/small-tomb.yaml` for the exact shape; the schema:

```yaml
version: 1
grid: { cell_size: 50, ft_per_cell: 5 }
layers:
  - id: terrain
    audience: shared
    carves:                            # rooms + corridors
      - { id: r1, rect: [x, y, w, h] }
      - { id: c1, path: [[x1,y1],[x2,y1]], width: 1 }
  - id: object
    audience: shared
    doors:                             # anchor-based segment along wall
      - { id: d1, segment: [[x1,y1],[x2,y2]] }
      - { id: d2, segment: [[x1,y1],[x2,y2]], kind: locked-door }
    stairs:                            # 3 anchors: 0-1 = top of "up", 2 = bottom
      - { id: s1, anchors: [[x,y],[x,y],[x,y]] }
    objects:
      - { id: a1, type: altar, at: [x, y], facing: n }
  - id: player
    audience: player
    doors:                             # secret doors go here (player sees as normal)
      - { id: d3, segment: [...], kind: secret-door }
  - id: gm
    audience: gm
    objects:
      - { id: t1, type: pit-trap, at: [x, y], facing: n }
    notes:
      - { id: n1, at: [x, y], text: "guard post" }
```

Layout guidelines:

- **One rect per room**, sizes mostly 3×3 to 7×7. Reserve 8×10+ for one or
  two "anchor" rooms — entrance hall, throne, central chamber.
- **Place rooms on a coarse grid** so corridors stay mostly straight. A
  reasonable approach: place entrance(s) along the left edge, then BFS the
  edge graph placing each unplaced neighbor adjacent to (or one corridor
  away from) its placed parent. Skip occupied space.
- **Corridors are `path` carves with `width: 1`** for normal halls,
  `width: 2` for `long hall` passages. Axis-aligned segments only.
- **Doors** sit as anchor segments at the boundary between a corridor and a
  room (or between two adjacent rooms). Map passage → door kind:
  `short hall or door` → no door OR plain `door` (mix it up);
  `stuck/locked door` → `kind: locked-door`;
  `secret door` → `kind: secret-door` on the **player** layer (so it shows as a
  normal door in player view and as "S" in GM view).
  Doors must lie ON a real carve boundary or you'll get floating doors.
- **Stairs** only if the brief implies multi-level (mine, tower, dungeon
  with a sublevel). Three anchors: first two form the "up" edge, third is
  the bottom of the descent.
- **Objects per BSD type** (place 1-2 per room, more for monster+treasure):
  - `monster` → `fireplace`, `rubble`, sometimes `column`
  - `monster+treasure` → `altar` or `throne`, plus `rubble`
  - `interactive` → `altar`, `fountain`, `throne`, `statue`
  - `treasure` → `column` or `altar`
  - `empty` → optionally `rubble` or nothing
  - `is_trapped` → add `pit-trap` on the **gm** layer
- **Notes** on the gm layer, max ~12 chars to fit one cell (e.g.
  `"guard post"`, `"sarcophagus"`, `"pit"`). The audience filter hides them
  in player exports automatically.
- **Entrances** can be marked with a path carve that runs off the room into
  empty space (a few cells), suggesting "this opens to the outside".

## Step 4 — Render

Save the YAML to `/tmp/dungeon.yaml`, then:

```bash
cargo run -p cartographer-cli -- render /tmp/dungeon.yaml -o /tmp/dungeon.png --view gm
```

(Add `--view player` separately to also check the player-facing version.)
First build on a fresh branch may take ~2 min; subsequent renders are <1s.

## Step 5 — Inspect and iterate

Read the rendered PNG. Check for:

- **Missing rooms** — every room in `topology.json` must be in the YAML.
- **Missing or wrong connections** — every edge should be a corridor, a
  shared wall with a door, or an explicit door between adjacent rooms.
- **Overlapping rects** — adjust positions; rooms shouldn't share interior
  space unless intentional.
- **Floating doors** — door segment endpoints must lie on actual wall
  geometry. Move the door or the carve.
- **Stranded corridors** — paths that go nowhere or don't reach the room
  they're supposed to connect.
- **Lopsided composition** — everything bunched in one quadrant; spread it.
- **Door kind matches passage type** — locked passages → locked doors,
  secret passages → secret doors on the player layer, etc.

Make focused edits to the YAML, re-render, and repeat. Cap yourself at ~5
iterations — if it's not converging, step back and reconsider the layout
strategy (different starting room, different BFS order, room size budget).

For each iteration, briefly say what's wrong and what you're changing — no
walls of text, just enough that the user can follow.

## Step 6 — Hand off

Save the final YAML to `examples/<descriptive-kebab-name>.yaml` (e.g.
`examples/tomb-bandit-hideout.yaml`). Render both GM and Player exports
alongside:

```bash
cargo run -p cartographer-cli -- render examples/<name>.yaml -o examples/<name>-gm.png --view gm
cargo run -p cartographer-cli -- render examples/<name>.yaml -o examples/<name>-player.png --view player
```

Report to the user: room count, wing count, a few notable rooms with their
flavor (e.g. "r4: ritual circle, r7: looted reliquary now sleeping
quarters"), and the file paths.
