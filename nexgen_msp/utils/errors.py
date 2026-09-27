class NexgenError(Exception):
    http_status_code = 400

    def __init__(self, message, code, http_status_code=None, detail=None):
        self.message = message
        self.code = code
        # what the screen needs in order to act on the refusal, when a sentence is not enough
        self.detail = detail
        if http_status_code is not None:
            self.http_status_code = http_status_code
        super().__init__(message)


class NotFoundError(NexgenError):
    http_status_code = 404


class PermissionError(NexgenError):
    http_status_code = 403


class ValidationError(NexgenError):
    http_status_code = 400
