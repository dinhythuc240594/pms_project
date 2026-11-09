class ApiError(Exception):
    """An HTTP error understood by the API's existing error handler."""

    def __init__(self, status, code, message, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details
