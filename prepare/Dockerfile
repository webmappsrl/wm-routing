FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends osmium-tool \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir osmium==4.0.2 shapely==2.0.6 pmtiles==3.4.1 pytest==8.3.3
WORKDIR /prepare
COPY . /prepare
