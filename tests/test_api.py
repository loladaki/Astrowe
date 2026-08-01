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


def test_lightpollution_point_shape():
    # Sem chave da API (ambiente de teste) degrada para null, mas responde 200
    # com a chave "light_pollution" — é o que o mapa consome ao clicar.
    r = client.get("/api/lightpollution", params={"lat": 38.72, "lon": -9.14})
    assert r.status_code == 200
    assert "light_pollution" in r.json()


def test_lightpollution_point_rejects_bad_coords():
    assert client.get("/api/lightpollution", params={"lat": 200, "lon": 0}).status_code == 422


def test_darker_nearby_shape(monkeypatch):
    # Mockar a fonte (o ambiente local pode ter chave real): sem dados → sugestões
    # vazias, mas responde 200 com a forma que o mapa consome.
    import app.lightpollution as lp

    async def no_data(lat, lon, client=None):
        return None
    monkeypatch.setattr(lp, "fetch", no_data)
    r = client.get("/api/darker-nearby", params={"lat": 38.72, "lon": -9.14})
    assert r.status_code == 200
    body = r.json()
    assert body["suggestions"] == []
    assert "origin" in body and "radius_km" in body


def test_darker_nearby_rejects_bad_radius():
    r = client.get("/api/darker-nearby", params={"lat": 38.72, "lon": -9.14, "radius_km": 500})
    assert r.status_code == 422
