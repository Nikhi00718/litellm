import uuid
from collections.abc import Iterator
from typing import Final

import pytest
from integration._support.client import Gateway, object_value
from integration._support.database import write_rows

ROWS: Final = 1002
START: Final = "2003-04-01"
END: Final = "2003-04-02"


@pytest.fixture
def customer_activity() -> Iterator[str]:
    marker: Final = f"customer-aggregate-{uuid.uuid4().hex}"
    try:
        write_rows(
            'INSERT INTO "LiteLLM_EndUserTable" (user_id, alias) VALUES (%s, %s), (%s, %s)',
            (f"{marker}-a", "First customer", f"{marker}-b", "Second customer"),
        )
        write_rows(
            'INSERT INTO "LiteLLM_DailyEndUserSpend" '
            "(id, end_user_id, date, api_key, model, custom_llm_provider, spend, prompt_tokens, completion_tokens, "
            "api_requests, successful_requests, failed_requests, created_at, updated_at) "
            "SELECT %s || '-' || n, %s || CASE WHEN n <= 1001 THEN '-a' ELSE '-b' END, "
            "CASE WHEN n %% 2 = 1 THEN %s ELSE %s END, %s || '-key', 'aggregation-test-' || n, "
            "'test-provider', 0.01, 3, 2, 1, 1, 0, NOW(), NOW() FROM generate_series(1, %s::int) AS n",
            (marker, marker, START, END, marker, str(ROWS)),
        )
        yield marker
    finally:
        write_rows(
            'DELETE FROM "LiteLLM_DailyEndUserSpend" WHERE end_user_id IN (%s, %s)', (f"{marker}-a", f"{marker}-b")
        )
        write_rows('DELETE FROM "LiteLLM_EndUserTable" WHERE user_id IN (%s, %s)', (f"{marker}-a", f"{marker}-b"))


def test_customer_aggregation_returns_every_page_and_customer_breakdown(
    gateway: Gateway, customer_activity: str
) -> None:
    params: Final = {
        "start_date": START,
        "end_date": END,
        "end_user_ids": f"{customer_activity}-a,{customer_activity}-b",
    }
    first: Final = gateway.get("/customer/daily/activity", params={**params, "page_size": "1000"})
    assert object_value(first["metadata"])["total_pages"] == 2

    body: Final = gateway.get("/customer/daily/activity/aggregated", params=params)
    metadata: Final = object_value(body["metadata"])
    assert (
        metadata["total_spend"],
        metadata["total_api_requests"],
        metadata["total_prompt_tokens"],
        metadata["total_completion_tokens"],
        metadata["total_tokens"],
        metadata["page"],
        metadata["total_pages"],
        metadata["has_more"],
    ) == (pytest.approx(ROWS * 0.01), ROWS, ROWS * 3, ROWS * 2, ROWS * 5, 1, 1, False)
    days: Final = body["results"]
    assert isinstance(days, list) and len(days) == 2
    latest: Final = object_value(days[0])
    assert latest["date"] == END
    entities: Final = object_value(object_value(latest["breakdown"])["entities"])
    assert set(entities) == {f"{customer_activity}-a", f"{customer_activity}-b"}
    first_customer: Final = object_value(entities[f"{customer_activity}-a"])
    assert object_value(first_customer["metrics"])["spend"] == pytest.approx(5)
    assert object_value(first_customer["metadata"])["alias"] == "First customer"
    per_key: Final = object_value(first_customer["api_key_breakdown"])
    assert object_value(object_value(per_key[f"{customer_activity}-key"])["metrics"])["api_requests"] == 500
    models: Final = object_value(object_value(latest["breakdown"])["models"])
    assert object_value(object_value(models["aggregation-test-1002"])["metrics"])["api_requests"] == 1


@pytest.mark.parametrize(
    ("filters", "expected_requests"),
    [
        ({"start_date": END}, 501),
        ({"end_date": START}, 501),
        ({"end_user_ids": "{marker}-b"}, 1),
        ({"exclude_end_user_ids": "{marker}-b"}, 1001),
        ({"api_key": "{marker}-missing"}, 0),
        ({"model": "aggregation-test-2"}, 1),
    ],
)
def test_customer_aggregation_preserves_filters_and_empty_results(
    gateway: Gateway, customer_activity: str, filters: dict[str, str], expected_requests: int
) -> None:
    params: Final = {
        "start_date": START,
        "end_date": END,
        "end_user_ids": f"{customer_activity}-a,{customer_activity}-b",
        **{key: value.format(marker=customer_activity) for key, value in filters.items()},
    }
    body: Final = gateway.get("/customer/daily/activity/aggregated", params=params)
    metadata: Final = object_value(body["metadata"])
    assert metadata["total_api_requests"] == expected_requests
    assert metadata["total_spend"] == pytest.approx(expected_requests * 0.01)
    assert metadata["has_more"] is False
    if expected_requests == 0:
        assert body["results"] == []
