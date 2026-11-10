"""Five-minute sensor history and conservative experimental local estimates."""
import math
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/Toronto')
INTERVAL = 300
RETENTION = 365 * 86400


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('''CREATE TABLE IF NOT EXISTS readings (
        bucket INTEGER PRIMARY KEY, time REAL NOT NULL, temperature REAL NOT NULL,
        humidity REAL NOT NULL, pressure REAL NOT NULL, gas REAL, air_quality TEXT)''')
    return con


def normalize(stats):
    # Contract with Jimmy's sensor.py: Celsius, percent, hPa, ohms.
    result = {}
    for key, low, high in [('temperature', -50, 85), ('humidity', 0, 100), ('pressure', 300, 1100)]:
        value = stats.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'Invalid {key}; expected Celsius, percent and hPa')
        result[key] = float(value)
    gas = stats.get('gas')
    result['gas'] = float(gas) if isinstance(gas, (int, float)) and math.isfinite(gas) and gas >= 0 else None
    result['air_quality'] = str(stats.get('air_quality') or 'Indisponible')
    return result


def save(path, stats, now):
    with connect(path) as con:
        con.execute('INSERT OR IGNORE INTO readings VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (int(now // INTERVAL), now, stats['temperature'], stats['humidity'], stats['pressure'], stats['gas'], stats['air_quality']))
        con.execute('DELETE FROM readings WHERE time < ?', (now - RETENTION,))
        # SQLite reuses deleted pages; the database does not grow by a year each year.


def read_history(path, now):
    with connect(path) as con:
        con.execute('DELETE FROM readings WHERE time < ?', (now - RETENTION,))
        rows = [dict(r) for r in con.execute('SELECT * FROM readings WHERE time >= ? ORDER BY time', (now - 14*86400,))]
        info = dict(con.execute('SELECT COUNT(*) AS count, MIN(time) AS first, MAX(time) AS last FROM readings').fetchone())
    return rows, info


def slope(rows, key):
    xs = [(r['time'] - rows[0]['time']) / 3600 for r in rows]
    xm = sum(xs) / len(xs)
    ym = sum(r[key] for r in rows) / len(rows)
    den = sum((x-xm)**2 for x in xs)
    return sum((x-xm)*(r[key]-ym) for x, r in zip(xs, rows)) / den if den else 0


def estimate_conditions(rows, recent, day_number):
    """Uncalibrated prototype rules, NOT a statistically measured probability.

    Use pressure relative to this station's own recent mean (not a sea-level
    pressure threshold). Humidity is local, so indoor use is not representative.
    Coefficients are design choices. No randomness or external weather input.
    """
    last = recent[-1]
    baseline = sum(r['pressure'] for r in rows) / len(rows)
    humidity_mean = sum(r['humidity'] for r in rows) / len(rows)
    weight = math.exp(-(day_number - 1) / 2)
    humidity = humidity_mean + (last['humidity'] - humidity_mean) * weight
    falling = max(-2, min(2, -slope(recent, 'pressure'))) * weight
    low_relative = max(-10, min(10, baseline - last['pressure'])) * weight
    score = 25 + (humidity - 60) * 1.2 + falling * 12 + low_relative * 2
    # Coarse 10% steps avoid implying fine precision; bounds are arbitrary too.
    probability = int(round(max(10, min(90, score)) / 10) * 10)
    if probability >= 60:
        description = 'Ciel couvert, précipitations possibles'
    elif humidity >= 75 or probability >= 40:
        description = 'Plutôt nuageux'
    elif humidity <= 55 and probability <= 20:
        description = 'Plutôt ensoleillé'
    else:
        description = 'Éclaircies et passages nuageux'
    return {'description': description, 'precipitation_probability': probability,
            'probability_calibrated': False, 'method': 'local_heuristic_v1'}


def forecast(rows, now):
    result = {'hourly': [], 'daily': [], 'summary': 'Historique en cours de collecte.',
              'note': 'Estimation locale expérimentale · aucune donnée météo externe.'}
    recent = [r for r in rows if now - 3*3600 <= r['time'] <= now]
    if not recent or now - recent[-1]['time'] > 900:
        result['summary'] = 'Mesures récentes indisponibles.'
        return result
    if len(recent) < 24 or recent[-1]['time'] - recent[0]['time'] < 2.5*3600 or any(b['time']-a['time'] > 1200 for a,b in zip(recent, recent[1:])):
        result['summary'] = 'Collecte des mesures : environ 3 heures nécessaires pour une première estimation.'
        return result
    last = recent[-1]
    ts = max(-2, min(2, slope(recent, 'temperature')))
    ps = max(-3, min(3, slope(recent, 'pressure')))
    trend = 'en hausse' if ts > .15 else 'en baisse' if ts < -.15 else 'plutôt stable'
    pressure = 'en hausse' if ps > .2 else 'en baisse' if ps < -.2 else 'stable'
    result['summary'] = f'Dans les prochaines heures : température {trend}. Pression {pressure}.'
    # Learn the daily cycle from completed, reasonably covered local days.
    days = {}
    today = datetime.fromtimestamp(now, ZONE).date()
    for row in rows:
        dt = datetime.fromtimestamp(row['time'], ZONE)
        if dt.date() < today:
            days.setdefault(dt.date(), []).append(row)
    covered = [v for v in days.values() if len(v) >= 200 and len({datetime.fromtimestamp(r['time'], ZONE).hour for r in v}) >= 20]
    bins = {h: [] for h in range(24)}
    for day in covered:
        mean = sum(r['temperature'] for r in day) / len(day)
        for r in day:
            bins[datetime.fromtimestamp(r['time'], ZONE).hour].append(r['temperature'] - mean)
    cycle = {h: sum(v)/len(v) for h,v in bins.items() if v}
    learned = len(covered) >= 3 and len(cycle) == 24
    current_hour = datetime.fromtimestamp(last['time'], ZONE).hour
    base = last['temperature'] - cycle.get(current_hour, 0)
    def estimate(t):
        h = max(0, (t-last['time'])/3600)
        # Damp the short trend; never extend its slope linearly for three days.
        offset = ts * 3 * (1-math.exp(-h/3)) * math.exp(-h/24)
        value = base + cycle[datetime.fromtimestamp(t, ZONE).hour] + offset if learned else last['temperature'] + ts*3*(1-math.exp(-h/3))
        return round(max(-50, min(85, value)), 1)
    for h in range(1, 25):
        t = now + h*3600
        result['hourly'].append({'time': t, 'temperature': estimate(t), 'pressure': round((last['pressure']+ps*3*(1-math.exp(-h/3)))/10, 1)})
    if learned:
        for n in range(1,4):
            date = today + timedelta(days=n)
            vals = [estimate(datetime(date.year,date.month,date.day,h,tzinfo=ZONE).timestamp()) for h in range(24)]
            result['daily'].append({'date': date.isoformat(), 'min': min(vals), 'max': max(vals), **estimate_conditions(rows, recent, n), 'confidence': 'Très faible'})
        result['summary'] += f" Demain : {result['daily'][0]['description'].lower()} selon l’estimation locale. Température estimée entre {result['daily'][0]['min']} et {result['daily'][0]['max']} degrés Celsius."
    else:
        result['daily_note'] = 'Au moins 3 journées complètes de mesures sont nécessaires pour estimer le cycle quotidien.'
    return result
