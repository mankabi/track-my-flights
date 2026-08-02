# Migrating your flight history

`npm run import:json -- your-flights.json` loads a JSON file into an **empty** database (add `--force` to wipe and replace — a backup of the current table is dumped to `data/backups/` first).

The format is the same one the app's own *Settings → Export JSON* produces, so an export file imports back losslessly.

## File shape

Either a bare array of flight objects, or:

```json
{ "flights": [ { ...flight }, { ...flight } ] }
```

## Flight object

Only three fields are required:

| field | type | notes |
|---|---|---|
| `date` | `"YYYY-MM-DD"` | **required** — departure date (local) |
| `dep_iata` | 3-letter IATA | **required** |
| `arr_iata` | 3-letter IATA | **required** |

Everything else is optional (`null`/absent is fine):

| field | type | notes |
|---|---|---|
| `dep_time`, `arr_time` | `"HH:MM"` 24h | local times |
| `arr_day_offset` | integer | arrival date minus departure date in days (`1` = next day, `-1` possible across the date line). Default `0` |
| `dep_city`, `dep_country`, `dep_airport_name` | string | kept exactly as given; if all three are empty the app fills them from its airport reference DB when you later edit the flight |
| `arr_city`, `arr_country`, `arr_airport_name` | string | same |
| `distance_km` | integer | kept as-is — the app never recalculates values you imported |
| `duration_min` | integer | total minutes |
| `airline` | string | full name recommended (e.g. `"Korean Air"`) |
| `flight_no` | string | e.g. `"KE1201"` |
| `aircraft_type`, `aircraft_reg`, `aircraft_name` | string | |
| `seat` | string | e.g. `"34D"` |
| `seat_pos` | `"window" \| "aisle" \| "middle"` | |
| `travel_class` | `"economy" \| "economyplus" \| "business" \| "first"` | |
| `flight_role` | `"passenger" \| "crew" \| "cockpit"` | default `"passenger"` |
| `flight_reason` | `"personal" \| "business" \| "virtual"` | |
| `comment` | string | |
| `fm_no` | integer | *migration number*: 1..N in your old system's order. Set it if you want `npm run verify` to distinguish migrated rows from flights you add later |
| `updated_at` | ISO datetime | pass-through (used when re-importing an export/backup) |

`id` and `seq` in export files are ignored on import (regenerated).

## Minimal example

```json
{
  "flights": [
    { "date": "2019-06-01", "dep_iata": "JFK", "arr_iata": "LHR",
      "dep_time": "19:30", "arr_time": "07:25", "arr_day_offset": 1,
      "airline": "Example Air", "flight_no": "EX100",
      "distance_km": 5541, "duration_min": 415,
      "travel_class": "economy", "seat_pos": "window", "fm_no": 1 }
  ]
}
```

## Verifying the migration

The point of migrating is that **the numbers survive**. Before your old system disappears, screenshot its statistics page. Then:

1. `cp migration/anchors.example.json migration/anchors.json`
2. Fill in every number from your screenshots (total flights/distance/duration, records, top lists, distributions — the example file documents each field).
3. `npm run verify`

Every ✅ is an aggregate that matches your old system exactly. A ❌ tells you precisely which number drifted and by how much. Only rows with `fm_no` are checked, so verification keeps working forever, no matter how many flights you add in the app afterwards.

## Tips

- Distances/durations missing? Leave them out — when you open a flight in the edit form the app proposes great-circle distance and timezone-aware duration, which you can accept or override. (It never silently rewrites imported values.)
- Airline names: use one consistent spelling per airline — statistics group by exact name. Two-letter IATA codes in `airline` are auto-expanded to the reference name on later edits.
- Unusual `arr_day_offset` values (|offset| > 2) are imported as-is but flagged in the import output so you can fix typos in the app.
- `npm run import:json -- your-flights.json --dry-run` previews row count, date range, how many rows carry a migration number (`fm_no`), and any validation problems — without touching the database. Add `--dry-run` to a real import command to check it first.

## Importing from MyFlightRadar24 (FR24) CSV

If your flight history lives in MyFlightRadar24, export it as CSV (its settings page has a CSV export option) and load it directly — no need to hand-convert to the JSON format above:

```bash
npm run import:fr24 -- my-flights.csv            # only into an EMPTY flights table
npm run import:fr24 -- my-flights.csv --force     # wipe & replace (backs up first, same as import:json)
npm run import:fr24 -- my-flights.csv --dry-run   # preview only — no changes made
```

Unlike the JSON importer above, this one is **best-effort**: a row it can't place (an unknown airport, a malformed cell) is skipped and listed in a report, while the rest of the file still loads. A CSV from another service is expected to contain values outside what this app understands, and one bad row shouldn't block the other two hundred.

### Expected CSV header

Columns must appear in exactly this order:

```
Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id
```

`From`/`To` cells are expected in the `"City (IATA/ICAO)"` shape (e.g. `"Seoul (GMP/RKSS)"`) — only the IATA code is kept; the city text itself is discarded in favor of this app's own bundled airport reference data, so spellings stay consistent with the rest of your log. If an IATA code isn't in the reference data, that row is skipped and reported — add the airport to `data/reference/airports.csv` and re-run.

### Value mapping

FR24 encodes a few fields as numeric codes that don't map 1:1 onto this app's columns:

| FR24 column | FR24 value | Becomes |
|---|---|---|
| `Seat type` | `1` / `2` / `3` | `seat_pos` = `window` / `middle` / `aisle` |
| `Flight class` | `1` / `2` / `3` / `4` / `5` | `travel_class` = `economy` / `business` / `first` / `economyplus` / `private` |
| `Flight reason` | `1` (leisure) | `flight_reason` = `personal` |
| `Flight reason` | `2` (business) | `flight_reason` = `business` |
| `Flight reason` | `3` (crew) | `flight_role` = `crew` — not a reason. FR24 conflates "why did I fly" and "in what capacity" into one field; this app keeps those as separate columns, so `flight_reason` is left `null` |
| `Flight reason` | `4` (other) | dropped — `flight_reason` left `null`, counted in the completion summary as "other". There's no equivalent in this app's vocabulary, and it is never invented |

Any code outside the ones above becomes `null` — same policy as everywhere else in this importer: unmapped values are reported, never guessed at.

### Arrival-day inference

FR24's CSV has no arrival-date column, only a departure date and two local times. The importer works out how many days later the flight landed by testing offsets of 0 / +1 / +2 / -1 days and keeping whichever one makes the timezone-aware elapsed time match the CSV's own `Duration` column to within 5 minutes. If more than one offset matches — or none do, e.g. because a time is missing — it defaults to same-day (`arr_day_offset = 0`) and flags the row as "offset unresolved" in the completion report so you can check it by hand.

### Verifying the import

Same loop as JSON import: fill in `migration/anchors.json` from your MyFlightRadar24 statistics (or whatever numbers you have) and run `npm run verify`. FR24 rows never carry a migration number (`fm_no`) — there isn't one to carry — so if the database has zero `fm_no`-tagged rows, verify compares against **every** row instead of only migrated ones, and says so explicitly in its output ("comparing against ALL rows"). Run verify right after the import, before adding any flights of your own by hand, so the comparison is against exactly what got imported.
