"""Reset in-memory anonymous throttle between isolated test cases."""

import pytest

from app.main import RATE


@pytest.fixture(autouse=True)
def fresh_rate_window():
    RATE.clear()
