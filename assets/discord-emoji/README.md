# Discord bot emojis

Uploaded as the bot's application emojis by `scripts/upload-discord-emojis.mjs`.

- `g_*.png` — grade letters (SS, silver SS, S, silver S, A, B, C, D) in the
  score card's style: Space Grotesk 800 with the card's gradients and glow.
  Our own artwork.
- `m_*.png` — mod badges: osu!lazer's mod glyphs from
  [ppy/osu-resources](https://github.com/ppy/osu-resources)
  (`assets/osu-resources/mods/`, © ppy Pty Ltd,
  [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)), recoloured
  dark on a hexagon in the mod type's colour (difficulty reduction #b2ff66,
  increase #ff6666, automation #66ccff, conversion #8c66ff, no mod #a3aec2).

All 128×128 PNG, filling the square (taller hexagon, letters fitted to
the box) so they read at Discord's inline emoji size; drawn on a canvas in
the browser from the site's own
fonts and assets. To change one, redraw it the same way and re-run the
upload script with `--force`.
