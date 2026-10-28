# Richard Garfield, Ph.D.

Card images for the commander deck, sorted by role and mana value, for
reference on a phone mid-game. A static site: no build step, and the files
that are served are the files you edit.

Run it:
```
% python3 -m http.server 8000
```

Visit the site:
```
localhost:8000
```

Update the cards after editing the spreadsheet:
```
% # export the sheet as CSV over notes/Commander Decks - Richard Garfield.csv
% node tools/build-cards.mjs
```

The script looks every name up on Scryfall, picks each card's first printing,
downloads its image into `assets/cards/`, and rewrites `assets/data/cards.json`.
It needs `cwebp` (`brew install webp`).

- Mana value headers come from Scryfall, not from the sheet's columns.
- Typos are fixed by fuzzy matching; the script prints each correction and
  every name it could not find.
- Chosen printings are saved in `tools/printings.json`, so reruns only ask
  Scryfall about new cards. To use a different printing, replace that card's
  entry with `{ "set": "lea", "number": "232" }` (both are in the printing's
  Scryfall URL) and rerun. Delete the entry to pick the first printing again.

Deploy:
```
% git push        # Cloudflare builds connected to this repository deploy main
```

Add the remote:
```
git remote add origin git@github_1:nickmeccia/richard-garfield.git
```
