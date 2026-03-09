# Autotile System — LinguaQuest

## How It Works

LinguaQuest uses a **4-quadrant autotile system** to render smooth, connected path and water edges. Each visible 48×48 tile is assembled from 4 quadrant pieces (24×24 each), chosen based on which neighbors are the same tile type.

## Spritesheet Format

- **File:** `Cute_Fantasy_Free/Tiles/Path_Tile.png` and `Water_Tile.png`
- **Size:** 48×96 px — 3 columns × 6 rows = **18 frames**, each 16×16 px
- **Frame numbering:** row-major (F0 = top-left, F2 = top-right, F6 = 4th row left, etc.)

```
F0  F1  F2     TL-outer   T-edge    TR-outer
F3  F4  F5     L-edge     fill      R-edge
F6  F7  F8     BL-outer   B-edge    BR-outer
F9  F10 F11    (inner corners row 1)
F12 F13 F14    (inner corners row 2)
F15 F16 F17    (extra fill variants)
```

## Critical Frame Assignments

Each frame is a **complete 16×16 quadrant piece** — do NOT crop it. Scale from 16px → 24px (factor 1.5) and place at the quadrant's (dx, dy) position.

### Outer corners — path pixel location tells you which quadrant it belongs to:
| Frame | Path pixels at | Use for quad |
|-------|---------------|--------------|
| F0    | bottom-right  | TL (dx=0,  dy=0)  |
| F2    | bottom-left   | TR (dx=24, dy=0)  |
| F6    | top-right     | BL (dx=0,  dy=24) |
| F8    | top-left      | BR (dx=24, dy=24) |

### Inner corners — grass pixel location tells you which quadrant:
| Frame | Grass pixels at | Use for quad |
|-------|----------------|--------------|
| F13   | top-left       | TL_in (dx=0,  dy=0)  |
| F12   | top-right      | TR_in (dx=24, dy=0)  |
| F10   | bottom-left    | BL_in (dx=0,  dy=24) |
| F9    | bottom-right   | BR_in (dx=24, dy=24) |

> ⚠️ **The inner corner frames are counterintuitive — F9 is BR_in, F13 is TL_in.** This trips up every time. The grass "bite" sits at the SAME corner as the quadrant position.

### Edges:
| Frame | Use for |
|-------|---------|
| F1    | T-edge (grass above, path below) |
| F7    | B-edge |
| F3    | L-edge |
| F5    | R-edge |
| F4    | fill (all neighbors are same type) |

## Quadrant Logic (per-quadrant, 4 times per tile)

```javascript
const same = (dc, dr) => {
  // Returns true if neighbor at (col+dc, row+dr) is same type, or out-of-bounds
};

// For each quadrant, check: N (cardinal 1), E (cardinal 2), D (diagonal between them)
if      (!N && !E)        → outer corner frame
else if (!N &&  E)        → edge frame (N direction open)
else if ( N && !E)        → edge frame (E direction open)
else if ( N &&  E && !D)  → inner corner frame  ← diagonal missing = concave corner
else                      → fill
```

### Quadrant neighbor directions:
| Quad | dx | dy | N checks | E checks | D checks |
|------|----|----|----------|----------|----------|
| TL   | 0  | 0  | (0,-1) above | (-1,0) left  | (-1,-1) NW |
| TR   | 24 | 0  | (0,-1) above | (+1,0) right | (+1,-1) NE |
| BL   | 0  | 24 | (0,+1) below | (-1,0) left  | (-1,+1) SW |
| BR   | 24 | 24 | (0,+1) below | (+1,0) right | (+1,+1) SE |

## Draw Call

```javascript
const SC = QS / 16;  // = 1.5 (16px source → 24px quadrant)
const rt = this.add.renderTexture(x, y, TS, TS).setOrigin(0,0).setDepth(depth);

const tmp = this.add.image(0, 0, texKey, frame).setOrigin(0,0).setScale(SC).setVisible(false);
rt.draw(tmp, q.dx, q.dy);  // NO crop offset — full frame at quadrant position
tmp.destroy();
```

## Common Mistakes

1. **Cropping the frame** — Don't. Each frame IS the quadrant piece. Just scale 16→24 and place it.
2. **Wrong SC value** — SC must be `QS/16` = `(TILE_SIZE/2)/16` = 1.5. Old wrong value was 3 (which scaled to 48px and then tried to crop).
3. **Inner corner frames swapped** — F9=BR_in, F13=TL_in. NOT the other way around. Check the grass pixel center to verify.
4. **Diagonal check inverted** — `!D` (diagonal NOT same type) triggers inner corner. If diagonal IS connected, use fill.
5. **Out-of-bounds neighbors** — treat as "same type" (true), so map edges get fill/edge frames, not outer corners.

## Project Notes

- **Language RPG = LinguaQuest** — all updates go to the `life-os` GitHub repo (`lukehegelund/life-os`)
- Live URL: https://lukehegelund.github.io/life-os/linguaquest.html
- Push via GitHub REST API PUT to `https://api.github.com/repos/lukehegelund/life-os/contents/linguaquest.html`
- Token in `HQ/API_KEYS/keys.md`
