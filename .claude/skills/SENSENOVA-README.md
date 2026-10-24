# SenseNova Skills (vendored)

The 36 `sn-*` directories here are copied unmodified from
https://github.com/OpenSenseNova/SenseNova-Skills at commit
`7838651111ef2dc3ac0293f08008730f1a022694` (MIT, see `SENSENOVA-LICENSE`).

They were written for OpenClaw / hermes-agent. Notes for Claude Code:

- Credentials: many skills need keys in a `.env` (template upstream at
  `.env.example`). Image, infographic, PPT-creative/tools and image-caption
  skills need SenseNova keys (`SN_*`); PPT search uses `SERPER_API_KEY`;
  social search uses `TIKHUB_TOKEN`, `YOUTUBE_API_KEY`, `ZHIHU_COOKIE` etc.
- Python deps live in each skill's `requirements.txt`.
- `sn-update` targets `~/.openclaw/skills` / `~/.hermes/skills`; to update
  here, re-copy `skills/` from upstream instead.
- Bundled scripts run on your machine when a skill invokes them; review
  before use.
