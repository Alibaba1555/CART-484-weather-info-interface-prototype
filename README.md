# CART 484 — local weather station

## Raspberry Pi
Install dependencies in your Python environment: `python3 -m pip install -r requirements.txt`.
Run `python3 webapp.py` and open `http://meteo.local/` (if that hostname is configured) or the Pi's IP address.
Default port remains 80. If unavailable, run `python3 webapp.py --port 5000` and open port 5000.
The real sensor module is loaded explicitly from `~/bme680/sensor.py`. An adjacent test sensor.py cannot override it.
If needed, pass `--sensor-path /absolute/path/to/sensor.py`.
Jimmy's sensor module must expose `get_stats()` and `air_quality_label(gas)`.
Expected units: temperature °C, humidity %, pressure hPa by default, gas resistance ohms.
Confirm these units before hardware deployment. Adafruit BME680 returns hPa, so the existing service command needs no extra flag. Only for a sensor explicitly returning kPa, use `python3 webapp.py --pressure-unit kPa`. Remove any previous explicit kPa flag. Internally records remain in hPa; the page displays kPa. Demo mode still expects hPa from the existing mock sensor.

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
Daily sky descriptions and precipitation percentages use experimental, uncalibrated humidity/relative-pressure rules. These percentages are heuristic scores, not empirically validated probabilities. No rainfall amount is inferred; the rainfall measurement card has been removed. Coefficients are documented in estimate_conditions(). Three-day forecasts still require three completed sample days. Indoor readings cannot represent outdoor sky conditions.
The brief summary remains short and includes tomorrow’s experimental sky description once history is sufficient.
Stale or gappy recent records stop forecasts. These are experimental estimates, not validated weather predictions.

## Frontend
Both index.html and templates/index.html now use static/css/style.css and static/js/main.js.
Open through Python for local API access, not VS Code Live Server.
Root script.js and style.css are small compatibility wrappers, not independent copies.

## Why estimates work without a rain gauge

The estimator does not use measured rainfall as an input. It uses temperature,
relative humidity and pressure. Removing the current precipitation card only
removes an unavailable measurement; it does not change the calculations.
A future precipitation percentage is still displayed as an **uncalibrated rule
score**, not a measured or statistically validated probability. We cannot
measure rainfall in millimetres, verify whether it actually rained, or reliably
infer cloud cover from these sensors alone. No external weather API or AI model
is used. All formulas below describe the implemented prototype, not established
meteorological forecasting equations.

## Inputs, units and timing

| Symbol | Meaning | Unit |
| --- | --- | --- |
| T | Temperature | degrees Celsius |
| H | Relative humidity | percent, e.g. 90 rather than 0.90 |
| P | Pressure inside the database and formulas | hPa |
| G | Gas resistance | ohms |
| h | Time after the latest observation | hours |
| d | Tomorrow / day after / third day | 1 / 2 / 3 |

The real Adafruit sensor returns hPa. Display conversion: `kPa = hPa / 10`.
Gas display conversion: `kilo-ohms = ohms / 1000`.
Accepted ranges: T from -50 to 85, H from 0 to 100, P from 300 to 1100.
Invalid measurements are rejected rather than written as real observations.

The collector runs once at startup, then at five-minute boundaries. Each saved
row has `bucket = floor(unix_time / 300)`; duplicate buckets are ignored.
Rows older than `now - 365 * 86400` seconds are deleted. This is a rolling 365-day
window. The page requests saved data every minute; refreshing it does not sample
the sensor. The database retains a year, but current predictions use at most the
last 14 days. Failed reads do not create substitute samples.

## 1. Recent trend: linear regression

Use the observations from the last three hours. For each observation, let
`t_i = (timestamp_i - first_timestamp) / 3600`, and let x be T or P.

```text
s_x = sum((t_i - mean(t)) * (x_i - mean(x)))
      / sum((t_i - mean(t))^2)
```

The denominator being zero gives a slope of zero. A slope is the overall change
per hour, not merely the difference between the last two observations.
`clip(x, a, b) = max(a, min(b, x))` below.

