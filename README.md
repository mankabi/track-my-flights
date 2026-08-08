# Track My Flights

**English** · [한국어](docs/README_ko.md)

I used a web-based solution to track my flight logs, which is hosted by someone who is running it voluntarily.<br>
It worked well, but I always had some concerns that it might be discontinued all of a sudden.<br>
So I made it on my own. I let Claude Code build it from my sketch and rough ideas.<br>
You control all your flight logs with this code. **NO ACCOUNT, NO CLOUD, NO TRACKING**; the app runs fully OFFLINE.

![Dashboard — totals and a world map of every route flown](docs/images/dashboard.png)

A **local, self-hosted flight logbook**. Log every flight you take, browse them on a world map, and get the full stats treatment — total distance in laps around Earth, top routes, longest/fastest legs, class and seat breakdowns. Your data lives in a single SQLite file on your machine.

## Features

- **Log flights fast** — airport/airline autocomplete (searchable by code, city, or name), flight-number → airline auto-fill, automatic great-circle distance and timezone/DST-aware duration.
- **Dashboard & world map** — route arcs on an offline vector map with zoom/pan, upcoming flights, recent flights.
- **Statistics** — totals, records, top-10 routes/airports/airlines/aircraft, per-year table, class/seat/role distributions.
- **Your data, portable** — one-click JSON/CSV export, JSON import, MyFlightRadar24 CSV import, and the DB is just a file you can copy.
- **English & Korean UI**, km/mi and 12/24-hour display preferences (browser-locale defaults). Adding a language is one JSON file.

### A look around

**Flights** — searchable, filterable by year, with the day-offset marks that long-haul logging actually needs.

![Flight list](docs/images/flights.png)

**Statistics** — totals, records, and top-10 breakdowns, per year or all-time.

![Statistics](docs/images/stats.png)

**Add flight** — type two airport codes and a flight number; distance, duration and the airline fill themselves in.

![Add flight form](docs/images/add-flight.png)

*(Screenshots use sample data.)*

## Requirements

- **Node.js 20+ and npm** — install from [nodejs.org](https://nodejs.org/) (Windows/macOS installers, or your Linux package manager).
- **A C++ build toolchain, needed only as a fallback.** `better-sqlite3` (the SQLite driver) ships prebuilt binaries for most platforms/Node versions, so `npm install` usually needs nothing else — you do **not** install SQLite itself separately, better-sqlite3 bundles it. If your exact platform + Node version has no matching prebuilt, npm compiles it from source instead, which needs a compiler:
  - **Windows**: easiest is [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (under "Tools for Visual Studio") — during setup, check **"Desktop development with C++"**. With [Chocolatey](https://chocolatey.org/) installed, one line does it instead: `choco install python visualstudio2022-workload-vctools -y`.
  - **macOS**: `xcode-select --install`.
  - **Linux**: a C/C++ toolchain, e.g. `sudo apt install build-essential` on Debian/Ubuntu — usually already present.

## Quick start

```bash
npm install
npm run seed     # load the bundled airport + airline reference data into SQLite
npm run build
npm start        # → http://localhost:7470
```

For development: `npm run dev` (Vite on :5173, API proxied to :7470).

The server binds to `127.0.0.1` only. Port: `MFM_PORT=8080 npm start`. DB path: `MFM_DB_PATH=/path/flights.db`.

## Bringing your existing flight log

If you have flight history in another system, export it, shape it into the JSON format described in [docs/MIGRATION.md](docs/MIGRATION.md), and load it:

```bash
npm run import:json -- my-flights.json
```

Optionally, record the statistics your old system showed (total distance, top routes, …) into `migration/anchors.json` (start from `migration/anchors.example.json`) and run `npm run verify` — it cross-checks the imported database against those numbers so you *know* nothing was lost in translation. That verification loop is the heart of this project: the numbers must survive the move.

Coming from **MyFlightRadar24**? Export your flights as CSV from its settings page and load the file directly — airports/airlines are resolved against the bundled reference data, great-circle distance is computed, and the arrival day is inferred from the reported flight duration:

```bash
npm run import:fr24 -- my-flights.csv
```

Rows the importer can't place (an airport missing from the reference data, an unparseable cell) are skipped and listed in a report rather than guessed at; see [docs/MIGRATION.md](docs/MIGRATION.md) for the full column/value mapping. Honest scoping note: this importer has been tested against hand-built synthetic CSV files shaped like FR24's documented export format, not a real downloaded export — please open an issue if your file doesn't load cleanly.

## Backup & restore

The entire log is `data/flights.db`, `data/flights.db-wal`, `data/flights.db-shm`. Copy those file anywhere to backup. Restoring = putting the file back.

## Keeping it running (macOS example)

`examples/launchd.plist.example` is a LaunchAgent template (auto-start on boot, restart on crash). Fill in the placeholder paths, then:

```bash
cp examples/launchd.plist.example ~/Library/LaunchAgents/com.yourname.trackmyflights.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yourname.trackmyflights.plist
```

On Linux, a systemd user unit running `npm start` works the same way.

## Reference data

Airports come from [OurAirports](https://ourairports.com/data/) and airlines from [OpenFlights](https://openflights.org/data.html), snapshotted in `data/reference/`. To refresh them, replace those files and re-run `npm run seed` (your own airline-name spellings in logged flights take precedence over the reference names). See [NOTICE.md](NOTICE.md) for data licenses.

## Development

```bash
npm test            # unit tests (distance, duration/DST, flight-number normalization)
npm run i18n:check  # fails if any UI string bypasses the i18n catalogs
npx tsc --noEmit
```

UI strings live in `web/src/i18n/{ko,en}.json` (flat keys; the two files are key-checked against each other at compile time). To add a language: copy `en.json` to your locale, translate, register it in `web/src/i18n/index.tsx`.

Honest scoping note: the import/verify pipeline has been battle-tested against exactly one person's 108-flight history. Edge cases from other data shapes are expected — issues and PRs welcome.

## License

[MIT](LICENSE). Reference data and bundled font have their own licenses — see [NOTICE.md](NOTICE.md).
