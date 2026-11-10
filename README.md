# Merge the Photos

A 3×3 photo-merging game. Drag a photo onto a matching one to merge it into the next level:

**pout → frown → lying on bed → blue t-shirt → monkey → red saree → couple → selfie (final)**

## Rules
- The board starts full of level-1 photos.
- Drag one photo one cell (swipe on mobile, drag with the mouse, or tap a photo then tap a neighbour / press an arrow key).
  - onto an empty cell: it slides there
  - onto the same photo: they merge into the next level
  - onto a different photo: it bounces back
- When no matching pair is left on the board, every empty cell refills with fresh level-1 photos.
- Merge up to the couple photo (second last). The game hands out exactly 64 level-1 photos in total (2^6), so 64 photos merge down to one couple photo with nothing left over (63 merges). That photo then morphs into the final selfie, alone on the board.

## Host on GitHub Pages
1. Create a new GitHub repo and upload everything in this folder (keep `index.html` at the top level).
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`.
3. Your game goes live at `https://<your-username>.github.io/<repo-name>/`.

## Tests
`tests/run.js` drives the game with real mouse and touch input (Playwright + Chromium):

    npm i -D playwright && npx playwright install chromium
    node tests/run.js