```text
s_T = clip(temperature slope, -2, 2)       # degrees Celsius / hour
s_P = clip(pressure slope, -3, 3)          # hPa / hour
```

Forecasts wait for at least 24 observations spanning 2.5 hours, with no gap
longer than 20 minutes, inside the three-hour window. The latest observation
must be no more than 15 minutes old. In practice allow about three hours of
regular collection. Gappy/stale histories suppress forecasts, not fill gaps.

The brief summary calls temperature rising above +0.15 degrees/hour, falling
below -0.15, otherwise stable. Pressure uses thresholds of +/-0.2 hPa/hour.

## 2. Hourly temperature and pressure before a daily cycle is available

```text
A(h) = 3 * (1 - exp(-h / 3))
T_est(h) = T_latest + s_T * A(h)
P_est_kPa(h) = (P_latest + s_P * A(h)) / 10
```

`exp` is the exponential function. A(h) approaches 3, which limits the total
extrapolated change instead of extending a straight line indefinitely.
Temperatures are clipped to [-50, 85] and rounded to one decimal. Predicted
pressure in kPa is rounded to one decimal. The API creates 24 hourly points;
the page displays the first 12 or 24 according to the selected duration.

**Example:** current temperature 20 degrees, slope -0.4 degrees/hour.

```text
A(12) = 3 * (1 - exp(-4)) = 2.9451
T_est(12) = 20 - 0.4 * 2.9451 = 18.8 degrees Celsius (rounded)
```

This example applies before the learned daily cycle is available. Once it is
available, the next formula also replaces the hourly temperature estimate.

## 3. Learn the daily temperature cycle and estimate three days

Times and dates use America/Toronto. From the last 14 days, use completed local
days with at least 200 samples covering at least 20 different hours. Require at
least three such days, and observations in all 24 hour bins across those days.
For each eligible day j, calculate its average temperature m_j. For each clock
hour k, average the deviations of its samples from their own day's average:

```text
C(k) = mean(T_i - m_day(i)) for all eligible samples taken in hour k
base = T_latest - C(hour_of_latest_reading)
T_est(h) = base + C(target_clock_hour)
           + s_T * A(h) * exp(-h / 24)
```

The cycle represents recurring warmer/cooler hours. The last term blends in the
recent trend and gradually fades it over time. It is not a model of moving
weather fronts. Temperatures are clipped and rounded as above.

For each of the next three calendar days, estimate temperatures at hours 0 to
23 and take the minimum and maximum of those 24 estimates. Hourly pressure
continues to use the previous pressure formula; it does not learn a daily cycle.

**Example:** current temperature is 20 degrees at an hour normally 2 degrees
above the day's mean. `base = 20 - 2 = 18`. If the recent slope is zero and the
learned cycle ranges from -3 to +2 degrees, each next day is estimated at
**15 to 20 degrees**. Similar estimates on several days are expected because
there is no external information about changing weather systems.

## 4. Experimental precipitation score for each future day

The following coefficients are hand-chosen prototype rules, **not learned from
actual rainfall observations**. P_mean and H_mean average all stored samples
available in the last 14 days. Pressure is compared to this station's own mean,
not to a fixed sea-level pressure threshold.

```text
w_d = exp(-(d - 1) / 2)                   # approximately 1, 0.6065, 0.3679
H_d = H_mean + (H_latest - H_mean) * w_d
F_d = clip(-raw_pressure_slope, -2, 2) * w_d
L_d = clip(P_mean - P_latest, -10, 10) * w_d
score_d = 25 + 1.2 * (H_d - 60) + 12 * F_d + 2 * L_d
percentage_d = 10 * round(clip(score_d, 10, 90) / 10)
```

`raw_pressure_slope` uses the same three-hour regression, with its own +/-2
limit for this rule. Falling pressure increases F; rising pressure decreases it.
The weight reduces the influence of current anomalies on more distant days.
Python's `round` uses ties-to-even; results come in coarse 10-point steps.
The 10 and 90 bounds are design choices, not guaranteed probability limits.

