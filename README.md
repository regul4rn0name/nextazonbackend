# Nextazon API
# Vibe Coded AF (will refactor later)

Configure `MONGO_URI` in `.env`. Optional: `MONGO_DB` (default `nextazon`) and
`PORT` (default `3002`). `pnpm start` connects before listening, creates a TTL
index for sessions, and unique indexes for account emails and usernames. `pnpm seed` inserts 60 example listings with
deterministic IDs; existing records are never deleted or overwritten.

## API

- `GET /listings`: `{ items, total, page, pageSize, categoryCounts }`.
- Filters: `q`, `category`, `online=true`, `minPrice`, `maxPrice`, `seller`.
- Sort: `newest` (default), `priceAsc`, `priceDesc`, or `name`.
- Pagination: `page` starts at 1; `limit` defaults to 20 and is limited to 100.
- Scope: `scope=wishlist` or `scope=mine`, using the bearer session. Unauthenticated
  scoped reads return 401. Category facets omit only the category filter.
- `GET /listings/:id`: detail with `saved` and `canManage` flags.
- `GET /catalog`: allowed catalog entries for creating listings.
- `POST /auth/register`: `{ username, email, password }`; creates an account.
- `POST /auth/login`: `{ email, password }`; returns a new 30-day account session.
- `GET /auth/me`: authenticated account profile.
- `POST /auth/logout`: revoke the current session.
- Passwords use salted scrypt hashes. Only SHA-256 session-token hashes are stored.
  Next.js stores the raw token in an HttpOnly cookie, not in browser JavaScript.
- Legacy guest sessions cannot use protected features. On registration/login,
  their wishlist and owned listings are transferred to the account.
- `POST /listings`: authenticated `{ itemId, price, seller, description?, online? }`.
  The owner and item attributes are determined server-side.
- `DELETE /listings/:id`: owner-only removal.
- `PUT /wishlist/:id` and `DELETE /wishlist/:id`: idempotent private save/remove.

All filters and writes are validated. Search escapes regex metacharacters.
Queries apply filtering before pagination with a stable ID tiebreaker. Invalid
input returns 400, missing sessions 401, absent/unowned listings 404, and
unavailable database operations 503. Error responses never expose connection
strings. No browser CORS access is necessary: Next.js proxies mutations.

`pnpm test` runs parsing/error tests plus a MongoDB integration test when
`MONGO_URI` is set. That test creates and drops only its unique `nextazon_test_*`
database. It checks filter combinations, facets, sorting/pagination, session
isolation, creation, validation, and authorization. It never clears app data.

Registration and login use a basic per-process rate limit. Email verification,
password recovery and completed-trade workflows are not built. A multi-instance
deployment should use a shared rate limiter. Tests cover account validation,
login/logout, private scopes, legacy migration, and ownership enforcement.

### Full catalog and offers
Run `pnpm import:catalog` to upsert the animal-crossing 8.2.0 item catalog into MongoDB and map matching existing listings to their catalog artwork and translations. Re-running preserves listing ownership and offer details. Includes item variants, villagers, recipes, and creatures. Three non-collectible Hazure music entries have no source artwork and use the placeholder.

`GET /catalog?q=...&page=1&limit=24` returns paginated catalog entries. Catalog and listing search match translated names provided by the package, ignoring case and accents. This does not translate arbitrary languages absent from the source.

Authenticated `POST /listings` accepts `itemId` plus either `offerType: "price"`, integer `price`, and `currency` (`Bells` or `Nook Miles Tickets`), or `offerType: "trade"` and `tradeItemId`. Seller always comes from the account username. Listing filters accept `currency=Bells`, `currency=Nook Miles Tickets`, or `currency=trade`. Price sorts group by currency; numeric bounds exclude item exchanges. The catalog includes creatures and other entries that cannot necessarily be handed to another player in-game.

### Live chat and presence
The API exposes `/realtime` WebSockets. The Next.js `/api/realtime-ticket` endpoint exchanges the HttpOnly account session for a single-use ticket (30-second expiry); the session token never enters browser JavaScript. Chat operations verify session validity and conversation membership. Messages and read state persist in MongoDB. The header shows unread totals and in-app notifications link to conversations. Browser push notifications while the website is closed are not implemented.

Presence counts authenticated sockets, supports multiple tabs, and uses 15-second heartbeat checks. The online listing filter uses current connections, ignoring legacy listing `online` values. Seed sellers without accounts cannot be messaged.

Local frontend connects to `ws://127.0.0.1:3002/realtime`. For hosting, configure `NEXT_PUBLIC_WS_URL` with the public `wss://` endpoint and enable WebSocket upgrades in the reverse proxy. Presence, tickets, and broadcasts currently use one API process; multiple replicas require a shared broker. Chat integration tests use their own `nextazon_chat_test_*` database.

### Offers and airport codes
Listing Buy / Make offer prompts send a structured offer into the buyer/seller conversation. Buy uses the listing's stored terms. Participants can accept, decline, or counter with Bells, Nook Miles Tickets, or a catalog item. Only the current recipient can respond; version checks prevent stale or simultaneous responses. Requests are idempotent per client request ID.

After acceptance the seller enters the Dodo Code from the game. A persistent banner above chat shows it to both participants. Codes do not expire or disappear automatically. After 120 seconds the buyer may click Ask for a new code, which notifies the seller once; sharing an updated code resets that timer. Codes never appear in message notification previews. Acceptance arranges an in-game trade; it does not process a payment or automatically delete the listing.
