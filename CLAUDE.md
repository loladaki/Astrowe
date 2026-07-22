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
- **Geocodificação (nome → lat/lon):** Open-Meteo Geocoding API (usada no frontend),
  com autocomplete. Nota: a API ordena por relevância global e enterra
  localidades pequenas, por isso fazemos dois pedidos em paralelo (um filtrado
  pelo país preferido, outro global) e juntamos com os locais à cabeça. O país
  preferido arranca do locale do browser mas **passa a ser o da última
  localidade escolhida** (guardado em `localStorage`) — o locale engana-se
  demasiado (um browser em inglês em Portugal dá "GB").
  Limitação da API: precisa de ~5 caracteres para algumas localidades
  ("Covil" encontra Covilhã, "Covi" não devolve nada).
- **Mapa:** [Leaflet](https://leafletjs.com) 1.9.4 via CDN unpkg + tiles do
  OpenStreetMap. Sem chave. Manter a atribuição do OSM (é exigida).
- **Poluição luminosa:** [lightpollutionmap.info](https://www.lightpollutionmap.info),
  endpoint `https://www.lightpollutionmap.info/api/queryraster`
  ([docs](https://www.lightpollutionmap.info/api-html/doc-rasterquery.html)),
  camada **Sky Brightness 2025** (`sb_2025`), com recuo para `wa_2015`.
  **Exige chave pessoal** — pede-se por email a Jurij Stare (`starej@t-2.net`).
  Gratuito até **1000 pedidos/dia** (reset à meia-noite UTC+1); ilimitado por
  100 €/ano. Lê-se de `LIGHTPOLLUTIONMAP_API_KEY` (ver `.env.example`). Sem
  chave o Astrowe funciona na mesma, apenas sem este fator.

  ⚠️ Dois detalhes que só se descobrem a usar:
  - O endpoint **antigo** (`/QueryRaster/`) ainda responde para `wa_2015` mas dá
    HTTP 500 para `sb_*`. Usar sempre `/api/queryraster`.
  - Os erros vêm em **texto simples com HTTP 200** ("Invalid authentication.",
    "Daily quota exceeded."). Não dá para confiar no código de estado — é o
    corpo que decide. Erros de autenticação/quota são fatais e não se repetem
    noutra camada.

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

## Deploy

**GitHub Pages não serve** — o backend calcula efemérides em Python. Há
`render.yaml` (Blueprint do Render) e `Dockerfile` (HF Spaces, Fly.io, etc.).

Duas regras que não se quebram:
- A chave da API **nunca** entra no repositório nem em JavaScript publicado.
  No Render é `sync: false` no blueprint, preenchida como segredo no dashboard.
  Um site estático tornaria a chave pública — foi por isso que se descartou o
  Pages mesmo com as APIs a suportarem CORS.
- As efemérides descarregam-se **durante a build**, não em runtime: são 17 MB
  do JPL a cada arranque a frio se ficarem para o primeiro pedido.

## A fórmula do score (v2)

A ideia central: **nunca fazer a média da noite toda**. "Limpo até à 1h, depois
fecha" tem a mesma média que "meio encoberto a noite inteira" — e uma é uma boa
noite, a outra é inútil. Por isso calcula-se **qualidade hora a hora** e
procura-se a **melhor janela contígua**.

**Linguagem:** o score e as frases falam português corrente ("Lua gibosa baixa
no céu", "céu rural, pouca luz"), nunca números crus. Os números vivem na
tabela de dados completos, para quem os quer interpretar. Regra: a camada de
cima explica, a de baixo mostra.

Qualidade de cada hora (0–1), tudo contínuo (sem degraus):
- **Nuvens por camada** — `(1−1.0·baixas)(1−0.85·médias)(1−0.5·altas)`.
  Cirros altos deixam passar; estratos baixos não.
- **Lua** — `1 − peso × iluminação × sin(altitude)`. `sin` vale 0 no horizonte e
  1 no zénite: uma Lua cheia rasante quase não incomoda.
- **Transparência** — do *spread* temperatura−ponto de orvalho (1 °C = nevoeiro,
  9 °C = ar seco), não da humidade a 2 m.
- **Seeing** — do vento a 250 hPa (jet stream): calmo abaixo de 20 km/h, a ferver
  acima de 130. Pesa pouco em céu profundo (`seeing_floor` 0.88) e muito em
  planetas (0.45), onde é ele que decide se vês as bandas de Júpiter.

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

### Poluição luminosa

Constante no tempo (é propriedade do **sítio**, não da noite), por isso entra
como fator multiplicativo **no score final** e nunca na qualidade horária — se
entrasse hora a hora, num sítio Bortle 9 tudo cairia abaixo de `REPORT_FLOOR` e
deixaríamos de reportar janelas. Aplica-se nos dois modos.

`Bortle 1 → ×1.0` ... `Bortle 9 → ×0.30` (linear, `LP_MIN_FACTOR`).

Conversão (retirada do próprio código do lightpollutionmap.info, que aplica a
mesma fórmula às camadas SB e WA_2015):
```
total = artificial_mcd_m2 + 0.171168465   # brilho natural do céu
SQM   = log10(total / 108000000) / −0.4
```
Dá SQM 22.00 para céu pristino — o valor canónico, e o máximo possível.

⚠️ Não usar `0.132025599479675` (a constante do DeepskyLog): produz SQM 22.28
para céu pristino, e a própria `laravel-astronomy-library` deles lança exceção
para SQM > 22.0. É um bug do lado deles.

Tabela SQM→Bortle em `app/lightpollution.py`, de `laravel-astronomy-library`.

Como não muda de noite para noite, **não altera a ordem das noites** num sítio —
só o significado absoluto do score e a comparação entre sítios. Resposta em
cache por coordenada (~100 m) para poupar o limite diário da chave.

### Objectos visíveis

`app/objects.py` + `app/data/messier.json` (110 objectos, coordenadas J2000
validadas contra o SIMBAD; M40, M45 e M102 faltavam na fonte e foram
acrescentados à mão). Calcula o que está acima de 25° a meio da janela
recomendada, planetas primeiro, e marca os objectos que o luar apaga.

### Locais guardados

Guardados em `localStorage` (`astrowe.places`) — sem contas nem backend. O botão
"Comparar locais" faz um pedido por local e desenha uma grelha local × noite,
com a melhor combinação destacada. É o que responde a "onde **e** quando vou?",
e só é honesto porque a poluição luminosa entra no score.

### Armadilha do CSS: `[hidden]`

`web/style.css` começa com `[hidden] { display: none !important; }` — **não
remover**. O atributo `hidden` só actua via `display: none` na folha do browser,
e qualquer regra de autor lhe ganha: um `display: flex` num elemento escondido
fá-lo aparecer sempre. Aconteceu duas vezes (modal do mapa e formulário de
guardar) antes de se pôr a regra global.

### Planear a sessão (culminação, airmass, eventos)

Cada objecto diz **quando** está melhor, não só onde está agora — é o que
transforma a lista num plano ordenado ("M13 a descer, apanha primeiro; M31 a
subir, deixa para as 3h").

A culminação e a altura máxima calculam-se **analiticamente**, não amostrando
a noite: um objecto culmina quando o tempo sideral local iguala a sua ascensão
recta, e a altura no meridiano é `90 − |latitude − declinação|`. Validado contra
amostragem do Skyfield: bate ao minuto. Amostrar 110 objectos × 10 horas × 7
noites seria insuportável no Render.

`airmass` usa Kasten-Young, que continua válida perto do horizonte (ao
contrário de `1/cos(z)`). 1.0 no zénite, 2.0 a 30°, 5.6 a 10°.

`app/events.py` acrescenta o que depende da época: **chuveiros de meteoros**
(tabela da IMO, ±2 dias do pico, com a altura do radiante — um radiante baixo
esconde a maioria dos meteoros) e o **núcleo da Via Láctea** (devolve `None`
onde nunca sobe; em Portugal só chega a ~21°).

### Métricas para o observador (não para o céu)

Vais estar horas parado de noite — estas contam tanto como as do céu:
- **Risco de orvalho** do spread (< 2 °C = as ópticas embaciam).
- **Sensação térmica** pela fórmula do wind chill (só vale abaixo de 10 °C e
  acima de 4.8 km/h; fora disso devolve a temperatura).