**Worked example:** suppose P_latest = 1010 hPa, P_mean = 1013 hPa,
raw pressure slope = -1 hPa/hour, and H_latest = H_mean = 90%.

```text
Tomorrow: w = 1, H = 90, F = 1, L = 3
score = 25 + 1.2*(90-60) + 12*1 + 2*3 = 79
Displayed percentage = 80% (uncalibrated estimate)
```

| Day | Weight | Score before rounding | Display |
| --- | --- | --- | --- |
| Tomorrow | 1.0000 | 79.00 | 80% |
| Day 2 | 0.6065 | 71.92 | 70% |
| Day 3 | 0.3679 | 67.62 | 70% |

80% here means a high rule score. It does not demonstrate that rain occurs in
80 out of 100 comparable situations. Calibration would require real rain
observations and checking predictions against outcomes. Humidity is used in
these rules, but gas resistance is not used in any weather forecast.

## 5. Sky descriptions and the short summary

Conditions are evaluated in this order, using the rounded percentage above:

| First matching condition | French output | Meaning |
| --- | --- | --- |
| Percentage >= 60 | Ciel couvert, précipitations possibles | Overcast, possible precipitation |
| Otherwise H_d >= 75 OR percentage >= 40 | Plutôt nuageux | Mostly cloudy |
| Otherwise H_d <= 55 AND percentage <= 20 | Plutôt ensoleillé | Mostly sunny |
| Otherwise | Éclaircies et passages nuageux | Sunny intervals and cloud |

The example above produces “Ciel couvert, précipitations possibles”. These
labels are inferred by rules, not detected sky conditions. All three daily
cards show very low confidence. Daily sky/percentage cards wait for the same
three complete sample days as the temperature ranges.

“Météo en bref” combines the recent temperature/pressure trend with tomorrow's
sky description and temperature range when available. It uses fixed sentence
templates, not generated AI text. With insufficient history it describes the
collection status. The forecast cannot infer rainfall quantity or snow type.

## 6. Air quality: is it hard-coded?

The **reading is measured**, but the **classification thresholds are fixed**.
The website calls Jimmy's `sensor.air_quality_label(stats['gas'])`, saves the
returned string alongside the measurement, and displays it. The frontend does
not replace it with its own rating.

In the sensor.py Jimmy shared on November 10, the rules are:

| Measured gas resistance G (ohms) | Returned text |
| --- | --- |
| G > 50,000 | excellente |
| Otherwise G > 20,000 | bonne |
| Otherwise G > 5,000 | moyenne |
| Otherwise | à surveiller |

**Example:** 4,200 ohms becomes “à surveiller” and is displayed as 4.2 kilo-ohms.
Exactly 50,000 is “bonne”; exactly 20,000 is “moyenne”; exactly 5,000 is
“à surveiller”, because the comparisons are strictly greater than.
These are Jimmy's current rules, not a calibrated AQI or a validated health
classification. This update does not modify the device's sensor.py. If Jimmy
changes that function, new measurements use his updated labels. In computer
preview mode the mock module returns “Indisponible” instead.

## Short explanation for class

We record local sensor readings every five minutes. We estimate short-term
changes from the last three hours and learn warmer and cooler times of day
from recent history. Simple humidity and pressure rules add experimental sky
and precipitation estimates. Everything runs locally. We have not validated
these percentages against actual rain, and the device does not measure rainfall.

## Applying this patch

Replace only the four supplied files, preserving their folders: index.html,
templates/index.html, static/css/style.css and README.md. Keep data/ intact.
Both HTML entry points share the same JavaScript and CSS. The measured dashboard
now has four cards in two columns (one column on narrow screens).
Restart the website service after replacing templates and refresh the browser;
use a hard refresh if the old CSS remains cached. No dependency update or
sensor.py replacement is required. Do not run competing sensor-reading programs
while the website collector owns the sensor.
