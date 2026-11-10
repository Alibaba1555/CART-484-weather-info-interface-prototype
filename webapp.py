"""Run on Pi: python3 webapp.py. Local test: python webapp.py --demo."""
import argparse
import importlib.util
import logging
import threading
import time
from pathlib import Path
from flask import Flask, jsonify, render_template, send_from_directory
from weather_store import normalize, save, read_history, forecast, INTERVAL

ROOT = Path(__file__).resolve().parent


def load_sensor(path):
    spec = importlib.util.spec_from_file_location('weather_sensor', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_app(sensor, db_path, demo=False, pressure_unit=None):
    pressure_unit = pressure_unit or "hPa"
    if pressure_unit not in ("kPa", "hPa"):
        raise ValueError("pressure_unit must be kPa or hPa")
    app = Flask(__name__)
    state = {'error': None}
    lock = threading.Lock()
    stop = threading.Event()
    def collect():
        try:
            stats = dict(sensor.get_stats())
            # Convert only when explicitly configured for a kPa sensor.
            if pressure_unit == 'kPa':
                pressure = stats.get('pressure')
                if isinstance(pressure, bool) or not isinstance(pressure, (int, float)):
                    raise ValueError('Pressure must be a numeric kPa value')
                stats['pressure'] = pressure * 10
            if stats.get('gas') is not None:
                stats['air_quality'] = sensor.air_quality_label(stats['gas'])
            save(db_path, normalize(stats), time.time())
            with lock:
                state['error'] = None
        except Exception:
            logging.exception('Sensor collection failed')
            with lock:
                state['error'] = 'Lecture du capteur impossible.'
    def worker():
        while not stop.is_set():
            collect()
            stop.wait(max(1, INTERVAL - time.time() % INTERVAL))
    @app.route('/')
    def home():
        return render_template('index.html')
    @app.route('/index.html')
    def standalone():
        return send_from_directory(ROOT, 'index.html')
    @app.route('/api/stats')
    def api_stats():
        now = time.time()
        rows, info = read_history(db_path, now)
        with lock:
            error = state['error']
        latest = rows[-1] if rows else None
        response = jsonify(current=latest, history=info, forecast=forecast(rows, now), demo=demo,
                           error=error, stale=not latest or now-latest['time'] > 900,
                           sampled_every_seconds=INTERVAL, retention_days=365)
        response.headers['Cache-Control'] = 'no-store'
        return response
    app.extensions['weather_collect'] = collect
    app.extensions['weather_worker'] = worker
    app.extensions['weather_stop'] = stop
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo', action='store_true', help='Use local mock sensor and a separate test database')
    parser.add_argument('--pressure-unit', choices=['kPa', 'hPa'], default=None, help='Sensor output unit: default hPa (Adafruit BME680)')
    parser.add_argument('--port', type=int, default=80)
    parser.add_argument('--sensor-path', type=Path, default=Path.home()/'bme680'/'sensor.py')
    args = parser.parse_args()
    path = ROOT/'sensor.py' if args.demo else args.sensor_path.expanduser()
    if not path.is_file():
        parser.error(f'Sensor file missing: {path}. For computer testing use --demo. On Pi use --sensor-path if needed.')
    app = create_app(load_sensor(path), ROOT/'data'/('weather-demo.db' if args.demo else 'weather.db'), args.demo, args.pressure_unit)
    threading.Thread(target=app.extensions['weather_worker'], daemon=True).start()
    try:
        app.run(host='0.0.0.0', port=args.port, use_reloader=False)
    finally:
        app.extensions['weather_stop'].set()
