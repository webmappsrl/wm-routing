# GraphHopper dal ramo principale a un commit fissato: la sorgente di quote
# `pmtiles` (Terrarium e Mapbox) non c'e' nella 11.1 rilasciata.
FROM maven:3.9-eclipse-temurin-25 AS build
ARG GH_COMMIT=97f7fde
RUN git clone https://github.com/graphhopper/graphhopper.git /src \
 && cd /src && git checkout ${GH_COMMIT}
WORKDIR /src
RUN mvn -q -DskipTests -pl web -am package \
 && cp web/target/graphhopper-web-*.jar /graphhopper-web.jar

FROM eclipse-temurin:25-jre
COPY --from=build /graphhopper-web.jar /app/graphhopper-web.jar
COPY profiles /app/profiles
COPY config.yml config-cella.yml config-fixture.yml run.sh /app/
WORKDIR /app
ENV JAVA_OPTS="-Xmx2g -Xms2g"
ENTRYPOINT ["/app/run.sh"]
