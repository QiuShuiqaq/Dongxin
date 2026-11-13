#!/usr/bin/env bash
# One-device pilot cutover; run after the trusted MQTT certificate is installed.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }

api=/etc/dongxin/api.env
mqtt=/etc/dongxin/mqtt.env
[[ -f $api && -f $mqtt ]] || { echo 'Missing Dongxin environment files' >&2; exit 1; }
[[ $(grep -c '^MQTT_CA_FILE=/etc/dongxin/mqtt/ca.pem$' "$api") == 1 ]] || {
    echo 'Expected one loopback CA pin in API environment' >&2; exit 1;
}
[[ $(grep -c '^MQTT_HOST=127.0.0.1$' "$mqtt") == 1 ]] || {
    echo 'Expected one loopback MQTT host' >&2; exit 1;
}
openssl s_client -connect 127.0.0.1:8883 -servername api.zjdongxin.net \
    -verify_hostname api.zjdongxin.net -verify_return_error </dev/null >/dev/null 2>&1 || {
    echo 'Trusted MQTT TLS is not ready' >&2; exit 1;
}

install -d -m 0700 /var/backups/dongxin
backup=$(mktemp -d /var/backups/dongxin/mqtt-public-XXXXXXXX)
install -m 0600 "$api" "$backup/api.env"
install -m 0600 "$mqtt" "$backup/mqtt.env"
api_temp=$(mktemp /etc/dongxin/.api-public-XXXXXXXX)
mqtt_temp=$(mktemp /etc/dongxin/.mqtt-public-XXXXXXXX)
cleanup() { rm -f -- "$api_temp" "$mqtt_temp"; }
recover() {
    trap - ERR
    install -m 0600 "$backup/api.env" "$api"
    install -m 0600 "$backup/mqtt.env" "$mqtt"
    chown dongxin:dongxin "$api" "$mqtt"
    systemctl restart dongxin-mqtt || true
    systemctl restart dongxin-api || true
    echo "Public MQTT cutover failed; previous environment restored from $backup" >&2
    cleanup
    exit 1
}
trap recover ERR
trap cleanup EXIT
sed 's|^MQTT_CA_FILE=/etc/dongxin/mqtt/ca.pem$|MQTT_CA_FILE=|' "$api" > "$api_temp"
sed 's|^MQTT_HOST=127.0.0.1$|MQTT_HOST=0.0.0.0|' "$mqtt" > "$mqtt_temp"
chown dongxin:dongxin "$api_temp" "$mqtt_temp"
chmod 0600 "$api_temp" "$mqtt_temp"
mv -f -- "$api_temp" "$api"
mv -f -- "$mqtt_temp" "$mqtt"
systemctl restart dongxin-mqtt
systemctl restart dongxin-api
ready=false
for ((attempt=0; attempt<15; attempt++)); do
    if curl --silent --fail --max-time 3 http://127.0.0.1:3077/api/health |
        /opt/dongxin/node/bin/node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{try{const x=JSON.parse(b);if(x.ok!==true||x.mqtt?.connected!==true)process.exit(1)}catch{process.exit(1)}})'; then
        ready=true
        break
    fi
    sleep 1
done
[[ $ready == true ]]
ss -lnt | grep -q '0.0.0.0:8883'
openssl s_client -connect 127.0.0.1:8883 -servername api.zjdongxin.net \
    -verify_hostname api.zjdongxin.net -verify_return_error </dev/null >/dev/null 2>&1
trap - ERR
echo "Public MQTT TLS active; previous environment: $backup"
