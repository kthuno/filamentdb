"""Application entry point: run with python3 -m src.app from the project root."""

import logging
import os
from http.server import ThreadingHTTPServer

from .database import initialize
from .http_server import Handler


def main():
    """Apply repeatable migrations before accepting requests on the configured address."""
    # Only the AI service emits usage counters; never enable HTTP debug logging.
    ai_logger = logging.getLogger("src.knowledge_ai")
    if not ai_logger.handlers:
        ai_logger.addHandler(logging.StreamHandler())
    ai_logger.setLevel(logging.INFO)
    ai_logger.propagate = False
    initialize()
    server = ThreadingHTTPServer(
        (os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "49173"))),
        Handler,
    )
    print(
        f"Filamentdatabase: http://{server.server_address[0]}:{server.server_address[1]}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
