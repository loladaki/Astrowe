# Alternativa ao render.yaml — serve para Hugging Face Spaces, Fly.io, ou
# qualquer sítio que aceite Docker. Mantém o projecto independente do host.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Efemérides descarregadas na build: 17 MB que não queremos ir buscar ao
# JPL a cada arranque a frio.
RUN python -c "from skyfield.api import load; load('de421.bsp')"

COPY app app
COPY web web

ENV PORT=8000
EXPOSE 8000

# LIGHTPOLLUTIONMAP_API_KEY passa-se como segredo do host, nunca na imagem.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
