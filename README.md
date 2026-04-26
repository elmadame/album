# OGN Album · Exchange Redesign

This package includes a full front-end redesign and an exchange system that limits users to **3 exchanges per day**.

## Files

- `album.html` — user-facing album with booster and exchange center.
- `app.js` — app logic, collection loading, booster opening, exchange action, daily exchange status.
- `styles.css` — full visual redesign, gold booster style, exchange UI, admin styles.
- `admin.html` — admin control center with users, cards, booster logs, and exchange logs.
- `apps-script-exchange-patch.gs` — server-side patch for Apps Script.

## Required deployment steps

1. Replace your current `album.html`, `app.js`, `styles.css`, and `admin.html` with the files in this package.
2. Open your current Google Apps Script backend.
3. Add the code from `apps-script-exchange-patch.gs`.
4. Wire these actions into your existing dispatcher:
   - GET: `action=getExchangeStatus`
   - POST: `action=exchangeCard`
5. Map the adapter functions in the patch to your existing backend helper functions:
   - `getAlbumCards_()`
   - `getAlbumCollection_(email, name)`
   - `saveAlbumCollection_(email, name, collection)`
   - `getAlbumLogs_()`
   - `appendAlbumLog_(email, openedAt, cardsText)`
6. Redeploy the Apps Script Web App.
7. Test with one user who has at least one duplicate card.

## Important design decision

The exchange limit must be enforced in Apps Script, not only in the browser. The browser can display the limit, but only the backend can reliably prevent users from bypassing the 3-exchanges/day rule.

## No database schema change

The patch avoids adding database columns or sheets. It stores exchange activity in the existing logs table using this format:

```text
EXCHANGE|give=CARD_004|receive=CARD_077|mode=missing
```

The admin panel separates booster logs from exchange logs by detecting the `EXCHANGE|` prefix.

## Product rules included

- Users can only exchange duplicated cards.
- Unique cards are protected.
- Maximum 3 exchanges per user per day.
- Exchange receives a missing card.
- Same-rarity mode tries to give a missing card with the same rarity; if none exists, it falls back to any missing card.
- The visible collection still supports local extra booster codes from the previous implementation, but exchanges only use the server-validated collection.
