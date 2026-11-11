# ECS MQTT loopback pilot

This stage prepares the cloud API and MQTT broker without exposing device ports
to the Internet. It does not require the ESP32-C3 to be reflashed or the sample
to perform a load action. Do not treat this as a public device pilot.

## Preconditions

- A verified release containing `apps/mqtt-broker/src` is active on the ECS.
- SSH is limited to the operator's current source IP. Do not open port 22 to
  `0.0.0.0/0` to fix a connectivity problem.
- Keep security-group ports 1883, 8883, 3077 and 5432 closed. Nginx continues
  to deny `/api/device/` publicly.
- Back up `/var/lib/dongxin` before changing the API. The provisioning script
  separately backs up `/etc/dongxin/api.env`; both backups contain secrets and
  must stay private.

## Broker and gateway configuration

1. Activate the verified release while `MQTT_ENABLED=false`. Run
   `sudo /opt/dongxin/node/bin/node /opt/dongxin/current/deploy/provision-mqtt-loopback.mjs`
   once. It installs the service unit, generates a 30-day test certificate,
   a gateway secret and an independent synthetic pilot device secret on the
   ECS, and backs up the original API environment. It refuses to overwrite
   existing MQTT files. The certificate is not publicly trusted.
2. Run `sudo systemctl daemon-reload`, then start the broker. Confirm with
   `sudo ss -lntp` that only `127.0.0.1:8883` is listening. Check
   `sudo systemctl status dongxin-mqtt --no-pager` without printing its env file.
3. The script sets `MQTT_ENABLED=true`, `MQTT_URL=mqtts://127.0.0.1:8883`,
   `MQTT_CA_FILE=/etc/dongxin/mqtt/ca.pem`, and
   `MQTT_TLS_SERVERNAME=api.zjdongxin.net` in the API environment. Keep the
   API listener at `127.0.0.1:3077`; restart `dongxin-api` only after the
   broker is healthy. The synthetic MQTT identity has no HTTP credential and
   cannot access the device HTTP API.
4. Confirm the API runtime status reports MQTT enabled **and connected**.
   A healthy HTTP endpoint alone is insufficient. Confirm an authenticated
   pilot MQTT client can subscribe only to its own downlink and that a wrong
   password is rejected. Keep this test free of real load commands.

The pilot device secret must later be provisioned into the C3 through a
controlled firmware build or provisioning step. The current firmware contains
local development credentials and a LAN broker address; do not point it at
the ECS or publish port 1883 without replacing those values and validating
MQTTS plus HTTPS trust.

## Public cutover after filing and certificate readiness

Replace the short-lived test certificate with a trusted certificate for
`api.zjdongxin.net`. Add a separate HTTPS device API entry, remove the
device-route block only for that entry, and validate device authentication,
request size and rate limits. Then change the broker listener to the intended
public interface, open only TCP 8883 and TCP 443 in the ECS security group,
and verify DNS, TLS hostname validation and actual device identity end to end.
Do not expose port 1883. The public cutover and real-device test require a
separate change window and operator presence.
