# CART 484 — local weather station

## Raspberry Pi
Install dependencies in your Python environment: `python3 -m pip install -r requirements.txt`.
Run `python3 webapp.py` and open `http://meteo.local/` (if that hostname is configured) or the Pi's IP address.
Default port remains 80. If unavailable, run `python3 webapp.py --port 5000` and open port 5000.
The real sensor module is loaded explicitly from `~/bme680/sensor.py`. An adjacent test sensor.py cannot override it.
If needed, pass `--sensor-path /absolute/path/to/sensor.py`.
Jimmy's sensor module must expose `get_stats()` and `air_quality_label(gas)`.
Expected units: temperature °C, humidity %, pressure hPa, gas resistance ohms.
Confirm these units before hardware deployment. The page converts pressure to kPa.

## Tianshun's Windows-only test
`python -m pip install -r requirements.txt`
`python webapp.py --demo --port 5000`
Open http://127.0.0.1:5000/ . The included ignored sensor.py returns fixed mock readings.
Demo records use data/weather-demo.db; device readings use data/weather.db.
The demo does not invent past measurements. Waiting periods apply to both modes.
Do not deploy the local mock sensor over the real hardware sensor.

## Collection and retention
One background collector records every five minutes even with the browser closed.
Keep exactly one instance of webapp.py running. Start it on boot with your existing device service if needed.
Closing the Python process or powering off stops recording; missed samples are not fabricated.
SQLite keeps the last 365 days. Older records are deleted during collection/read access and deleted space is reused.
A unique five-minute bucket prevents duplicate rows. A page refresh reads saved data; it does not force sensor access.
The browser checks the saved data every minute. This never contacts Open-Meteo.
No database or mock sensor is committed to Git. If already tracked, run `git rm --cached sensor.py` first.

## Forecast limits
12/24-hour temperature and pressure estimates start after about three hours of regular readings.
Three-day temperature ranges start after three completed local days with at least 200 samples and 20 covered hours each.
The recent trend is damped; daily temperature patterns are learned from up to 14 recent days.
The database still retains a year for future analysis. No claim of a trained annual model is made.
No cloud, rain probability or rainfall amounts are inferred. The rainfall card is explicitly unavailable.
The brief summary remains short and describes estimated temperature/pressure changes.
Stale or gappy recent records stop forecasts. These are experimental estimates, not validated weather predictions.

## Frontend
Both index.html and templates/index.html now use static/css/style.css and static/js/main.js.
Open through Python for local API access, not VS Code Live Server.
Root script.js and style.css are small compatibility wrappers, not independent copies.
