# Channex rate safety simulation

Synthetic, local-only fixtures based on Channex's official ARI/catalog contract.
No owning-team mock was supplied; no workspace is published or rebound.

Start from repository root:
`postman simulation run postman/simulations/channex-rate-safety.sim.yaml --port 4901 --no-history --output ndjson`

Set `CHANNEX_RATE_SIMULATION_URL=http://127.0.0.1:4901/channex` for
`tests.test_channel_rate_http`. The normal disposable PostgreSQL test wrapper must
also set both test database URLs; never point it at a hotel database.

Scenarios: successful two-night publication, failed rate write, stale price
readback, failed inventory close. Each runs the actual worker and HTTP adapter.
The test-only reset/state endpoints use only synthetic IDs and prices.

Windows CLI 1.74.0: a restricted run crashed the dataset daemon on an inherited
handle. The same local simulation runs with normal host permissions. Keep its
NDJSON output outside Git; it records requests.

Verified 25/10/2026: `tests.test_channel_rate_http` passed all four scenarios
against the real worker, disposable PostgreSQL and `ChannexClient`. The `channex`
member served 31 HTTP requests (29 status 200, two intentional 503 responses),
including availability/restriction writes and readbacks. No member was silent.
The combined 50-test command also exercised the existing cancellation simulation;
its three failures were older onboarding fixture readbacks, fixed and rerun in
the separate four-test concurrency check. The four ARI HTTP cases themselves passed.
This stand-in cannot establish delivery or displayed prices on a real OTA.
