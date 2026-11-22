FROM python:3.15-alpine
WORKDIR /app
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app && mkdir /data && chown app:app /data
COPY requirements-mysql.txt ./
RUN pip install --no-cache-dir -r requirements-mysql.txt
COPY --chown=app:app src ./src
COPY --chown=app:app VERSION ./
COPY --chown=app:app static ./static
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version=${APP_VERSION} dk.filament-db.app=true
USER app
ENV HOST=0.0.0.0 PORT=49173 DATABASE_PATH=/data/filaments.sqlite3 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 49173
CMD ["python", "-m", "src.app"]
