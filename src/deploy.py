"""Bump major, minor or build version and deploy with Docker Compose."""

import argparse
import fcntl
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMAGE_LABEL = "dk.filament-db.app=true"


def next_version(current, bump="build"):
    match = re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", current)
    if not match:
        raise ValueError("VERSION skal indeholde et versionsnummer som 0.1.0.")
    major, minor, build = map(int, match.groups())
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "build":
        return f"{major}.{minor}.{build + 1}"
    raise ValueError("Vælg major, minor eller build.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Øg versionen og deploy Filament DB.")
    parser.add_argument(
        "--bump",
        choices=("major", "minor", "build"),
        default="build",
        help="Versionsdel: major (x), minor (y) eller build (z, standard).",
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Spring spørgsmålet om Git-commit og push over.",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(".env.mysql"),
        help="Compose-miljøfil (standard: .env.mysql). Relative stier regnes fra projektmappen.",
    )
    parser.add_argument(
        "--cleanup-images",
        action="store_true",
        help="Ryd op i gamle, utaggede app-images efter et vellykket deploy (ellers springes oprydning over).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validér kun Compose-konfigurationen; byg, start og versionsøg ikke.",
    )
    return parser.parse_args(argv)


def docker_output(arguments):
    return subprocess.run(
        ["docker", *arguments], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def compose_command(env_file=None):
    command = ["docker", "compose"]
    if env_file is not None:
        path = Path(env_file)
        if not path.is_absolute():
            path = ROOT / path
        if not path.is_file():
            raise ValueError(f"Compose-miljøfilen findes ikke: {path}")
        # Compose does not automatically load .env when --env-file is explicit.
        # Load the optional shared settings first; the selected file keeps precedence.
        shared = ROOT / ".env"
        if shared.is_file() and shared.resolve() != path.resolve():
            command.extend(["--env-file", str(shared.resolve())])
        command.extend(["--env-file", str(path.resolve())])
    return command


def check_configuration(command):
    # Do not print the expanded configuration: it includes the MySQL password.
    subprocess.run([*command, "config", "--quiet"], cwd=ROOT, check=True)


def current_image_ids(env_file=None):
    try:
        return set(
            docker_output(
                [*compose_command(env_file)[1:], "images", "--quiet", "app"]
            ).split()
        )
    except (OSError, subprocess.CalledProcessError) as error:
        print(
            f"Kunne ikke finde tidligere app-image; deployment fortsætter: {error}",
            file=sys.stderr,
        )
        return set()


def cleanup_images(previous):
    try:
        dangling = set(
            docker_output(
                [
                    "image",
                    "ls",
                    "--quiet",
                    "--no-trunc",
                    "--filter",
                    "dangling=true",
                    "--filter",
                    f"label={IMAGE_LABEL}",
                ]
            ).split()
        )
        candidates = dangling | previous
        removed = 0
        for identity in sorted(candidates):
            # Keep tagged images, including the image just deployed.
            try:
                tags = docker_output(
                    ["image", "inspect", "--format", "{{json .RepoTags}}", identity]
                )
            except subprocess.CalledProcessError as error:
                # Removing a child image may also remove untagged parent layers
                # already present in our candidate list.
                detail = (error.stderr or "").strip()
                if "no such image" not in detail.lower():
                    print(
                        f"Image {identity} blev sprunget over; kunne ikke inspiceres: "
                        f"{detail or error}",
                        file=sys.stderr,
                    )
                continue
            if tags not in {"null", "[]"}:
                continue
            result = subprocess.run(
                ["docker", "image", "rm", identity],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                removed += 1
            else:
                print(
                    f"Image {identity} blev bevaret (kan være i brug): {result.stderr.strip()}",
                    file=sys.stderr,
                )
        print(f"Image-oprydning: {removed} ubrugte app-images fjernet.", flush=True)
    except (OSError, subprocess.CalledProcessError) as error:
        print(
            f"Appen er startet, men image-oprydning kunne ikke afsluttes: {error}",
            file=sys.stderr,
        )


def deploy(bump="build", env_file=None, clean_images=False):
    # Keep concurrent deployments from reserving the same version.
    with (ROOT / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        command = compose_command(env_file)
        check_configuration(command)
        previous = current_image_ids(env_file) if clean_images else set()
        version_file = ROOT / "VERSION"
        version = next_version(version_file.read_text().strip(), bump)
        # Reserve before building: failed deployments never reuse a version.
        temporary = ROOT / ".VERSION.tmp"
        temporary.write_text(version + "\n")
        temporary.replace(version_file)
        print(f"Deployer Filament DB v{version} …", flush=True)
        subprocess.run(
            [
                *command,
                "up",
                "-d",
                "--build",
                "--force-recreate",
                "--remove-orphans",
                "--wait",
            ],
            cwd=ROOT,
            env={**os.environ, "APP_VERSION": version},
            check=True,
        )
        print(f"Filament DB v{version} er startet.", flush=True)
        if clean_images:
            cleanup_images(previous)
        return version


def offer_git_push(version, no_push=False):
    if no_push or not sys.stdin.isatty():
        return
    print("\nÆndringer i projektet:", flush=True)
    subprocess.run(["git", "status", "--short"], cwd=ROOT, check=True)
    try:
        answer = input("Vil du committe og pushe ændringer til GitHub? [J/n] ")
        if answer.strip().lower() not in {"", "j", "ja", "y", "yes"}:
            print("Git-commit og push sprunget over.")
            return
        default = f"Opdatér Filament DB til v{version}"
        message = input(f"Commit-besked [Enter: {default}]: ").strip() or default
    except (EOFError, KeyboardInterrupt):
        print("\nGit-commit og push afbrudt.")
        return
    subprocess.run(["git", "add", "--all", "."], cwd=ROOT, check=True)
    staged = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=ROOT, check=False
    )
    if staged.returncode == 1:
        subprocess.run(["git", "commit", "-m", message], cwd=ROOT, check=True)
    elif staged.returncode != 0:
        staged.check_returncode()
    else:
        print(
            "Ingen nye ændringer at committe; pusher eventuelle eksisterende commits."
        )
    subprocess.run(["git", "push"], cwd=ROOT, check=True)
    print("Ændringer er pushet til den aktuelle branches upstream.")


def main(argv=None):
    args = parse_args(argv)
    try:
        if args.check:
            check_configuration(compose_command(args.env_file))
            print(
                "Compose-konfigurationen er gyldig. Databaseforbindelse er ikke testet."
            )
            return 0
        version = deploy(
            args.bump, env_file=args.env_file, clean_images=args.cleanup_images
        )
    except BlockingIOError:
        print("Et andet deploy kører allerede.", file=sys.stderr)
        return 1
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        if args.check:
            message = (
                f"Konfigurationskontrol mislykkedes: {error}. Versionen er ikke ændret."
            )
        else:
            message = (
                f"Deploy mislykkedes: {error}. En eventuelt reserveret version beholdes; "
                "næste deploy bruger næste nummer."
            )
        print(message, file=sys.stderr)
        return 1
    try:
        offer_git_push(version, args.no_push)
    except (OSError, subprocess.CalledProcessError) as error:
        print(
            f"Deployment af v{version} lykkedes, men Git-commit/push mislykkedes: {error}. "
            "Kontrollér git status og afslut Git-handlingen manuelt; et nyt deploy er ikke nødvendigt.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
