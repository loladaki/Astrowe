# Astrowe

**Das próximas noites, qual vale a pena?** Um score por noite, não uma tabela.

Os sites de meteorologia astronómica mostram-te dados e deixam-te interpretar.
O Astrowe dá-te um **julgamento**: um número de 0 a 100 por noite, a melhor
janela de horas, o que te está a limitar, e o que podes observar nessas horas.

## Como funciona

Em vez da média da noite toda — que esconde o que interessa, porque "limpo até
à 1h, depois fecha" dá a mesma média que "meio encoberto a noite inteira" — o
Astrowe calcula uma **qualidade hora a hora** e procura a **melhor janela
contígua**.

Cada hora combina, tudo contínuo e sem degraus:

| Ingrediente | Fonte |
|---|---|
| Nuvens por camada (baixas/médias/altas) | [Open-Meteo](https://open-meteo.com) |
| Transparência (spread temperatura−ponto de orvalho) | Open-Meteo |
| Seeing (jet stream a 250 hPa) | Open-Meteo |
| Lua: iluminação × altura no céu | [Skyfield](https://rhodesmill.org/skyfield/) (offline) |
| Poluição luminosa do local | [lightpollutionmap.info](https://www.lightpollutionmap.info) |

Dois perfis: **céu profundo** (exige escuridão astronómica, a Lua pesa muito) e
**planetas e Lua** (basta o Sol posto, o seeing é que manda).

## Funcionalidades

- Score 0–100 por noite com a melhor janela de horas
- Análise do **factor limitante**: quantos pontos te custam as nuvens, a Lua,
  a transparência, o seeing ou a poluição luminosa
- Detalhe hora a hora, com tabela completa de dados crus para quem prefere
  interpretar sozinho
- **Objectos visíveis** na janela recomendada: 110 Messier, 7 planetas e a Lua,
  com ligação à ficha no [Telescopius](https://telescopius.com)
- Métricas do observador: risco de orvalho, temperatura e sensação térmica
- **Locais guardados** e comparação lado a lado, noite a noite
- Pesquisa com sugestões e selector de mapa para sítios sem nome

## Correr localmente

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Abre <http://127.0.0.1:8000>. A primeira chamada é lenta: o Skyfield descarrega
as efemérides `de421.bsp` (~17 MB) e guarda-as em cache.

## Poluição luminosa (opcional)

Sem chave o Astrowe funciona na mesma — apenas sem este factor, e avisa na
interface. Para o activar:

1. Pede uma chave por email a Jurij Stare (`starej@t-2.net`), dono do
   lightpollutionmap.info. Gratuito até 1000 pedidos/dia.
2. `cp .env.example .env` e preenche `LIGHTPOLLUTIONMAP_API_KEY`.

O `.env` está no `.gitignore`. **Nunca faças commit da chave.**

## Deploy

O backend faz cálculos de efemérides em Python, por isso precisa de um host que
corra código — não serve GitHub Pages.

**Render** (`render.yaml` incluído): New → Blueprint → aponta para este
repositório. Depois define `LIGHTPOLLUTIONMAP_API_KEY` em Environment, como
segredo. O plano gratuito adormece ao fim de 15 min sem uso e demora ~30–50 s a
acordar.

**Docker** (`Dockerfile` incluído): serve para Hugging Face Spaces, Fly.io ou
qualquer host que aceite contentores. Passa a chave como segredo do host.

Em ambos os casos as efemérides são descarregadas durante a build, para não
atrasarem o primeiro pedido.

## Licença

Dados meteorológicos © Open-Meteo, poluição luminosa © lightpollutionmap.info,
mapas © OpenStreetMap. Respeita os termos de cada fonte.
