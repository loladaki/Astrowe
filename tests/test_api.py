"""API HTTP: o health check tem de responder a GET *e HEAD*.

Monitores (UptimeRobot) usam HEAD; uma rota só-GET caía no mount estático e
devolvia 404, marcando o site como "down" quando não estava."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_get_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["open_meteo"] is True
    assert "light_pollution_key_configured" in body


def test_health_head_ok():
    # É isto que o UptimeRobot faz — tem de dar 200, não 404.
    assert client.head("/api/health").status_code == 200


def test_root_serves_html():
    r = client.get("/")
    assert r.status_code == 200
    assert "Astrowe" in r.text
