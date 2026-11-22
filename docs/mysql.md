# MySQL in production

[Back to README](../README.md)

Production uses MySQL 8.4 on the Mac mini. The code stays local; Docker commands and `src/deploy.py` run from VS Code with `DOCKER_HOST` pointing to the Mac mini. No code checkout is required on the server.

The local `.env.mysql` contains `COMPOSE_FILE=compose.yaml:compose.mysql.yaml`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`. See `.env.mysql.example`. The file is Git-ignored; protect it with `chmod 600 .env.mysql`. Compose passes the password into the container environment, which Docker administrators can inspect. Use a protected Docker connection over SSH or TLS.

`MYSQL_HOST=host.docker.internal` points from the container to the Docker host. MySQL must be reachable from the container, and the app account needs `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, and `REFERENCES` on the app database. The app creates tables at startup. Restrict MySQL network access to the necessary private network.

**Lessons-learned upgrade (phase 1):** `REFERENCES` extends the earlier requirements because the lessons-learned tables create foreign keys. A MySQL administrator must grant it to the existing app account on the app database before starting/deploying these migrations. Use the existing account and host component; global privileges or `ALL PRIVILEGES` are not required. The app and deployment script do not change grants. Missing `REFERENCES` can cause startup schema upgrades to fail.

`src/deploy.py` uses `.env.mysql` by default. Specify the environment file for direct Compose commands:

```sh
docker compose --env-file .env.mysql logs app
docker compose --env-file .env.mysql restart app
```

The MySQL override uses host networking during builds because Docker bridge DNS on the Mac mini cannot resolve PyPI. This does not change the app's normal networking or port binding. Set `BUILD_NETWORK=default` if host networking is unavailable or bridge DNS has been fixed.

Direct `python3 -m src.app` and `docker compose -f compose.yaml` still use SQLite for development. For direct MySQL operation, install `requirements-mysql.txt` and set `DATABASE_BACKEND=mysql` plus MySQL settings in the environment. Python does not automatically load `.env.mysql`.

## See also

- [Deployment](deployment.md)
- [Backup and restore](backup.md)
- [MySQL integration testing](development.md)
