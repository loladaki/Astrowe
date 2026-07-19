# Astrowe

Dashboard de observação astronómica. O utilizador introduz uma localização e vê,
para as próximas ~7 noites, um **score de observação** por noite — combinando
nuvens, fase/posição da Lua e a janela de escuridão astronómica.

O diferencial do projeto NÃO são os dados em bruto (isso já existe no Clear Outside,
Meteoblue, etc.) — é o **julgamento**: um número por noite e uma frase que diz
"vale a pena sair nesta noite?".

## Scope (MVP — manter apertado)

> "Meto uma localização e vejo, para as próximas 7 noites, um score de observação
> por noite, combinando nuvens, fase/posição da Lua e a janela de escuridão."

Fora de scope na v1 (fica para v2): locais guardados, Bortle/poluição luminosa,
planetas visíveis, catálogo de objetos, contas de utilizador.
Se aparecer código fora da linha acima, é derrapagem.

## Fontes de dados

- **Meteorologia (nuvens, humidade, ponto de orvalho, visibilidade):**
  [Open-Meteo](https://open-meteo.com/en/docs) — API aberta, sem chave.
  IMPORTANTE: usar sempre `timezone=auto` (senão a "noite" aparece trocada — vem em UTC).
  Ir à *fonte* (Open-Meteo), nunca fazer scraping dos intermediários (Clear Outside/Meteoblue).
- **Efemérides (Sol, Lua, escuridão astronómica):** [Skyfield](https://rhodesmill.org/skyfield/)
  — cálculo local, determinístico, offline. Descarrega `de421.bsp` (~17 MB) na 1ª execução.
- **Geocodificação (nome → lat/lon):** Open-Meteo Geocoding API (usada no frontend).

## Arquitetura

```
app/
  main.py       FastAPI: GET /api/forecast?lat=&lon=  + serve web/
  openmeteo.py  fetch da API Open-Meteo
  astro.py      Skyfield: janela de escuridão (Sol −18°), fase e altitude da Lua
  score.py      orquestra tudo e calcula o score por noite  ← coração do projeto
  models.py     modelos Pydantic
web/
  index.html    input de localização (pesquisa + geolocalização)
  app.js        chama a API e desenha os cards
  style.css
```

## Como correr

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r requirements.txt
uvicorn app.main:app --reload
# abrir http://127.0.0.1:8000
```

A **primeira** chamada à API é lenta (Skyfield descarrega `de421.bsp`). Depois fica em cache.

## A fórmula do score (v1 — a afinar)

Por noite, dentro da janela de escuridão astronómica:
- `cloud_score = 100 − nuvens_médias`  (fator dominante)
- `moon_factor = 1 − 0.6 × (iluminação × fração_da_noite_com_Lua_acima)`
- `transparency_factor` a partir da humidade média (proxy)
- `score = cloud_score × moon_factor × transparency_factor`  → 0–100

A fórmula é o local certo para iterar; ver `app/score.py`.
