# GÖLGE MUHAFIZLARI — Pixel Art Bible (overrides the visual sections of SPEC.md)

The user switched the art direction: **cozy pixel art**, exactly like the reference screenshot they
sent (a small masked character standing in a rainy courtyard: mauve/rust brick wall, lavender
cobblestones, sage-green bushes with dark plum outlines, a cream vending box, a little potion
dispenser, thin vertical rain streaks, soft purple dusk light). Still a dark-fantasy adventure
(cursed Metin stones, monsters, bosses), but the mood is **cozy dusk**, never pitch black, never
neon. The main menu must be calm and uncluttered ("ana menü yormasın").

Gameplay, data, state, APIs and module ownership from SPEC.md stay the same. Only rendering and
styling change. Keep every public function signature in SPEC §4 (and the extra helpers that callers
already use: `heroLook, bake, bakeEnemy, blitEnemy, drawEnemyGlow, setBakeScale, soulColor, themeColor`).

---------------------------------------------------------------------------------------------------
## 1. Palette (use ONLY these colours for art; UI may add alpha)

`GM.PX.C` exposes them by name (see js/pix.js).

| name | hex | use |
|---|---|---|
| ink | #2A1F2D | outlines, deepest shadow |
| ink2 | #3B2C3E | dark fills, UI background |
| plum | #4A3A55 | shadow of purples, night sky |
| plum2 | #5E4B6B | |
| mauve | #7A6489 | mid purple |
| mauve2 | #9A86A8 | |
| lilac | #B9AFCB | light purple / stone highlight |
| lilac2 | #D8D0E2 | lightest purple |
| brick0 | #5A333B | brick shadow |
| brick1 | #7C464C | brick |
| brick2 | #A0625F | brick light |
| brick3 | #C08A80 | brick highlight / skin shadow |
| stone0 | #57536E | cobble shadow |
| stone1 | #6F6A86 | cobble |
| stone2 | #8F8AA6 | cobble light |
| stone3 | #B4AFC8 | cobble highlight |
| moss0 | #2F4A3A | leaf shadow |
| moss1 | #3F6B4A | leaf |
| moss2 | #5E8F5A | leaf light |
| moss3 | #86B06A | leaf highlight |
| moss4 | #B6D18A | fresh highlight |
| teal0 | #2E5559 | |
| teal1 | #3E6F73 | |
| teal2 | #5FA0A0 | |
| teal3 | #9CD3C8 | |
| cream | #F3EAD8 | highlights, mask, UI text |
| white | #FFFFFF | sparkle only |
| skin0 | #C98C78 | skin shadow |
| skin1 | #E8B79A | skin |
| skin2 | #F6D3BC | skin light |
| red0 | #8E2F3C | |
| red1 | #C4505A | |
| red2 | #E07A7A | |
| pink | #F2A5A0 | blush, flowers |
| gold0 | #9A6A2E | |
| gold1 | #C8963E | |
| gold2 | #E8C46A | |
| gold3 | #FFE9A0 | |
| ember0 | #A84A2E | |
| ember1 | #D8743E | |
| ember2 | #F2A65A | |
| blue0 | #2E3F66 | |
| blue1 | #3D5A8C | |
| blue2 | #5E86C2 | |
| blue3 | #9CC3E8 | |
| violet0 | #4E3380 | |
| violet1 | #7B4FB5 | |
| violet2 | #A77BE0 | |
| violet3 | #D2B6F5 | |
| bone0 | #9C9480 | |
| bone1 | #D6CCB2 | |
| bone2 | #EFE6CE | |

Rarity ramps (dark, mid, light) — `GM.PX.RAR[i]`:
Sıradan `stone1, stone2, stone3` · İyi `moss1, moss2, moss4` · Nadir `blue1, blue2, blue3` ·
Destansı `violet1, violet2, violet3` · Efsanevi `gold1, gold2, gold3` · Mitik `red0, red1, red2`.
The lobby UI uses the same ramp hexes for rarity frames.

---------------------------------------------------------------------------------------------------
## 2. Pixel rules
* Every sprite is authored on an integer grid (string grids or integer `fillRect`) — **never** anti-aliased
  shapes inside a sprite. Build sprites once, cache them as canvases (`GM.PX.sprite`, `GM.PX.fromFn`).
* 1 px outline in `ink` around the silhouette (`GM.PX.outline`), with selective lighter outline on the lit side allowed.
* Light comes from the top-left. Shading = 3 tones per material (shadow / base / highlight) + optional 1 px specular.
* Dithering only for soft gradients in large surfaces (sky, ground variation, light falloff) — use `GM.PX.dither`.
* Draw sprites with `GM.PX.blit(ctx, sprite, x, y, k, opts)`: it snaps to whole device pixels and turns
  image smoothing off, so sprites stay crisp on any canvas/transform. `k` = target CSS px per sprite px.
