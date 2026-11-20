"""Provider failures shared by channel ports and their adapters."""


class ProviderError(Exception):
    def __init__(self, code, retryable=False, *, http_status=None, failure_type=None):
        self.code, self.retryable = code, retryable
        self.http_status, self.failure_type = http_status, failure_type
        super().__init__(code)
