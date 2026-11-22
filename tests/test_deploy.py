import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

from src import deploy


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.images = patch.object(
            deploy, "current_image_ids", return_value=set()
        ).start()
        self.cleanup = patch.object(deploy, "cleanup_images").start()
        self.addCleanup(patch.stopall)

    def test_version_validation(self):
        self.assertEqual(deploy.next_version("0.1.9"), "0.1.10")
        for value in ("v1.0", "1.2", "1.2.-1", "01.2.3"):
            with self.assertRaises(ValueError):
                deploy.next_version(value)

    def test_all_version_parts_and_cli_defaults(self):
        self.assertEqual(deploy.next_version("1.2.9", "build"), "1.2.10")
        self.assertEqual(deploy.next_version("1.2.9", "minor"), "1.3.0")
        self.assertEqual(deploy.next_version("1.2.9", "major"), "2.0.0")
        self.assertEqual(deploy.parse_args([]).bump, "build")
        self.assertEqual(deploy.parse_args([]).env_file, Path(".env.mysql"))
        self.assertEqual(
            deploy.parse_args(["--env-file", ".env.other"]).env_file, Path(".env.other")
        )
        for bump in ("major", "minor", "build"):
            self.assertEqual(deploy.parse_args(["--bump", bump]).bump, bump)
        with self.assertRaises(ValueError):
            deploy.next_version("1.2.3", "invalid")
        with self.assertRaises(SystemExit):
            deploy.parse_args(["--bump", "invalid"])

    def test_selected_bump_is_passed_to_deployment(self):
        for bump, expected in (("major", "2.0.0"), ("minor", "1.3.0")):
            with self.subTest(bump=bump), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "VERSION").write_text("1.2.9\n")
                with (
                    patch.object(deploy, "ROOT", root),
                    patch.object(deploy.subprocess, "run") as run,
                ):
                    deploy.deploy(bump)
                    self.assertEqual((root / "VERSION").read_text().strip(), expected)
                    self.assertEqual(
                        run.call_args.kwargs["env"]["APP_VERSION"], expected
                    )

    def test_deploy_reserves_version_and_passes_it_to_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "VERSION").write_text("0.1.0\n")
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run") as run,
            ):
                deploy.deploy()
                self.assertEqual((root / "VERSION").read_text(), "0.1.1\n")
                self.assertEqual(run.call_args.kwargs["env"]["APP_VERSION"], "0.1.1")
                self.assertIn("--wait", run.call_args.args[0])
                self.assertIn("--force-recreate", run.call_args.args[0])
                deploy.deploy()
                self.assertEqual((root / "VERSION").read_text(), "0.1.2\n")

    def test_cleanup_and_image_lookup_are_opt_in(self):
        self.assertFalse(deploy.parse_args([]).cleanup_images)
        self.assertTrue(deploy.parse_args(["--cleanup-images"]).cleanup_images)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "VERSION").write_text("1.0.0\n")
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run"),
            ):
                deploy.deploy()
                self.images.assert_not_called()
                self.cleanup.assert_not_called()
                self.images.return_value = {"sha256:previous"}
                deploy.deploy(clean_images=True)
                self.images.assert_called_once_with(None)
                self.cleanup.assert_called_once_with({"sha256:previous"})

    def test_failed_config_does_not_bump_but_failed_build_keeps_reservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version = root / "VERSION"
            version.write_text("0.1.0\n")
            failure = subprocess.CalledProcessError(1, ["docker"])
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run", side_effect=failure),
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    deploy.deploy()
                self.assertEqual(version.read_text(), "0.1.0\n")
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run", side_effect=[None, failure]),
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    deploy.deploy()
                self.assertEqual(version.read_text(), "0.1.1\n")
                self.cleanup.assert_not_called()


