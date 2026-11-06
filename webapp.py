import sys
from pathlib import Path

# Add ~/bme680 so Flask can import sensor.py
BME_FOLDER = Path.home() / "bme680"
sys.path.append(str(BME_FOLDER))

from flask import Flask, render_template, jsonify
from sensor import get_stats, air_quality_label

app = Flask(__name__)

@app.route("/")
def home():
    stats = get_stats()

    return render_template(
        "index.html",
        temperature=stats["temperature"],
        humidity=stats["humidity"],
        pressure=stats["pressure"],
        gas=stats["gas"],
        air_quality=air_quality_label(stats["gas"])
    )

@app.route("/api/stats")
def api_stats():
    stats = get_stats()
    stats["air_quality"] = air_quality_label(stats["gas"])
    return jsonify(stats)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80)
