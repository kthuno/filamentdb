# Deployment and updates

[Back to README](../README.md)

- [Docker with existing nginx](#docker-with-existing-nginx)
- [Nginx reverse proxy example](#nginx-reverse-proxy-example)
- [Compose project and container name](#compose-project-and-container-name)
- [Versioning and updates](#versioning-and-updates)

## Docker with existing nginx

Requires Docker Engine 25+, Compose 2.20.2+ (supporting `--wait` and `start_interval`), and Python 3 on Linux/macOS:

```sh
python3 -m src.deploy
```

Compose starts only the Python app, published at http://127.0.0.1:49173 on the Docker host. Production data lives on the existing MySQL server. With SQLite, the database lives in the `filament-data` Docker volume and survives container recreation. `docker compose down -v` deletes the volume and its data. `--remove-orphans` removes any nginx container left from the earlier setup.

The port binds to localhost by default so existing nginx on the same host can access the app. The app has no login; anyone with access can read and change inventory. For internet access, configure HTTPS and access control at the reverse proxy, such as nginx basic auth or an existing login solution.

See the [nginx reverse proxy example](#nginx-reverse-proxy-example) below for an existing nginx on the Docker host. App deployment does not install or update host nginx configuration or certificates.

If nginx runs on another machine, change the Compose port binding to the Docker host's private IP, such as `192.168.1.10:49173:49173`, and `proxy_pass` to `http://192.168.1.10:49173`. Restrict port access to the proxy's IP. If existing nginx runs in Docker, it can instead share a Docker network with the app and use `http://app:49173`; localhost inside the nginx container refers to that container itself.

## Nginx reverse proxy example

This example assumes nginx runs directly on the Docker host and the app remains
bound to `127.0.0.1:49173`. Replace `filament.example.com` and the certificate
paths with your own values. Configure DNS and provide a certificate trusted by
your clients before enabling the HTTPS server. Keep your actual host
configuration, certificates, and private keys outside this repository.

Add these server blocks to a file included in your existing nginx `http`
context, or merge the relevant directives into your existing server blocks.
No custom snippet files or additional nginx container are required.

```nginx
server {
    listen 80;
    server_name filament.example.com;
    return 301 https://filament.example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name filament.example.com;

    ssl_certificate     /etc/nginx/certs/filament.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/filament.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Allow the app's uploads of up to 30 MB, including request overhead.
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:49173;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Preserve the original `Host` header with `proxy_set_header Host $http_host`:
the app uses it for form origin checks. The app has no login; before exposing
it to the internet, add access control to your existing proxy, such as basic
authentication or your existing login solution. HTTPS alone does not restrict
access.

On the nginx host, validate the complete configuration before reloading it:

```sh
sudo nginx -t
sudo nginx -s reload
```

Run the reload command only if validation succeeds. If uploads return HTTP 413,
check that `client_max_body_size 32m` applies to the server handling the request.
App deployment does not perform these host configuration steps.

Directive reference: [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)
and [request body size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).

## Compose project and container name

`compose.yaml` fixes the project name to `3d-filament-db`, regardless of the checkout directory name. This matches existing production and reuses `3d-filament-db_filament-data` for SQLite/original files. Do not override it with `COMPOSE_PROJECT_NAME` or `docker compose -p` during normal operation. Another project name can create an empty volume and conflict with the fixed container name `filamentdb`.

If deployment reports that the container name is already in use, check its project label and `/data` volume before retrying. Do not delete the container or volume to bypass the error. Correcting the project name requires no changes to the database, grants, nginx, or host networking. The mistakenly created `filamentdb_filament-data` is unused and is not deleted automatically. A version reserved by a failed deployment is retained.

## Versioning and updates

Run `python3 -m src.deploy` from the project root. The script checks Compose configuration, increments the build component (z) in `VERSION` by default (initially `0.1.0` → `0.1.1`), builds and recreates the app container, and waits for its healthcheck. The version is embedded in the image and shown in the footer through `/api/version`. That endpoint also reports the configured database backend, showing SQLite locally and MySQL in production. Reload after updating.

A lock prevents concurrent deployments from the same checkout. If deployment fails after reserving a version, that number remains used; the next attempt uses the next number. Save/commit `VERSION` with changes to preserve the sequence across checkouts. Deploy from one checkout for a consistent sequence. Choose a component with `--bump`; major/minor reset subsequent components:

```sh
python3 -m src.deploy              # build: 1.2.9 → 1.2.10
python3 -m src.deploy --bump build # same as default
python3 -m src.deploy --bump minor # minor: 1.2.9 → 1.3.0
python3 -m src.deploy --bump major # major: 1.2.9 → 2.0.0
```

Image cleanup is disabled by default to avoid extra Docker calls. Use `python3 -m src.deploy --cleanup-images` to remove old, untagged app images after successful deployment. New builds are labeled `dk.filament-db.app=true`; cleanup finds labeled dangling images and the app image used before deployment. Tagged images are preserved. Docker removes without force, protecting images used by running or stopped containers. Other projects' images, build caches, and data volumes are untouched. Older abandoned images without the app label cannot be identified safely and still require manual cleanup; future builds are covered. Already removed images, such as untagged parents removed by Docker, are skipped. Other inspection errors are reported per image while cleanup continues. Cleanup errors do not invalidate successful deployment.

After successful deployment in an interactive terminal, the script shows `git status --short` and asks whether to commit and push changes. The default is yes (Enter). If accepted, it asks for a commit message; Enter uses a locally generated message meaning “Update Filament DB to vX.Y.Z”. No AI or external service generates the suggestion. It runs `git add --all .`, `git commit -m ...` if changes exist, and `git push` to the current branch's upstream. All project changes are included, including version changes and deleted files; Git-ignored files are excluded. Git needs a configured identity, upstream, and GitHub access.

Use `python3 -m src.deploy --no-push` to skip the prompt. Non-interactive runs skip it automatically. Failed deployment never prompts for a push. If Git fails after deployment, the running app and reserved version remain; finish the Git operation manually without deploying again.

Choose another local Compose environment file with `--env-file`; the same file is used for validation, previous-image lookup, and deployment. Relative paths are resolved from the project root. Without the flag, `src/deploy.py` uses the project's `.env.mysql`. It must exist; there is no automatic SQLite fallback. Ordinary `docker compose` commands still need `--env-file .env.mysql` unless Compose configuration is supplied otherwise. The script inherits `DOCKER_HOST`, Docker context, and other environment variables, so it can run locally against the Mac mini without a server checkout.

```sh
python3 -m src.deploy --cleanup-images              # deploy and clean up old app images
python3 -m src.deploy --check                       # Compose validation only
python3 -m src.deploy --no-push                     # deploy using .env.mysql
python3 -m src.deploy --env-file .env.other --check # choose another environment file
```

Healthchecks run every second during the first 30 seconds of startup, then every 30 seconds. A successful check ends the startup period early so deployment can finish as soon as the app is ready.

`--check` does not change `VERSION`, build/start containers, or prompt for a Git push. It validates Compose configuration only, not database connections, schema, or inventory. The script does not print environment-file contents.

`python3 -m src.deploy --help` lists options without deploying.

Ordinary `docker compose` commands and restarts do not increment the version; use the script for updates. Direct `python3 -m src.app` and ordinary Docker builds use `VERSION` unless `APP_VERSION` is set. Versioning does not change the filament database.

## See also

- [MySQL in production](mysql.md)
- [Backup and restore](backup.md)
- [OpenAI configuration](ai-suggestions.md)
