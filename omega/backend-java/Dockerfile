# Stage 1: Compilación Java 21 con Maven
FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /workspace
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -DskipTests package

# Stage 2: Runtime mínimo con Java 21 JRE y Tesseract OCR para procesamiento Zero-Retention
FROM eclipse-temurin:21-jre-jammy AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl \
       tesseract-ocr \
       tesseract-ocr-eng \
       tesseract-ocr-spa \
       libtesseract-dev \
       libleptonica-dev \
    && rm -rf /var/lib/apt/lists/*

ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata

RUN groupadd -g 10001 omega \
    && useradd -u 10001 -g omega -m -s /usr/sbin/nologin omega \
    && mkdir -p /tmp/omega_ingest \
    && chown -R omega:omega /tmp/omega_ingest

WORKDIR /app
COPY --from=builder --chown=omega:omega /workspace/target/omega-backend-*.jar /app/app.jar

USER omega:omega

EXPOSE 8080

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Djava.security.egd=file:/dev/./urandom", "-jar", "/app/app.jar"]
