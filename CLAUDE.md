# osu! 歌曲收藏 — working notes for Claude

## Layout and UI

- **Everything important must be visible without scrolling to the bottom.**
  Design each page, panel and dialog so its key information fits one screen
  on a computer (about 1920×1080). Prefer two columns, compact rows,
  side-by-side comparisons and tabs over long vertical stacks. When a list
  is long (leaderboards, score history), show it compactly (several columns,
  one-line rows, pagination or a list that scrolls inside its own box)
  instead of making the whole page longer. Check this before showing a design.
- Check every language (8 locales in `js/i18n/`): German, Spanish, French and
  Russian labels run much wider than Chinese. No text may overflow or be cut.
- Phones get one column; check about 390px wide too.
- Images: use covers in the shape they are shown at, at 2x resolution
  (`card@2x`, `slimcover@2x`, `cover@2x`), never a small cover stretched.

## Working with the user

- The user decides visually: show a working sample (screenshot or a live
  localhost tab) before asking whether to ship. For bigger layout changes,
  offer two or three options with previews.
- Reply in Traditional Chinese.
- Ask before every merge / push / deploy, including follow-up fixes.
  Work on a feature branch, fast-forward `main`. Deploy is
  `npm run build` then `npx --yes wrangler@4.162.0 deploy`; pushing does not
  deploy.

## Assets and licences

- Do not reuse osu-web artwork (AGPL; this repo is public with no licence).
- ppy/osu-resources (CC BY-NC 4.0) is fine with credit; the site stays
  non-commercial. Credit lives on the 資源 page and in
  `assets/osu-resources/README.md`.
