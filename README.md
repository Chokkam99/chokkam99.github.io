# chokkam99.github.io

Source for Rithvik Chokkam's personal site: short write-ups of systems I've worked on, laid out as a small map of planets, with a page per skill.

The site is plain HTML, CSS and a little JavaScript, served by GitHub Pages from `docs/`. Every page works without JavaScript.

`tools/build.py` generates `docs/` using only the Python standard library. It reads a private content folder that is not part of this repository.

```
python3 tools/build.py --preview   # review build, written outside the repository
python3 tools/build.py --publish   # checked build, written to docs/
```

`docs/` is generated, so don't edit it by hand.
