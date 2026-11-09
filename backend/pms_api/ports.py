"""Execution context port for application services.

Domain rules do not use this port. HTTP/CLI entry points provide context and
response construction; tests can supply an ordinary Python object instead.
"""

from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Protocol

from .bookings.ports import ReservationRepository
from .channels.ports import RevisionRepository
from .pricing.ports import PricingRepository


class RequestContext(Protocol):
    args: Any
    headers: Mapping
    cookies: Mapping
    method: str
    path: str
    remote_addr: str | None
    content_length: int | None


class ApplicationRuntime(Protocol):
    state: Any
    request: RequestContext
    config: Mapping
    extensions: dict
    logger: Any
    reservations: ReservationRepository
    pricing: PricingRepository
    channels: Any
    revisions: RevisionRepository

    def payload(self) -> dict: ...
    def date_range(self, *, aliases=("start", "end")) -> tuple: ...
    def json_response(self, *args, **kwargs) -> Any: ...
    def request_scope(self, path, *, method) -> Any: ...
    def app_scope(self) -> Any: ...


_active: ContextVar[ApplicationRuntime | None] = ContextVar("pms_runtime", default=None)
_default: ApplicationRuntime | None = None


def configure_runtime(adapter: ApplicationRuntime):
    global _default
    _default = adapter


def runtime() -> ApplicationRuntime:
    adapter = _active.get()
    if adapter is not None:
        return adapter
    if _default is None:
        raise RuntimeError("Application runtime has not been configured")
    return _default


@contextmanager
def use_runtime(adapter: ApplicationRuntime):
    token = _active.set(adapter)
    try:
        yield adapter
    finally:
        _active.reset(token)
