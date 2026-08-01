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
