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

## A fórmula do score (v2)

A ideia central: **nunca fazer a média da noite toda**. "Limpo até à 1h, depois
fecha" tem a mesma média que "meio encoberto a noite inteira" — e uma é uma boa
noite, a outra é inútil. Por isso calcula-se **qualidade hora a hora** e
procura-se a **melhor janela contígua**.

Qualidade de cada hora (0–1), tudo contínuo (sem degraus):
- **Nuvens por camada** — `(1−1.0·baixas)(1−0.85·médias)(1−0.5·altas)`.
  Cirros altos deixam passar; estratos baixos não.
- **Lua** — `1 − peso × iluminação × sin(altitude)`. `sin` vale 0 no horizonte e
  1 no zénite: uma Lua cheia rasante quase não incomoda.
- **Transparência** — do *spread* temperatura−ponto de orvalho (1 °C = nevoeiro,
  9 °C = ar seco), não da humidade a 2 m.

Depois: o troço contíguo que maximiza `qualidade_média × fator_duração`, com
`fator_duração = min(1, horas/4)^0.5` (crédito total às 4h, retornos
decrescentes). **Não há limiar de "hora utilizável"** — acrescentar uma hora
fraca baixa a média mas sobe a duração, e o ótimo aparece sozinho.

⚠️ Distinção importante: o **score** vem do troço ótimo (satura às 4h), mas a
**janela reportada** alarga-se às horas vizinhas de qualidade comparável. Sem
isto, uma noite inteira impecável de 5.6h seria sempre reportada como "4h".

### Perfis (`mode`)

|  | céu profundo | planetas e Lua |
|---|---|---|
| janela | escuridão astronómica (−18°) | do pôr ao nascer do Sol |
| peso da Lua | 0.70 | 0.05 |
| chão da transparência | 0.70 | 0.85 |

### Limitação conhecida

Em modo *planetas* os scores comprimem-se no topo (quase tudo "Excelente"),
porque o discriminador real é o **seeing** (turbulência atmosférica) e não o
temos. Um proxy possível: vento em altitude (`wind_speed_250hPa` no Open-Meteo).
