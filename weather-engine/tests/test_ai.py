"""Claude features with a fake SDK client: no network, no API key needed."""

import json
from types import SimpleNamespace

import pytest

from weather_engine import ai, report
from weather_engine.config import Location
from weather_engine.forecast import run_forecast


class FakeMessages:
    def __init__(self, text="Dry and warm through Thursday.", stop_reason="end_turn"):
        self.calls = []
        self.text, self.stop_reason = text, stop_reason

    def _message(self):
        return SimpleNamespace(stop_reason=self.stop_reason,
                               content=[SimpleNamespace(type="thinking", thinking=""),
                                        SimpleNamespace(type="text", text=self.text)])

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._message()

    def stream(self, **kwargs):
        self.calls.append(kwargs)
        msg = self._message()

        class _S:
            def __enter__(s):
                return SimpleNamespace(get_final_message=lambda: msg)

            def __exit__(s, *a):
                return False
        return _S()


@pytest.fixture
def fake_claude(monkeypatch):
    messages = FakeMessages()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(ai, "_client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=messages)))
    return messages


def test_not_configured_is_clear(fake_api):
    assert not ai.configured()
    with pytest.raises(ai.AIError, match="ANTHROPIC_API_KEY"):
        ai.summarize({"days": [{"date": "2026-10-27"}]})


def test_summary_request_uses_only_forecast_numbers(fake_api, fake_claude):
    data = report.to_dict(run_forecast(Location("Denver", 39.74, -104.99)))
    assert ai.summarize(data) == "Dry and warm through Thursday."
    call = fake_claude.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"] == {"effort": "low"}
    sent = json.loads(call["messages"][0]["content"])
    assert len(sent["days"]) == 8 and sent["days"][1]["tmax"] == data["days"][1]["tmax"]
    assert "Use only the numbers" in call["system"]


def test_refusal_is_reported(fake_api, fake_claude):
    fake_claude.stop_reason = "refusal"
    with pytest.raises(ai.AIError, match="declined"):
        ai.summarize({"days": [{"date": "2026-10-27"}]})


def test_analyze_context_and_report(fake_api, fake_claude, tmp_path):
    from datetime import date

    from weather_engine import verify

    run_forecast(Location("Denver", 39.74, -104.99))
    scores = verify.run_verification(today=date(2026, 11, 4))
    context = ai.build_context(scores)
    assert "blend_minus_baseline" in context and "n_blend" in context
    assert "Latest calibration per location" in context and "gfs_seamless" in context
    assert "archive coverage" in context and "iem_KBKF" in context
    text, path = ai.analyze(scores, out_dir=tmp_path)
    assert path.read_text().startswith("Dry and warm")
    call = fake_claude.calls[-1]
    assert call["output_config"] == {"effort": "high"} and call["max_tokens"] == 64000
    assert call["messages"][0]["content"] == context


def test_cli_show_data_sends_nothing(fake_api, capsys):
    from weather_engine.cli import main

    main(["analyze", "--show-data"])
    assert "Verification" in capsys.readouterr().out


def test_summary_endpoint(fake_api, fake_claude):
    import threading
    import urllib.request

    from weather_engine.server import make_server

    srv = make_server("127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        assert json.loads(urllib.request.urlopen(base + "/api/config").read()) == {"ai": True}
        body = json.dumps({"days": [{"date": "2026-10-27", "tmax": {"value": 70}}]}).encode()
        req = urllib.request.Request(base + "/api/summary", data=body, headers={"Content-Type": "application/json"})
        assert json.loads(urllib.request.urlopen(req).read())["summary"].startswith("Dry")
    finally:
        srv.shutdown()
        srv.server_close()
