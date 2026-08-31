# what a phone shows above the six digits
OTP_ISSUER_NAME = "Nexgen MSP"

# credentials are checked, then held for five minutes while the code is typed
PENDING_LOGIN_PREFIX = "msp:pending_login:"
PENDING_LOGIN_TTL = 5 * 60

# a secret being enrolled, kept until it is proven by a first correct code
PENDING_SETUP_PREFIX = "msp:pending_2fa_setup:"
PENDING_SETUP_TTL = 5 * 60

# where the proven secret lives: DefaultValue rows under a parent of our own
DEFAULTS_PARENT_2FA = "__msp_2fa"

# one code either side of the current one, for clocks that drift
TOTP_VALID_WINDOW = 1

OTP_FAILURE_PREFIX = "msp_login_otp_fails:"
MAX_OTP_FAILURES = 5
OTP_FAILURE_WINDOW = 60

# site_config key reopening Frappe's native login. Recovery only: it lets any
# account in on a password alone, with no code.
ALLOW_NATIVE_LOGIN_KEY = "msp_allow_native_login"
