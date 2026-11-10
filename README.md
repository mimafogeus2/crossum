# CrosSum

A crossword where the numbers are given and you fill in the math. Every row and column must be a true equation, and operators where lines cross have to work both ways.

**Play:** https://mimafogeus2.github.io/crossum/

- Easy, Medium and Hard packs of 1,000 levels each, generated from seeds, ramping from `+ −` up to `× ÷ ^ . %` and `< >`
- Three daily puzzles (easy, medium, hard), the same for everyone, with streaks and sharing
- Synthesized sound, light/dark themes, touch and keyboard

## Run locally

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

Generator check (all 3,000 levels): `node test.js`
