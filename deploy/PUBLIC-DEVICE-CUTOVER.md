# Public operations and device cutover

The current ECS deployment is a **single-device pilot**, not a 100,000-device
production service. Until the steps below are complete, keep Nginx, the API and
MQTT on their existing loopback listeners. The local SSH tunnel is only for
staff preview; it cannot be used by a bath-heater on a home Wi-Fi network.

## Separate entry points

| Entry | Network policy | Application policy |
| --- | --- | --- |
| `ops.zjdongxin.net:443` | Allow only Dongxin's verified, stable office public egress CIDR in Nginx | Administrator login is still mandatory |
| `api.zjdongxin.net:443` | Reachable from home networks | Proxy only `/api/device/v1/`; require unique device HTTP credentials |
| `api.zjdongxin.net:8883` | Reachable from home networks | MQTTS with unique device credentials and topic ACL |

Do not restrict the ECS security-group TCP 443 rule to the office IP: both
virtual hosts use that port. Nginx must enforce the IP allowlist on the `ops`
virtual host. If Dongxin's office egress IP changes, use a managed VPN or
zero-trust access service instead of a stale allowlist. Never expose 1883,
3077, 5432 or 8080 publicly.

## Prerequisites and order

1. Confirm ICP filing and obtain valid, renewable certificates for both names.
   DNS records alone do not make the device or operations services reachable.
2. Record the office's public egress IP, verify whether it is fixed, and render
   `nginx-public.conf.template` with that exact CIDR. Its placeholder must not
   reach the active config. Check the certificates' SANs and private-key file
   permissions; back up the active Nginx config before replacement.
3. Validate with `nginx -t`; reload Nginx. Test from the allowed office network
   that the login page loads and a valid admin login works. Test from another
   network that `ops` is denied while the device hostname does not serve the
   operations UI. Only then open TCP 443 in the ECS security group.
4. Replace the 30-day loopback MQTT certificate with the trusted device
   certificate. Keep a copy of the old certificate and configuration for
   rollback. Bind the Broker to the public interface only after TLS and
   per-device credentials have been tested; open only TCP 8883. Verify the API
   gateway reconnects and unknown/wrong device credentials are rejected.
5. Provision **one** pilot C3 with its own device ID, independent MQTT and HTTP
   secrets, household Wi-Fi credentials, `https://api.zjdongxin.net` and
   `mqtts://api.zjdongxin.net:8883`. The firmware must verify the certificate
   hostname and chain. Do not reuse the current board-type development IDs or
   shared LAN secrets. Test telemetry and audio with loads disconnected before
   any attended control test.
6. Only after the one-device path is measured should production provisioning,
   storage migration, queue capacity, monitoring and recovery be sized. The
   current JSON pilot limit is 20 devices and is not a 100,000-device rollout.

The operations IP allowlist is independent of device authorization. Neither an
office IP nor an administrator login grants a device access to MQTT or the
device HTTP API. Conversely, a device secret must not grant operations access.