class ComposeEnvironmentTest(unittest.TestCase):
    def test_shared_env_is_loaded_before_production_env_without_modifying_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            shared = root / ".env"
            production = root / ".env.mysql"
            shared.write_text(
                "OPENAI_API_KEY=private-test-key\nOPENAI_MODEL=test-model\n"
            )
            production.write_text("MYSQL_PASSWORD=private-test-password\n")
            original = shared.read_bytes(), production.read_bytes()
            with patch.object(deploy, "ROOT", root):
                self.assertEqual(
                    deploy.compose_command(Path(".env.mysql")),
                    [
                        "docker",
                        "compose",
                        "--env-file",
                        str(shared),
                        "--env-file",
                        str(production),
                    ],
                )
                self.assertEqual(
                    deploy.compose_command(Path(".env")),
                    ["docker", "compose", "--env-file", str(shared)],
                )
            self.assertEqual((shared.read_bytes(), production.read_bytes()), original)

    def test_env_file_is_used_for_validation_image_lookup_and_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            environment = root / ".env.mysql"
            environment.write_text("MYSQL_PASSWORD=private-test-value\n")
            (root / "VERSION").write_text("1.2.3\n")
            prefix = ["docker", "compose", "--env-file", str(environment)]
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run") as run,
                patch.object(deploy, "cleanup_images"),
                patch.dict(deploy.os.environ, DOCKER_HOST="ssh://test-macmini"),
            ):
                run.return_value.stdout = "sha256:previous"
                deploy.deploy(env_file=Path(".env.mysql"), clean_images=True)
                self.assertEqual(
                    run.call_args_list[0].args[0], [*prefix, "config", "--quiet"]
                )
                self.assertEqual(
                    run.call_args_list[1].args[0], [*prefix, "images", "--quiet", "app"]
                )
                self.assertEqual(run.call_args_list[2].args[0][: len(prefix)], prefix)
                self.assertEqual(
                    run.call_args.kwargs["env"]["DOCKER_HOST"], "ssh://test-macmini"
                )
                self.assertEqual(run.call_args.kwargs["env"]["APP_VERSION"], "1.2.4")
                self.assertNotIn("private-test-value", str(run.call_args_list))

    def test_cleanup_flag_is_forwarded_and_check_does_not_deploy(self):
        with (
            patch.object(deploy, "deploy", return_value="1.2.3") as start,
            patch.object(deploy, "offer_git_push"),
        ):
            self.assertEqual(deploy.main(["--cleanup-images", "--no-push"]), 0)
            start.assert_called_once_with(
                "build", env_file=Path(".env.mysql"), clean_images=True
            )
        with (
            patch.object(deploy, "deploy") as start,
            patch.object(deploy, "check_configuration"),
            patch.object(deploy, "compose_command"),
        ):
            self.assertEqual(deploy.main(["--cleanup-images", "--check"]), 0)
            start.assert_not_called()

    def test_missing_explicit_env_file_stops_before_version_reservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            version = root / "VERSION"
            version.write_text("1.2.3\n")
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run") as run,
                self.assertRaisesRegex(ValueError, "miljøfilen findes ikke"),
            ):
                deploy.deploy(env_file="missing.env")
            self.assertEqual(version.read_text(), "1.2.3\n")
            run.assert_not_called()

    def test_check_only_validates_without_deploy_version_lock_or_git(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            environment = root / ".env.mysql"
            environment.touch()
            with (
                patch.object(deploy, "ROOT", root),
                patch.object(deploy.subprocess, "run") as run,
                patch.object(deploy, "deploy") as start,
                patch.object(deploy, "offer_git_push") as push,
            ):
                self.assertEqual(deploy.main(["--check"]), 0)
                run.assert_called_once_with(
                    [
                        "docker",
                        "compose",
                        "--env-file",
                        str(environment),
                        "config",
                        "--quiet",
                    ],
                    cwd=root,
                    check=True,
                )
                start.assert_not_called()
                push.assert_not_called()
                self.assertFalse((root / ".deploy.lock").exists())
                self.assertFalse((root / "VERSION").exists())

    def test_invalid_check_returns_failure_without_deploy(self):
        with (
            patch.object(deploy, "compose_command", return_value=["docker", "compose"]),
            patch.object(
                deploy.subprocess,
                "run",
                side_effect=subprocess.CalledProcessError(1, ["docker", "compose"]),
            ),
            patch.object(deploy, "deploy") as start,
            patch.object(deploy, "offer_git_push") as push,
            patch("sys.stderr"),
        ):
            self.assertEqual(deploy.main(["--check"]), 1)
            start.assert_not_called()
            push.assert_not_called()


class GitPushTest(unittest.TestCase):
    def test_skip_flag_noninteractive_no_and_cancel_do_not_modify_git(self):
        for no_push, interactive in ((True, True), (False, False)):
            with (
                self.subTest(no_push=no_push, interactive=interactive),
                patch.object(deploy.sys.stdin, "isatty", return_value=interactive),
                patch("builtins.input") as prompt,
                patch.object(deploy.subprocess, "run") as run,
            ):
                deploy.offer_git_push("1.2.3", no_push)
                prompt.assert_not_called()
                run.assert_not_called()
        for answers in (
            ["n"],
            ["nej"],
            ["ukendt"],
            [EOFError()],
            ["ja", KeyboardInterrupt()],
        ):
            with (
                self.subTest(answers=answers),
                patch.object(deploy.sys.stdin, "isatty", return_value=True),
                patch("builtins.input", side_effect=answers),
                patch.object(deploy.subprocess, "run") as run,
            ):
                deploy.offer_git_push("1.2.3")
                run.assert_called_once_with(
                    ["git", "status", "--short"], cwd=deploy.ROOT, check=True
                )

    def test_yes_stages_commits_and_pushes_with_literal_message_or_default(self):
        for answer, supplied, expected in (
            ("", "", "Opdatér Filament DB til v1.2.3"),
            ("ja", "", "Opdatér Filament DB til v1.2.3"),
            ("ja", "Ret labels $(test) `test`", "Ret labels $(test) `test`"),
        ):
            with (
                self.subTest(message=supplied),
                patch.object(deploy.sys.stdin, "isatty", return_value=True),
                patch("builtins.input", side_effect=[answer, supplied]),
                patch.object(
                    deploy.subprocess,
                    "run",
                    side_effect=[
                        None,
                        None,
                        subprocess.CompletedProcess([], 1),
                        None,
                        None,
                    ],
                ) as run,
            ):
                deploy.offer_git_push("1.2.3")
                self.assertEqual(
                    run.call_args_list,
                    [
                        call(["git", "status", "--short"], cwd=deploy.ROOT, check=True),
                        call(["git", "add", "--all", "."], cwd=deploy.ROOT, check=True),
                        call(
                            ["git", "diff", "--cached", "--quiet"],
                            cwd=deploy.ROOT,
                            check=False,
                        ),
                        call(
                            ["git", "commit", "-m", expected],
                            cwd=deploy.ROOT,
                            check=True,
                        ),
                        call(["git", "push"], cwd=deploy.ROOT, check=True),
                    ],
                )

    def test_clean_index_pushes_without_empty_commit(self):
        with (
            patch.object(deploy.sys.stdin, "isatty", return_value=True),
            patch("builtins.input", side_effect=["j", ""]),
            patch.object(
                deploy.subprocess,
                "run",
                side_effect=[None, None, subprocess.CompletedProcess([], 0), None],
            ) as run,
        ):
            deploy.offer_git_push("1.2.3")
            self.assertEqual(run.call_count, 4)
            self.assertEqual(run.call_args.args[0], ["git", "push"])

    def test_commit_failure_stops_before_push(self):
        with (
            patch.object(deploy.sys.stdin, "isatty", return_value=True),
            patch("builtins.input", side_effect=["j", "Commit"]),
            patch.object(
                deploy.subprocess,
                "run",
                side_effect=[
                    None,
                    None,
                    subprocess.CompletedProcess([], 1),
                    subprocess.CalledProcessError(1, ["git", "commit"]),
                ],
            ) as run,
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.offer_git_push("1.2.3")
            self.assertEqual(run.call_count, 4)

    def test_main_only_offers_push_after_success_and_reports_git_failure_separately(
        self,
    ):
        with (
            patch.object(
                deploy,
                "deploy",
                side_effect=subprocess.CalledProcessError(1, ["docker"]),
            ),
            patch.object(deploy, "offer_git_push") as offer,
            patch("sys.stderr"),
        ):
            self.assertEqual(deploy.main([]), 1)
            offer.assert_not_called()
        with (
            patch.object(deploy, "deploy", return_value="1.2.3") as start,
            patch.object(
                deploy,
                "offer_git_push",
                side_effect=subprocess.CalledProcessError(1, ["git", "push"]),
            ) as offer,
            patch("sys.stderr") as errors,
        ):
            self.assertEqual(deploy.main(["--no-push"]), 1)
            start.assert_called_once_with(
                "build", env_file=Path(".env.mysql"), clean_images=False
            )
            offer.assert_called_once_with("1.2.3", True)
            self.assertIn(
                "Deployment af v1.2.3 lykkedes", errors.write.call_args_list[0].args[0]
            )


class ImageCleanupTest(unittest.TestCase):
    def test_only_untagged_app_images_removed_without_force(self):
        with (
            patch.object(
                deploy,
                "docker_output",
                side_effect=["sha256:old\nsha256:used", '["app:latest"]', "null", "[]"],
            ) as output,
            patch.object(
                deploy.subprocess,
                "run",
                side_effect=[
                    subprocess.CompletedProcess([], 0, "", ""),
                    subprocess.CompletedProcess([], 1, "", "in use"),
                ],
            ) as run,
        ):
            deploy.cleanup_images({"sha256:current", "sha256:old"})
            self.assertIn(
                f"label={deploy.IMAGE_LABEL}", output.call_args_list[0].args[0]
            )
            self.assertEqual(
                [c.args[0] for c in run.call_args_list],
                [
                    ["docker", "image", "rm", "sha256:old"],
                    ["docker", "image", "rm", "sha256:used"],
                ],
            )

    def test_missing_parent_image_does_not_stop_remaining_cleanup(self):
        missing = subprocess.CalledProcessError(
            1,
            ["docker", "image", "inspect"],
            stderr="Error: No such image: sha256:a-parent",
        )
        with (
            patch.object(
                deploy,
                "docker_output",
                side_effect=["sha256:a-parent\nsha256:b-old", missing, "[]"],
            ),
            patch.object(
                deploy.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, "", ""),
            ) as run,
            patch("sys.stderr") as errors,
        ):
            deploy.cleanup_images(set())
            self.assertEqual(
                run.call_args.args[0], ["docker", "image", "rm", "sha256:b-old"]
            )
            errors.write.assert_not_called()

    def test_inspection_error_is_reported_without_stopping_remaining_cleanup(self):
        failure = subprocess.CalledProcessError(
            1, ["docker", "image", "inspect"], stderr="Docker daemon unavailable"
        )
        with (
            patch.object(
                deploy,
                "docker_output",
                side_effect=["sha256:a\nsha256:b", failure, "[]"],
            ),
            patch.object(
                deploy.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, "", ""),
            ) as run,
            patch("sys.stderr") as errors,
        ):
            deploy.cleanup_images(set())
            self.assertEqual(
                run.call_args.args[0], ["docker", "image", "rm", "sha256:b"]
            )
            self.assertIn(
                "Docker daemon unavailable", errors.write.call_args_list[0].args[0]
            )

    def test_empty_cleanup_and_failure_are_nonfatal(self):
        with (
            patch.object(deploy, "docker_output", return_value=""),
            patch.object(deploy.subprocess, "run") as run,
        ):
            deploy.cleanup_images(set())
            run.assert_not_called()
        with (
            patch.object(
                deploy,
                "docker_output",
                side_effect=subprocess.CalledProcessError(1, ["docker"]),
            ),
            patch("sys.stderr"),
        ):
            deploy.cleanup_images(set())
            self.assertEqual(deploy.current_image_ids(), set())