* Animations: few, readable frames. Hero: idle 4, walk 4 (contact/pass), attack 3–4 per weapon type,
  hurt 1, victory 2, cast 2. Enemies: 2–4 frames. Squash/stretch only by whole pixels.

## 3. Sizes (sprite px)
| thing | size |
|---|---|
| hero (incl. weapon + hat) | 24×32 canvas, feet on the bottom row, body ≈ 20 px tall, head ≈ 12×11 |
| normal enemies | 12–20 px |
| elites | 22–28 px |
| bosses | 48–64 px |
| metin stone | 20×36 |
| item icon | 16×16 (drawn centred inside the rarity frame) |
| skill icon | 16×16 |
| talent / attribute glyph | 12×12 |
| hero portrait | 24×24 bust |
| pickups | 5–9 px (chest 12×10) |
| ground tile | 64×64 seamless |

Characters: cute chibi like the reference: big head, simple dot or bead eyes (2×2 or 2×3 with a 1 px
highlight), tiny body, readable silhouette, small accessories (hat, hood, mask, scarf). Each hero has a
signature silhouette + colour (Bora: rust headband + brown spiky hair; Ela: teal hood + ponytail; Yaman: pale
hair + violet eyes + tattered dark scarf; Ayaz: icy fur hood + feathers; Alaz: gold/red with tiny horns).
All 12 gear slots stay visible on the 24×32 hero (1–3 px details are enough: helmet shape, mask over
face, neck charm pixel, shoulder bumps, chest colour block, bracer stripe, glove colour, belt line + buckle,
pants colour, knee pixel, boot colour). Set = shape/material motif, rarity = trim colour from the ramp;
Destansı+ adds a 1 px glint that twinkles, Efsanevi a soft aura (dithered), Mitik a few red pixel embers.

---------------------------------------------------------------------------------------------------
## 4. Rendering resolution
* **Battle**: render the world on a low-resolution canvas where one game pixel = `m` device pixels,
  `m = max(2, round(2.5 * devicePixelRatio))` (≈ 2.5 CSS px per game pixel), backing size =
  `floor(cssW*DPR/m) × floor(cssH*DPR/m)`, CSS `image-rendering: pixelated`, world units remain CSS px
  (transform `scale(DPR/m)`). Sprites therefore land 1:1 on game pixels. Damage numbers in the pixel font
  at game-pixel sizes (5–8 px tall). HUD stays DOM, styled with the pixel UI theme.
* **Lobby canvases** (hero showcase, icons, portraits): normal DPR canvases; `GM.PX.blit` snaps to integer
  device-pixel multiples so pixels stay sharp at any size. Prefer integer multiples ×4 … ×8 for the
  showcase hero.
* Lighting: cozy dusk. A gentle purple dusk tint + soft light pools (dithered edges) from lanterns,
  potions, crystals, fire, the hero. Rain: thin 1 px light streaks (lilac2/cream at low alpha) falling
  slightly diagonal, splashes on the ground as 2–3 px puffs. Fireflies in the forest. Never a near-black screen.

---------------------------------------------------------------------------------------------------
## 5. UI theme (lobby + battle HUD)
* Font: **"Pixelify Sans"** (Google Fonts, has Turkish glyphs) for everything; fallback `"Courier New", monospace`.
  Sizes in multiples that stay crisp (12, 14, 16, 20, 24, 32). No text-shadow blur; use 1–2 px hard shadows (`0 2px 0 #2A1F2D`).
* Panels: flat colour blocks with **pixel borders** (2 px ink outline + 2 px inner bevel: light top-left, dark bottom-right),
  no rounded corners (or 2-step "notched" corners), no soft glows, no gradients except stepped 2–3 band ones.
* Colours: background ink2/plum, panels plum2/mauve, text cream, secondary lilac, accents gold2 (primary buttons),
  moss3 (positive), red1 (negative). Rarity frames use the rarity ramps.
* Buttons: chunky pixel buttons (2 px outline, 3 px bottom "lip", press = move down 2 px).
* Icons: pixel sprites (no emoji, no vector glyphs).
* **Calm main menu**: one cozy pixel scene (the hero idling in a rainy courtyard: brick wall, ivy, bushes,
  a lantern, a potion vending box, cobblestones — inspired by the reference), a slim top row (energy, gold,
  gems, settings), the chapter name with small ‹ › arrows, ONE big "BAŞLA" button with the energy cost,
  and the bottom nav. Everything else (quests, mail, shop, map, events) goes into ONE small menu button.
  No floating badges except a single dot where something is truly new. Minimal motion: rain, lantern
  flicker, hero idle.
