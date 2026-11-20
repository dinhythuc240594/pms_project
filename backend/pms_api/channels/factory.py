"""Channel creation is independent of worker, hotel and manager entry points."""

from collections.abc import Callable

from .client import ChannexClient
from .errors import ProviderError
from .ports import ChannelAdapter


class ChannelAdapterFactory:
    def __init__(self):
        self._builders: dict[str, Callable[..., ChannelAdapter]] = {
            "channex": lambda environment, api_key: ChannexClient(environment, api_key),
        }

    def create(self, provider, environment, api_key) -> ChannelAdapter:
        builder = self._builders.get(provider)
        if builder is None:
            raise ProviderError("channel_provider_unsupported")
        return builder(environment, api_key)

    def register(self, provider, builder):
        if provider in self._builders:
            raise ValueError(f"Channel provider {provider!r} is already registered")
        self._builders[provider] = builder
